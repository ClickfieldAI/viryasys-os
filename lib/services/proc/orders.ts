// Purchase orders: builder, approval workflow, release, vendor confirmation, promise history, vendor payments.
import { nextCode, getDb } from "../../db";
import { Smtp } from "../../providers";
import { addDays, dateOnly, parseSql, inr } from "../../util";
import { now, nowSql, today } from "../../clock";
import { audit, notify, userName, type Actor } from "../core";
import { fire } from "../automation";
import { all, one, run, r2, plog, poGate, assertGate, createCustomerOrder } from "./core";
import { emitEvent } from "./zoho";

export const APPROVER_ROLES = ["md", "finance"];
const RELEASER_ROLES = ["md", "procurement"];
const LIVE = "('CANCELLED','REJECTED')";

export interface PoLineInput { requirement_id: number; extra?: { category: string; name: string; spec?: string; unit: string }; qty: number; rate: number; tax_pct?: number; description?: string; spec?: string; required_date?: string; request_id?: number | null }
export interface PoInput { project_id: number; vendor_id: number; stage_id?: number | null; required_date?: string; billing_address?: string; delivery_address?: string; payment_terms?: string; delivery_terms?: string; notes?: string; lines: PoLineInput[] }

function freeQty(reqId: number, excludePo?: number) {
  const r = one<any>("SELECT * FROM material_requirements WHERE id = ?", reqId);
  const ordered = one<{ s: number }>(`SELECT COALESCE(SUM(i.qty),0) s FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = ? AND o.status NOT IN ${LIVE} AND o.id != ?`, reqId, excludePo ?? -1)!.s;
  return { r, free: r.qty - ordered };
}

/** Catalog materials that aren't in the BOQ become "EXTRA" requirements so receipt, stock and cost control keep working. */
function materializeExtras(d: PoInput) {
  const plan = one<any>("SELECT id FROM procurement_plans WHERE project_id = ?", d.project_id);
  const stage = d.stage_id ?? (plan ? one<any>("SELECT id FROM procurement_stages WHERE plan_id = ? ORDER BY sort DESC LIMIT 1", plan.id)?.id : null) ?? null;
  for (const l of d.lines) {
    if (l.requirement_id || !l.extra) continue;
    const x = l.extra;
    if (!x.name?.trim()) throw new Error("Choose a material for every added line");
    l.requirement_id = Number(run("INSERT INTO material_requirements (project_id, plan_id, stage_id, category, name, spec, qty, unit, required_date, est_unit_cost, source) VALUES (?,?,?,?,?,?,?,?,?,?, 'EXTRA')",
      d.project_id, plan?.id ?? null, stage, x.category || "Other", x.name.trim(), x.spec ?? null, l.qty, x.unit || "nos", l.required_date || null, l.rate).lastInsertRowid);
  }
}
/** Drop EXTRA requirements that no PO line uses any more (e.g. a line removed while editing a draft). */
function pruneExtras(projectId: number) {
  run("DELETE FROM material_requirements WHERE project_id = ? AND source = 'EXTRA' AND id NOT IN (SELECT requirement_id FROM purchase_order_items WHERE requirement_id IS NOT NULL) AND id NOT IN (SELECT requirement_id FROM inventory_transactions WHERE requirement_id IS NOT NULL)", projectId);
}

function validate(d: PoInput, excludePo?: number) {
  assertGate(poGate(d.project_id));
  const v = one<any>("SELECT * FROM vendors WHERE id = ?", d.vendor_id);
  if (!v || !v.active) throw new Error("Choose an active vendor");
  if (!d.lines.length) throw new Error("Add at least one line");
  const seen = new Set<number>();
  for (const l of d.lines) {
    if (seen.has(l.requirement_id)) throw new Error("A material appears twice on this PO");
    seen.add(l.requirement_id);
    const { r, free } = freeQty(l.requirement_id, excludePo);
    if (!r || r.project_id !== d.project_id) throw new Error("A line isn't part of this project's requirement");
    if (!(l.qty > 0)) throw new Error(`Quantity for ${r.name} must be positive`);
    if (l.qty > free + 1e-9) throw new Error(`${r.name}: only ${free} ${r.unit} left to order (required ${r.qty}).`);
    if (!(l.rate > 0)) throw new Error(`Enter a unit price for ${r.name}`);
    if ((l.tax_pct ?? 18) < 0 || (l.tax_pct ?? 18) > 100) throw new Error("Tax must be between 0 and 100");
  }
}

function writeLines(poId: number, d: PoInput) {
  run("DELETE FROM purchase_order_items WHERE po_id = ?", poId);
  let sub = 0, tax = 0;
  for (const l of d.lines) {
    const r = one<any>("SELECT * FROM material_requirements WHERE id = ?", l.requirement_id);
    const tp = l.tax_pct ?? 18;
    run("INSERT INTO purchase_order_items (po_id, requirement_id, request_id, category, description, spec, qty, unit, rate, tax_pct, required_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      poId, r.id, l.request_id ?? null, r.category, l.description || r.name, l.spec ?? r.spec, l.qty, r.unit, l.rate, tp, l.required_date || r.required_date);
    sub += l.qty * l.rate; tax += (l.qty * l.rate * tp) / 100;
  }
  run("UPDATE purchase_orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?", r2(sub), r2(tax), r2(sub + tax), poId);
}

export function createPO(d: PoInput, actor: Actor): { id: number; code: string } {
  return getDb().transaction(() => createPOInner(d, actor))();
}
function createPOInner(d: PoInput, actor: Actor): { id: number; code: string } {
  materializeExtras(d);
  validate(d);
  const proj = one<any>("SELECT p.*, c.name cname FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?", d.project_id);
  const org = one<any>("SELECT * FROM organizations LIMIT 1");
  const vendor = one<any>("SELECT * FROM vendors WHERE id = ?", d.vendor_id);
  const code = nextCode("PO");
  const reqDate = d.required_date || d.lines.map((l) => one<any>("SELECT required_date FROM material_requirements WHERE id = ?", l.requirement_id)?.required_date).filter(Boolean).sort()[0] || null;
  const id = Number(run(`INSERT INTO purchase_orders (code, project_id, vendor_id, stage_id, status, po_date, required_date, billing_address, delivery_address, payment_terms, delivery_terms, notes, owner_id, created_at)
    VALUES (?,?,?,?, 'DRAFT', ?,?,?,?,?,?,?,?,?)`, code, d.project_id, d.vendor_id, d.stage_id ?? null, today(), reqDate,
    d.billing_address || `${org?.name ?? "ViryaSys Technologies"}, ${org?.address ?? ""}${org?.gstin ? ` · GSTIN ${org.gstin}` : ""}`,
    d.delivery_address || `${proj.name} — ${proj.site ?? proj.city ?? ""}`, d.payment_terms || vendor.payment_terms || "As agreed", d.delivery_terms || "Delivery to project site, unloading by vendor", d.notes ?? null, actor.id, nowSql()).lastInsertRowid);
  writeLines(id, d);
  for (const l of d.lines) if (l.request_id) run("UPDATE purchase_requests SET status = 'CONVERTED', po_id = ? WHERE id = ? AND status = 'OPEN'", id, l.request_id);
  plog(actor, { project_id: d.project_id, po_id: id, type: "po_created", summary: `PO ${code} created for ${vendor.name} (${d.lines.length} line${d.lines.length > 1 ? "s" : ""})` });
  audit(actor, "created PO", "purchase_order", code);
  return { id, code };
}

export function savePO(poId: number, d: PoInput, actor: Actor) {
  getDb().transaction(() => savePOInner(poId, d, actor))();
}
function savePOInner(poId: number, d: PoInput, actor: Actor) {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!["DRAFT", "REJECTED"].includes(po.status)) throw new Error("Only draft or rejected POs can be edited. Released POs are never overwritten.");
  materializeExtras(d);
  validate(d, poId);
  run("UPDATE purchase_orders SET vendor_id = ?, stage_id = ?, required_date = COALESCE(?, required_date), billing_address = COALESCE(?, billing_address), delivery_address = COALESCE(?, delivery_address), payment_terms = ?, delivery_terms = ?, notes = ?, status = 'DRAFT', version = version + CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END WHERE id = ?",
    d.vendor_id, d.stage_id ?? null, d.required_date || null, d.billing_address || null, d.delivery_address || null, d.payment_terms || null, d.delivery_terms || null, d.notes ?? null, poId);
  writeLines(poId, d);
  pruneExtras(po.project_id);
  plog(actor, { project_id: po.project_id, po_id: poId, type: "po_edited", summary: `PO ${po.code} edited` });
}

export function submitPO(poId: number, actor: Actor) {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (po.status !== "DRAFT") throw new Error("Only a draft PO can be submitted for approval");
  if (!one("SELECT 1 FROM purchase_order_items WHERE po_id = ?", poId)) throw new Error("PO has no lines");
  assertGate(poGate(po.project_id));
  run("UPDATE purchase_orders SET status = 'PENDING_APPROVAL', submitted_at = ? WHERE id = ?", nowSql(), poId);
  plog(actor, { project_id: po.project_id, po_id: poId, type: "po_submitted", summary: `PO ${po.code} submitted for approval (${inr(po.total)})` });
  notify({ role: "md", type: "po_approval", title: `PO ${po.code} awaiting approval`, body: `${inr(po.total)}`, link: `/procurement/${poId}` });
  notify({ role: "finance", type: "po_approval", title: `PO ${po.code} awaiting approval`, body: `${inr(po.total)}`, link: `/procurement/${poId}` });
}

export function approvePO(poId: number, actor: Actor) {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!actor.role || !APPROVER_ROLES.includes(actor.role)) throw new Error("Only the MD or Finance can approve purchase orders.");
  if (po.status !== "PENDING_APPROVAL") throw new Error("This PO isn't waiting for approval");
  if (po.owner_id === actor.id && actor.role !== "md") throw new Error("You can't approve a PO you created.");
  assertGate(poGate(po.project_id));
  run("UPDATE purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ?", actor.id, nowSql(), poId);
  plog(actor, { project_id: po.project_id, po_id: poId, type: "po_approved", summary: `PO ${po.code} approved by ${actor.name}` });
  audit(actor, "approved PO", "purchase_order", po.code, "PENDING_APPROVAL", "APPROVED");
  fire("po.approved", { po_id: poId, po_code: po.code, link: `/procurement/${poId}` });
}
export function rejectPO(poId: number, reason: string, actor: Actor) {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!actor.role || !APPROVER_ROLES.includes(actor.role)) throw new Error("Only the MD or Finance can reject purchase orders.");
  if (po.status !== "PENDING_APPROVAL") throw new Error("This PO isn't waiting for approval");
  if (!reason.trim()) throw new Error("Give a reason for rejecting");
  run("UPDATE purchase_orders SET status = 'REJECTED', cancelled_reason = ? WHERE id = ?", reason.trim(), poId);
  plog(actor, { project_id: po.project_id, po_id: poId, type: "po_rejected", summary: `PO ${po.code} rejected: ${reason}` });
  notify({ userId: po.owner_id, type: "po_approval", title: `PO ${po.code} was rejected`, body: reason, link: `/procurement/${poId}` });
  (require("./intel") as typeof import("./intel")).raiseException({ key: `porej:${poId}`, type: "PO_REJECTION", severity: "medium", project_id: po.project_id, po_id: poId, material: po.code, vendor_id: po.vendor_id, detail: reason, owner_id: po.owner_id });
}

/** Release to vendor. Only an approved PO may be released, and only by procurement or the MD. */
export async function releasePO(poId: number, actor: Actor) {
  const po = one<any>("SELECT po.*, v.name vname, v.email vemail FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?", poId);
  if (actor.id != null && (!actor.role || !RELEASER_ROLES.includes(actor.role))) throw new Error("You're not authorised to release purchase orders.");
  if (po.status !== "APPROVED") throw new Error("Only an approved PO can be released to the vendor.");
  run("UPDATE purchase_orders SET status = 'SENT', sent_at = ? WHERE id = ?", nowSql(), poId);
  let mail = "email not sent (no vendor email / SMTP off)";
  if (po.vemail && Smtp.configured()) {
    const items = all<any>("SELECT * FROM purchase_order_items WHERE po_id = ?", poId);
    const text = `Dear ${po.vname},\n\nPlease find our purchase order ${po.code} for ${po.delivery_address}.\n\n${items.map((i, n) => `${n + 1}. ${i.description} — ${i.qty} ${i.unit} @ ${inr(i.rate)}${i.spec ? ` (${i.spec})` : ""}`).join("\n")}\n\nTotal: ${inr(po.total)} (incl. tax)\nRequired by: ${po.required_date ?? "as agreed"}\nPayment terms: ${po.payment_terms}\n\nKindly confirm the quantities and your expected delivery date by reply.\n\nRegards,\nViryasys Technologies Procurement`;
    try { await Smtp.send({ to: po.vemail, subject: `Purchase Order ${po.code}`, text, attachments: [] }, "Viryasys Technologies Procurement"); mail = `emailed to ${po.vemail}`; }
    catch (e: any) { mail = `email failed: ${String(e.message).slice(0, 120)}`; }
  }
  plog(actor, { project_id: po.project_id, po_id: poId, type: "po_sent", summary: `PO ${po.code} released to ${po.vname} (${mail})` });
  audit(actor, "released PO", "purchase_order", po.code, "APPROVED", "SENT");
  emitEvent("PURCHASE_ORDER_RELEASED", "purchase_order", poId, po.code, { total: po.total, vendor: po.vname });
}

export function cancelPO(poId: number, reason: string, actor: Actor) {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (["CANCELLED", "REJECTED"].includes(po.status)) throw new Error("PO is already closed");
  if (one("SELECT 1 FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id JOIN purchase_order_items i ON i.id = di.po_item_id WHERE i.po_id = ? AND d.status IN ('RECEIVED','INSPECTED','ACKNOWLEDGED')", poId)) throw new Error("Material has already been received against this PO — it can't be cancelled.");
  if (!reason.trim()) throw new Error("Give a reason");
  run("UPDATE purchase_orders SET status = 'CANCELLED', cancelled_reason = ? WHERE id = ?", reason.trim(), poId);
  run("UPDATE deliveries SET status = 'CLOSED', closed_at = ? WHERE po_id = ? AND status IN ('PLANNED','READY_FOR_DISPATCH','IN_TRANSIT')", nowSql(), poId);
  run("UPDATE purchase_requests SET status = 'OPEN', po_id = NULL WHERE po_id = ? AND status = 'CONVERTED'", poId);
  plog(actor, { project_id: po.project_id, po_id: poId, type: "po_cancelled", summary: `PO ${po.code} cancelled: ${reason}` });
  audit(actor, "cancelled PO", "purchase_order", po.code, po.status, "CANCELLED");
}

/* ───────── vendor confirmation + promise history ───────── */
export interface ConfLine { po_item_id: number; status: "ACCEPTED" | "PARTIAL" | "REJECTED"; confirmed_qty: number; expected_date?: string; expected_time?: string; remarks?: string }

export function currentPromise(itemId: number) {
  return one<any>("SELECT * FROM vendor_delivery_updates WHERE po_item_id = ? ORDER BY seq DESC LIMIT 1", itemId);
}
function addPromise(itemId: number, date: string, time: string | null | undefined, reason: string | null, source: string, actor: Actor) {
  const last = currentPromise(itemId);
  if (last && last.promised_date === date && (last.expected_time ?? "") === (time ?? "")) return last.seq;
  const seq = (last?.seq ?? 0) + 1;
  run("INSERT INTO vendor_delivery_updates (po_item_id, seq, promised_date, expected_time, reason, source, recorded_by, at) VALUES (?,?,?,?,?,?,?,?)", itemId, seq, date, time ?? null, reason, source, actor.id, nowSql());
  return seq;
}

export function recordConfirmation(poId: number, lines: ConfLine[], actor: Actor) {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!["SENT", "VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(po.status)) throw new Error("Release the PO to the vendor before recording their confirmation.");
  if (!lines.length) throw new Error("Nothing to confirm");
  const items = all<any>("SELECT * FROM purchase_order_items WHERE po_id = ?", poId);
  const t = nowSql();
  for (const l of lines) {
    const it = items.find((i) => i.id === l.po_item_id);
    if (!it) throw new Error("Line does not belong to this PO");
    if (l.status !== "REJECTED") {
      if (!(l.confirmed_qty > 0) || l.confirmed_qty > it.qty + 1e-9) throw new Error(`${it.description}: confirmed quantity must be between 0 and ${it.qty}`);
      if (!l.expected_date) throw new Error(`${it.description}: the vendor's expected delivery date is required`);
      if (l.status === "ACCEPTED" && l.confirmed_qty < it.qty - 1e-9) throw new Error(`${it.description}: use “Partially accepted” when the confirmed quantity is less than ordered`);
    }
    run("INSERT INTO vendor_confirmations (po_id, po_item_id, status, confirmed_qty, expected_date, expected_time, remarks, recorded_by, at) VALUES (?,?,?,?,?,?,?,?,?)",
      poId, l.po_item_id, l.status, l.status === "REJECTED" ? 0 : l.confirmed_qty, l.expected_date || null, l.expected_time || null, l.remarks || null, actor.id, t);
    if (l.status !== "REJECTED" && l.expected_date) addPromise(l.po_item_id, l.expected_date, l.expected_time, l.remarks || "Vendor confirmation", "CONFIRMATION", actor);
  }
  // PO status from the latest confirmation of every line
  const latest = items.map((i) => one<any>("SELECT * FROM vendor_confirmations WHERE po_item_id = ? ORDER BY id DESC LIMIT 1", i.id));
  const allRejected = latest.every((c) => c?.status === "REJECTED");
  const allFull = latest.every((c, n) => c && c.status === "ACCEPTED" && c.confirmed_qty >= items[n].qty - 1e-9);
  const status = allRejected ? "REJECTED" : allFull ? "VENDOR_CONFIRMED" : "PARTIALLY_CONFIRMED";
  run("UPDATE purchase_orders SET status = ?, cancelled_reason = CASE WHEN ? = 'REJECTED' THEN 'Rejected by vendor' ELSE cancelled_reason END WHERE id = ?", status, status, poId);
  plog(actor, { project_id: po.project_id, po_id: poId, type: "vendor_confirmation", summary: `Vendor ${status === "REJECTED" ? "rejected" : status === "VENDOR_CONFIRMED" ? "confirmed" : "partially confirmed"} PO ${po.code}`, meta: lines });
  notify({ role: "procurement", type: "vendor_confirmation", title: `Vendor ${status === "REJECTED" ? "rejected" : "confirmed"} ${po.code}`, link: `/procurement/${poId}` });
  if (status === "REJECTED") (require("./intel") as typeof import("./intel")).raiseException({ key: `porej:${poId}`, type: "PO_REJECTION", severity: "high", project_id: po.project_id, po_id: poId, material: po.code, vendor_id: po.vendor_id, detail: "Vendor rejected the PO", owner_id: po.owner_id });
  else fire("vendor.confirmed", { po_id: poId, po_code: po.code, link: `/procurement/${poId}` });
}

/** Vendor moves a date: the original is kept, a new promise is appended. */
export function updatePromise(itemId: number, date: string, time: string | undefined, reason: string, actor: Actor) {
  const it = one<any>("SELECT i.*, o.project_id, o.code po_code, o.id oid FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.id = ?", itemId);
  const last = currentPromise(itemId);
  if (!last) throw new Error("This line has no vendor confirmation yet");
  if (!date) throw new Error("Pick the new promised date");
  if (last.promised_date === date) throw new Error("That is already the current promised date");
  const first = one<any>("SELECT promised_date FROM vendor_delivery_updates WHERE po_item_id = ? ORDER BY seq ASC LIMIT 1", itemId);
  addPromise(itemId, date, time, reason || "Vendor revised date", "VENDOR_UPDATE", actor);
  // keep the (cached) expected date of any open delivery carrying this item in step with the new promise
  run(`UPDATE deliveries SET expected_date = (SELECT MAX(u.promised_date) FROM delivery_items di JOIN vendor_delivery_updates u ON u.po_item_id = di.po_item_id AND u.seq = (SELECT MAX(seq) FROM vendor_delivery_updates WHERE po_item_id = di.po_item_id) WHERE di.delivery_id = deliveries.id)
       WHERE status IN ('PLANNED','READY_FOR_DISPATCH','IN_TRANSIT') AND id IN (SELECT delivery_id FROM delivery_items WHERE po_item_id = ?)`, itemId);
  const shift = Math.round((Date.parse(date) - Date.parse(last.promised_date)) / 86400000);
  plog(actor, { project_id: it.project_id, po_id: it.oid, type: "delivery_date_changed", summary: `${it.description}: delivery date ${last.promised_date} → ${date}${reason ? ` (${reason})` : ""}`, meta: { original: first.promised_date, from: last.promised_date, to: date } });
  audit(actor, "delivery date changed", "purchase_order", it.po_code, last.promised_date, date);
  const pmId = one<any>("SELECT pm_id FROM projects WHERE id = ?", it.project_id)?.pm_id;
  const body = `${it.description} — original ${first.promised_date}, now ${date}`;
  notify({ role: "procurement", type: "delivery_delay", title: `Vendor changed delivery date (${shift > 0 ? "+" : ""}${shift}d) — ${it.po_code}`, body, link: `/procurement/${it.oid}` });
  if (pmId && shift > 0) notify({ userId: pmId, type: "delivery_delay", title: `Delivery date pushed ${shift}d — ${it.description}`, body, link: `/procurement/${it.oid}` });
  (require("./intel") as typeof import("./intel")).addAlert({ key: `alert:datechg:${itemId}:${date}`, type: "DATE_CHANGED", title: `Vendor updated delivery date: ${it.description}`, body: `Original ${first.promised_date}, previous ${last.promised_date}, new ${date}`, project_id: it.project_id, po_id: it.oid, link: `/procurement/${it.oid}`, severity: shift > 2 ? "high" : "medium", roles: [] });
}

export function promiseHistory(itemId: number) {
  const rows = all<any>("SELECT u.*, us.name by_name FROM vendor_delivery_updates u LEFT JOIN users us ON us.id = u.recorded_by WHERE po_item_id = ? ORDER BY seq", itemId);
  const actual = one<any>("SELECT MIN(d.received_at) a FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE di.po_item_id = ? AND d.received_at IS NOT NULL", itemId)?.a as string | undefined;
  const orig = rows[0]?.promised_date;
  const actualDate = actual ? dateOnly(parseSql(actual)!) : null;
  const ref = actualDate ?? today();
  const totalDelay = orig ? Math.max(0, Math.round((Date.parse(ref) - Date.parse(orig)) / 86400000)) : 0;
  return { promises: rows, original: orig ?? null, current: rows.at(-1)?.promised_date ?? null, actual: actualDate, totalDelay };
}

/* ───────── vendor payments ───────── */
export function poPaid(poId: number) { return one<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM vendor_payments WHERE po_id = ?", poId)!.s; }

export function recordVendorPayment(poId: number, amount: number, mode: string, reference: string, note: string, actor: Actor) {
  if (!actor.role || !["finance", "procurement", "md"].includes(actor.role)) throw new Error("You're not authorised to record vendor payments.");
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!["SENT", "VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(po.status)) throw new Error("Payments are recorded against released POs");
  const due = r2(po.total - poPaid(poId));
  if (!(amount > 0)) throw new Error("Enter a valid amount");
  if (amount > due + 0.01) throw new Error(`Amount exceeds the balance payable (${inr(due)})`);
  run("INSERT INTO vendor_payments (po_id, amount, paid_on, mode, reference, note, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?)", poId, amount, today(), mode, reference || null, note || null, actor.id, nowSql());
  plog(actor, { project_id: po.project_id, po_id: poId, type: "vendor_payment", summary: `Vendor payment ${inr(amount)} recorded for ${po.code} (${mode}${reference ? ` · ${reference}` : ""})` });
  audit(actor, "recorded vendor payment", "purchase_order", po.code, undefined, amount);
  emitEvent("VENDOR_PAYMENT", "purchase_order", poId, po.code, { amount, mode, reference });
  notify({ role: "finance", type: "payment_received", title: `Vendor payment ${inr(amount)} — ${po.code}`, link: `/procurement/${poId}` });
}

export function poFull(id: number) {
  const po = one<any>(`SELECT o.*, v.name vendor_name, v.email vendor_email, v.phone vendor_phone, p.code project_code, p.name project_name, p.capacity_kw, c.name customer_name, u.name owner_name, ap.name approver_name
    FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN projects p ON p.id = o.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN users ap ON ap.id = o.approved_by WHERE o.id = ?`, id);
  if (!po) return null;
  return {
    po, paid: poPaid(id), balance: r2(po.total - poPaid(id)),
    payments: all<any>("SELECT vp.*, u.name by_name FROM vendor_payments vp LEFT JOIN users u ON u.id = vp.recorded_by WHERE po_id = ? ORDER BY vp.id DESC", id),
    confirmations: all<any>("SELECT vc.*, i.description, u.name by_name FROM vendor_confirmations vc JOIN purchase_order_items i ON i.id = vc.po_item_id LEFT JOIN users u ON u.id = vc.recorded_by WHERE vc.po_id = ? ORDER BY vc.id DESC", id),
    vendors: all<any>("SELECT id, name, categories, category FROM vendors WHERE active = 1 ORDER BY name"),
  };
}

export { createCustomerOrder, addDays, now, userName };
