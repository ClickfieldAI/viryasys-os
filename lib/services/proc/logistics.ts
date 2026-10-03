// Deliveries: expected → dispatched → received → inspected → GRN → delivery note → customer acknowledgement.
// One PO can have many deliveries; a delivery can carry any subset of items and partial quantities.
import { nextCode } from "../../db";
import { addDays, dateOnly, parseSql } from "../../util";
import { now, nowSql, today } from "../../clock";
import { audit, notify, type Actor } from "../core";
import { fire } from "../automation";
import { all, one, run, plog, categoryInfo } from "./core";
import { postTxn } from "./ledger";
import { emitEvent } from "./zoho";
import { currentPromise } from "./orders";

const OPEN_DELIV = "('PLANNED','READY_FOR_DISPATCH','IN_TRANSIT')";

export function confirmedQty(itemId: number): number | null {
  const c = one<any>("SELECT status, confirmed_qty FROM vendor_confirmations WHERE po_item_id = ? ORDER BY id DESC LIMIT 1", itemId);
  return c ? (c.status === "REJECTED" ? 0 : c.confirmed_qty) : null;
}
/** Quantity of a confirmed line that isn't on any delivery yet and hasn't been accepted (short/damaged/rejected quantity returns here). */
export function unassignedQty(itemId: number): number {
  const c = confirmedQty(itemId) ?? 0;
  const acc = one<{ s: number }>("SELECT COALESCE(SUM(qty_accepted),0) s FROM delivery_items WHERE po_item_id = ?", itemId)!.s;
  const inflight = one<{ s: number }>(`SELECT COALESCE(SUM(di.qty_dispatched),0) s FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE di.po_item_id = ? AND d.status IN ('PLANNED','READY_FOR_DISPATCH','IN_TRANSIT','RECEIVED')`, itemId)!.s;
  return Math.max(0, c - acc - inflight);
}

function syncDeliveryDate(deliveryId: number) {
  const d = one<any>("SELECT MAX(u.promised_date) m FROM delivery_items di JOIN vendor_delivery_updates u ON u.po_item_id = di.po_item_id AND u.seq = (SELECT MAX(seq) FROM vendor_delivery_updates WHERE po_item_id = di.po_item_id) WHERE di.delivery_id = ?", deliveryId);
  if (d?.m) run("UPDATE deliveries SET expected_date = ? WHERE id = ?", d.m, deliveryId);
}

export function createDelivery(poId: number, items: { po_item_id: number; qty: number }[], expected: string | null, actor: Actor, status = "PLANNED") {
  const po = one<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!["VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(po.status)) throw new Error("Deliveries can be planned once the vendor has confirmed the PO");
  const lines = items.filter((i) => i.qty > 0);
  if (!lines.length) throw new Error("Choose at least one item and quantity");
  for (const l of lines) {
    const it = one<any>("SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?", l.po_item_id, poId);
    if (!it) throw new Error("Item does not belong to this PO");
    const free = unassignedQty(l.po_item_id);
    if (l.qty > free + 1e-9) throw new Error(`${it.description}: only ${free} ${it.unit} left to schedule`);
  }
  const code = nextCode("DEL");
  const id = Number(run("INSERT INTO deliveries (code, po_id, project_id, vendor_id, status, expected_date, site, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", code, poId, po.project_id, po.vendor_id, status, expected, po.delivery_address, actor.id, nowSql()).lastInsertRowid);
  for (const l of lines) run("INSERT INTO delivery_items (delivery_id, po_item_id, qty_dispatched) VALUES (?,?,?)", id, l.po_item_id, l.qty);
  if (!expected) syncDeliveryDate(id);
  plog(actor, { project_id: po.project_id, po_id: poId, delivery_id: id, type: "delivery_planned", summary: `Delivery ${code} planned (${lines.length} item${lines.length > 1 ? "s" : ""})` });
  return { id, code };
}

/** "Vendor Confirmed → Create Expected Delivery": group unassigned confirmed lines by promised date. */
export function ensurePlannedDeliveries(poId: number, actor: Actor): number {
  const groups = new Map<string, { po_item_id: number; qty: number }[]>();
  for (const it of all<any>("SELECT id FROM purchase_order_items WHERE po_id = ?", poId)) {
    const q = unassignedQty(it.id), p = currentPromise(it.id);
    if (q > 1e-9 && p) groups.set(p.promised_date, [...(groups.get(p.promised_date) ?? []), { po_item_id: it.id, qty: q }]);
  }
  for (const [date, items] of groups) createDelivery(poId, items, date, actor, "PLANNED");
  return groups.size;
}

/** Move part of an item to its own delivery (staged / split shipments). */
export function splitDeliveryItem(deliveryItemId: number, qty: number, newExpected: string, actor: Actor) {
  const di = one<any>("SELECT di.*, d.status, d.po_id FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE di.id = ?", deliveryItemId);
  if (!["PLANNED", "READY_FOR_DISPATCH"].includes(di.status)) throw new Error("Only items on a planned delivery can be split");
  if (!(qty > 0) || qty >= di.qty_dispatched) throw new Error(`Enter a quantity between 0 and ${di.qty_dispatched}`);
  run("UPDATE delivery_items SET qty_dispatched = qty_dispatched - ? WHERE id = ?", qty, deliveryItemId);
  return createDelivery(di.po_id, [{ po_item_id: di.po_item_id, qty }], newExpected, actor, "PLANNED");
}

const dstat = (id: number) => one<any>("SELECT d.*, o.code po_code, o.project_id pid FROM deliveries d JOIN purchase_orders o ON o.id = d.po_id WHERE d.id = ?", id);

export function markReady(id: number, actor: Actor) {
  const d = dstat(id);
  if (d.status !== "PLANNED") throw new Error("Only a planned delivery can be marked ready");
  run("UPDATE deliveries SET status = 'READY_FOR_DISPATCH' WHERE id = ?", id);
  plog(actor, { project_id: d.pid, po_id: d.po_id, delivery_id: id, type: "delivery_ready", summary: `${d.code} ready for dispatch` });
}
export function dispatch(id: number, vehicle: string, driver: string, actor: Actor) {
  const d = dstat(id);
  if (!["PLANNED", "READY_FOR_DISPATCH"].includes(d.status)) throw new Error("This delivery has already been dispatched or received");
  run("UPDATE deliveries SET status = 'IN_TRANSIT', dispatched_at = ?, vehicle = ?, driver = ? WHERE id = ?", nowSql(), vehicle || null, driver || null, id);
  plog(actor, { project_id: d.pid, po_id: d.po_id, delivery_id: id, type: "delivery_dispatched", summary: `${d.code} dispatched${vehicle ? ` (${vehicle})` : ""}` });
  const pm = one<any>("SELECT pm_id FROM projects WHERE id = ?", d.pid)?.pm_id;
  if (pm) notify({ userId: pm, type: "material_received", title: `Material in transit — ${d.code}`, body: `Expected ${d.expected_date ?? "TBC"}`, link: `/procurement/deliveries/${id}` });
}

/* ───────── receipt ───────── */
export function receiveDelivery(id: number, d: { received_by: string; vehicle?: string; driver?: string; notes?: string; items: { delivery_item_id: number; qty_received: number }[] }, actor: Actor) {
  const del = dstat(id);
  if (!["PLANNED", "READY_FOR_DISPATCH", "IN_TRANSIT"].includes(del.status)) throw new Error("This delivery has already been received");
  if (!d.received_by.trim()) throw new Error("Enter who received the material at site");
  const rows = all<any>("SELECT di.*, i.description, i.requirement_id, i.unit FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = ?", id);
  let anyShort = false;
  for (const r of rows) {
    const got = d.items.find((x) => x.delivery_item_id === r.id)?.qty_received;
    if (got == null || got < 0) throw new Error(`Enter the quantity received for ${r.description}`);
    if (got > r.qty_dispatched + 1e-9) throw new Error(`${r.description}: received ${got} is more than the ${r.qty_dispatched} expected on this delivery`);
  }
  const mrCode = nextCode("MR");
  const t = nowSql();
  for (const r of rows) {
    const got = d.items.find((x) => x.delivery_item_id === r.id)!.qty_received;
    const short = Math.max(0, r.qty_dispatched - got);
    if (short > 0) anyShort = true;
    run("UPDATE delivery_items SET qty_received = ?, qty_short = ? WHERE id = ?", got, short, r.id);
    if (r.requirement_id && got > 0) postTxn({ project_id: del.pid, requirement_id: r.requirement_id, type: "RECEIVED", qty: got, ref_type: "delivery", ref_id: id, ref_code: del.code, user_id: actor.id });
  }
  run("INSERT INTO material_receipts (code, delivery_id, received_by, vehicle, driver, notes, received_at, created_by) VALUES (?,?,?,?,?,?,?,?)", mrCode, id, d.received_by, d.vehicle ?? del.vehicle, d.driver ?? del.driver, d.notes ?? null, t, actor.id);
  run("UPDATE deliveries SET status = 'RECEIVED', received_at = ?, vehicle = COALESCE(?, vehicle), driver = COALESCE(?, driver) WHERE id = ?", t, d.vehicle || null, d.driver || null, id);
  plog(actor, { project_id: del.pid, po_id: del.po_id, delivery_id: id, type: "material_received", summary: `${del.code} received at site by ${d.received_by} (${mrCode})${anyShort ? " — short delivery" : ""}` });
  audit(actor, "received material", "delivery", del.code);
  const pm = one<any>("SELECT pm_id FROM projects WHERE id = ?", del.pid)?.pm_id;
  notify({ role: "procurement", type: "material_received", title: `Material received: ${del.code}`, body: del.po_code, link: `/procurement/deliveries/${id}` });
  if (pm) notify({ userId: pm, type: "material_received", title: `Material received on site — ${del.code}`, link: `/procurement/deliveries/${id}` });
  fire("material.received", { delivery_id: id, delivery_code: del.code, project_id: del.pid, pm_id: pm, link: `/procurement/deliveries/${id}` });
  const intel = require("./intel") as typeof import("./intel");
  if (anyShort) for (const r of rows) {
    const got = d.items.find((x) => x.delivery_item_id === r.id)!.qty_received, short = r.qty_dispatched - got;
    if (short > 0) intel.raiseException({ key: `short:${r.id}`, type: "QUANTITY_SHORTAGE", severity: "high", project_id: del.pid, po_id: del.po_id, requirement_id: r.requirement_id, material: r.description, vendor_id: del.vendor_id, detail: `Ordered/dispatched ${r.qty_dispatched}, received ${got} — short ${short} ${r.unit}`, alert: { type: "SHORTAGE", title: `Material shortage: ${r.description} (${short} ${r.unit})`, roles: ["procurement"], pm } });
  }
}

/* ───────── inspection ───────── */
export interface InspectItem { delivery_item_id: number; spec_match: boolean; condition?: string; packaging?: string; serials?: string; remarks?: string; qty_accepted: number; qty_damaged: number; qty_rejected: number }

export function inspectDelivery(id: number, d: { remarks?: string; items: InspectItem[] }, actor: Actor) {
  const del = dstat(id);
  if (del.status !== "RECEIVED") throw new Error(del.status === "INSPECTED" || del.status === "ACKNOWLEDGED" ? "This delivery has already been inspected" : "Receive the material at site before inspecting it");
  const rows = all<any>("SELECT di.*, i.description, i.requirement_id, i.category, i.unit, i.po_id FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = ?", id);
  const results: { r: any; x: InspectItem; result: string }[] = [];
  for (const r of rows) {
    const x = d.items.find((y) => y.delivery_item_id === r.id);
    if (!x) throw new Error(`Inspect ${r.description}`);
    const sum = x.qty_accepted + x.qty_damaged + x.qty_rejected;
    if (x.qty_accepted < 0 || x.qty_damaged < 0 || x.qty_rejected < 0) throw new Error(`${r.description}: quantities can't be negative`);
    if (Math.abs(sum - r.qty_received) > 1e-9) throw new Error(`${r.description}: accepted + damaged + rejected (${sum}) must equal the ${r.qty_received} received`);
    if (!x.spec_match && x.qty_accepted > 0) throw new Error(`${r.description}: material that doesn't match the specification can't be accepted — mark it rejected`);
    const short = r.qty_short;
    const result = x.qty_accepted === r.qty_received && short === 0 ? "ACCEPTED"
      : x.qty_accepted > 0 ? "PARTIALLY_ACCEPTED"
      : x.qty_damaged > 0 ? "DAMAGED" : x.qty_rejected > 0 ? "REJECTED" : short > 0 ? "SHORTAGE" : "ACCEPTED";
    results.push({ r, x, result });
  }
  const overall = results.every((z) => z.result === "ACCEPTED") ? "ACCEPTED" : results.some((z) => z.x.qty_accepted > 0) ? "PARTIALLY_ACCEPTED"
    : results.some((z) => z.result === "DAMAGED") ? "DAMAGED" : results.some((z) => z.result === "REJECTED") ? "REJECTED" : "SHORTAGE";
  const insId = Number(run("INSERT INTO material_inspections (delivery_id, inspector_id, inspector_name, result, remarks, at) VALUES (?,?,?,?,?,?)", id, actor.id, actor.name, overall, d.remarks ?? null, nowSql()).lastInsertRowid);
  const intel = require("./intel") as typeof import("./intel");
  const pm = one<any>("SELECT pm_id FROM projects WHERE id = ?", del.pid)?.pm_id;
  for (const { r, x, result } of results) {
    run("INSERT INTO inspection_items (inspection_id, delivery_item_id, spec_match, qty_match, condition, packaging, serials, remarks, qty_received, qty_accepted, qty_damaged, qty_rejected, qty_short, result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      insId, r.id, x.spec_match ? 1 : 0, r.qty_short === 0 ? 1 : 0, x.condition ?? "Good", x.packaging ?? "Intact", x.serials ?? null, x.remarks ?? null, r.qty_received, x.qty_accepted, x.qty_damaged, x.qty_rejected, r.qty_short, result);
    run("UPDATE delivery_items SET qty_accepted = ?, qty_damaged = ?, qty_rejected = ? WHERE id = ?", x.qty_accepted, x.qty_damaged, x.qty_rejected, r.id);
    if (r.requirement_id) {
      const base = { project_id: del.pid, requirement_id: r.requirement_id, ref_type: "delivery", ref_id: id, ref_code: del.code, user_id: actor.id };
      postTxn({ ...base, type: "ACCEPTED", qty: x.qty_accepted });
      postTxn({ ...base, type: "DAMAGED", qty: x.qty_damaged });
      postTxn({ ...base, type: "REJECTED", qty: x.qty_rejected });
    }
    // serial numbers
    const serials = (x.serials ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (serials.length) {
      const cat = categoryInfo(r.category);
      const po = one<any>("SELECT o.*, v.name vname FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id WHERE o.id = ?", r.po_id);
      for (const sn of serials) {
        try { run("INSERT INTO serial_numbers (project_id, po_id, vendor_id, delivery_item_id, material, model, brand, serial, received_on, warranty_months) VALUES (?,?,?,?,?,?,?,?,?,?)", del.pid, r.po_id, po.vendor_id, r.id, r.description, r.description, po.vname, sn, today(), cat.serialized ? 60 : 12); }
        catch { throw new Error(`Serial number ${sn} is already recorded`); }
      }
    }
    if (x.qty_damaged > 0) intel.raiseException({ key: `dmg:${r.id}`, type: "DAMAGED_MATERIAL", severity: "high", project_id: del.pid, po_id: del.po_id, requirement_id: r.requirement_id, material: r.description, vendor_id: del.vendor_id, detail: `${x.qty_damaged} ${r.unit} damaged on arrival${x.remarks ? ` — ${x.remarks}` : ""}`, alert: { type: "DAMAGE", title: `Damaged material: ${r.description} (${x.qty_damaged} ${r.unit})`, roles: ["procurement"], pm } });
    if (!x.spec_match || x.qty_rejected > 0) intel.raiseException({ key: `spec:${r.id}`, type: "WRONG_SPECIFICATION", severity: "high", project_id: del.pid, po_id: del.po_id, requirement_id: r.requirement_id, material: r.description, vendor_id: del.vendor_id, detail: x.spec_match ? `${x.qty_rejected} ${r.unit} rejected` : `Delivered material does not match the ordered specification${x.remarks ? ` — ${x.remarks}` : ""}` });
  }
  run("UPDATE deliveries SET status = 'INSPECTED' WHERE id = ?", id);
  plog(actor, { project_id: del.pid, po_id: del.po_id, delivery_id: id, type: "inspection", summary: `${del.code} inspected by ${actor.name}: ${overall.replace("_", " ")}` });
  audit(actor, "inspected delivery", "delivery", del.code, "RECEIVED", overall);
  fire("inspection.completed", { delivery_id: id, delivery_code: del.code, result: overall, project_id: del.pid, link: `/procurement/deliveries/${id}` });
  // Safety net if the automation rule is switched off: a GRN always follows an inspection.
  if (!one("SELECT 1 FROM grns WHERE delivery_id = ?", id)) finalizeReceipt(id, actor);
  return overall;
}

/** GRN + delivery note. Idempotent. */
export function finalizeReceipt(id: number, actor: Actor) {
  const del = dstat(id);
  const ins = one<any>("SELECT * FROM material_inspections WHERE delivery_id = ?", id);
  if (!ins) throw new Error("Inspect the delivery before generating the GRN");
  let grn = one<any>("SELECT * FROM grns WHERE delivery_id = ?", id);
  if (!grn) {
    const code = nextCode("GRN");
    run("INSERT INTO grns (code, delivery_id, inspection_id, po_id, project_id, vendor_id, inspector_name, remarks, at) VALUES (?,?,?,?,?,?,?,?,?)", code, id, ins.id, del.po_id, del.pid, del.vendor_id, ins.inspector_name, ins.remarks, nowSql());
    grn = one<any>("SELECT * FROM grns WHERE delivery_id = ?", id);
    plog(actor, { project_id: del.pid, po_id: del.po_id, delivery_id: id, type: "grn", summary: `GRN ${code} generated for ${del.code}` });
    emitEvent("MATERIAL_RECEIVED", "grn", grn.id, code, { delivery: del.code, po: del.po_code });
  }
  const accepted = one<{ s: number }>("SELECT COALESCE(SUM(qty_accepted),0) s FROM delivery_items WHERE delivery_id = ?", id)!.s;
  if (accepted > 0 && !one("SELECT 1 FROM delivery_notes WHERE delivery_id = ?", id)) {
    const proj = one<any>("SELECT customer_id FROM projects WHERE id = ?", del.pid);
    const rec = one<any>("SELECT received_by FROM material_receipts WHERE delivery_id = ?", id);
    run("INSERT INTO delivery_notes (code, delivery_id, project_id, customer_id, received_by, at) VALUES (?,?,?,?,?,?)", nextCode("DN"), id, del.pid, proj?.customer_id, rec?.received_by, nowSql());
  }
  if (accepted === 0) { run("UPDATE deliveries SET status = 'CLOSED', closed_at = ? WHERE id = ?", nowSql(), id); }
  return grn;
}

/* ───────── customer acknowledgement ───────── */
export function acknowledgeDelivery(id: number, d: { customer_name: string; signature?: string; remarks?: string; photo_path?: string | null; via?: "site" | "portal" }, actor: Actor) {
  const del = dstat(id);
  if (del.status !== "INSPECTED") throw new Error(del.status === "ACKNOWLEDGED" ? "This delivery has already been acknowledged" : "Only an inspected delivery can be acknowledged");
  const dn = one<any>("SELECT * FROM delivery_notes WHERE delivery_id = ?", id);
  if (!dn) throw new Error("No delivery note exists for this delivery");
  if (!d.customer_name.trim()) throw new Error("Enter the customer's name");
  if (d.signature && (!d.signature.startsWith("data:image/png;base64,") || d.signature.length > 400_000)) throw new Error("Invalid signature image");
  run("INSERT INTO customer_acknowledgements (delivery_id, dn_id, customer_name, signature, remarks, photo_path, via, recorded_by, ack_at) VALUES (?,?,?,?,?,?,?,?,?)", id, dn.id, d.customer_name.trim(), d.signature ?? null, d.remarks ?? null, d.photo_path ?? null, d.via ?? "site", actor.id, nowSql());
  plog(actor, { project_id: del.pid, po_id: del.po_id, delivery_id: id, type: "customer_ack", summary: `${del.code} acknowledged by ${d.customer_name.trim()} (${d.via ?? "site"}) — delivery note ${dn.code} signed` });
  emitEvent("DELIVERY_NOTE_SIGNED", "delivery_note", dn.id, dn.code, { delivery: del.code, customer: d.customer_name });
  fire("delivery.acknowledged", { delivery_id: id, project_id: del.pid });
  if (one<any>("SELECT status FROM deliveries WHERE id = ?", id).status === "INSPECTED") closeDelivery(id, actor);
}
export function closeDelivery(id: number, actor: Actor) {
  run("UPDATE deliveries SET status = 'ACKNOWLEDGED', closed_at = ? WHERE id = ? AND status = 'INSPECTED'", nowSql(), id);
  const del = dstat(id);
  plog(actor, { project_id: del.pid, po_id: del.po_id, delivery_id: id, type: "delivery_closed", summary: `${del.code} closed — material available to the project` });
}

export function addProcDoc(o: { project_id?: number | null; po_id?: number | null; delivery_id?: number | null; doc_type: string; name: string; file_path: string | null }, actor: Actor) {
  run("INSERT INTO procurement_documents (project_id, po_id, delivery_id, doc_type, name, file_path, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)", o.project_id ?? null, o.po_id ?? null, o.delivery_id ?? null, o.doc_type, o.name, o.file_path, actor.id, nowSql());
}

export function deliveryFull(id: number) {
  const d = one<any>(`SELECT d.*, o.code po_code, o.total po_total, v.name vendor_name, p.code project_code, p.name project_name, p.customer_id, c.name customer_name, p.city
    FROM deliveries d JOIN purchase_orders o ON o.id = d.po_id LEFT JOIN vendors v ON v.id = d.vendor_id LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN customers c ON c.id = p.customer_id WHERE d.id = ?`, id);
  if (!d) return null;
  return {
    d,
    items: all<any>("SELECT di.*, i.description, i.spec, i.unit, i.category, i.rate, i.requirement_id, i.qty ordered FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = ? ORDER BY di.id", id),
    receipt: one<any>("SELECT * FROM material_receipts WHERE delivery_id = ?", id),
    inspection: one<any>("SELECT * FROM material_inspections WHERE delivery_id = ?", id),
    inspectionItems: all<any>("SELECT ii.*, i.description FROM inspection_items ii JOIN delivery_items di ON di.id = ii.delivery_item_id JOIN purchase_order_items i ON i.id = di.po_item_id WHERE ii.inspection_id = (SELECT id FROM material_inspections WHERE delivery_id = ?)", id),
    grn: one<any>("SELECT * FROM grns WHERE delivery_id = ?", id),
    dn: one<any>("SELECT * FROM delivery_notes WHERE delivery_id = ?", id),
    ack: one<any>("SELECT * FROM customer_acknowledgements WHERE delivery_id = ?", id),
    docs: all<any>("SELECT * FROM procurement_documents WHERE delivery_id = ? ORDER BY id DESC", id),
    serials: all<any>("SELECT s.* FROM serial_numbers s JOIN delivery_items di ON di.id = s.delivery_item_id WHERE di.delivery_id = ?", id),
    log: all<any>("SELECT * FROM procurement_activity_logs WHERE delivery_id = ? ORDER BY id", id),
  };
}
export { addDays, dateOnly, parseSql, now };
