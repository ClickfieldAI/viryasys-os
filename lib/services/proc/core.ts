// Procurement foundation: shared helpers, the hard procurement lock, customer order,
// procurement plan (configurable stages), material requirements and purchase requests.
import { getDb, nextCode } from "../../db";
import { addDays, dateOnly, parseSql } from "../../util";
import { now, nowSql, today } from "../../clock";
import { audit, notify, usersByRole, type Actor } from "../core";
import type { RoleKey } from "../../config";
import { getProposal } from "../proposals";

export const db = () => getDb();
export const one = <T = any>(sql: string, ...a: any[]) => getDb().prepare(sql).get(...a) as T | undefined;
export const all = <T = any>(sql: string, ...a: any[]) => getDb().prepare(sql).all(...a) as T[];
export const run = (sql: string, ...a: any[]) => getDb().prepare(sql).run(...a);
export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Append-only activity record. Never updated, never deleted (enforced by triggers). */
export function plog(actor: Actor, o: { project_id?: number | null; po_id?: number | null; delivery_id?: number | null; type: string; summary: string; meta?: unknown }) {
  run("INSERT INTO procurement_activity_logs (project_id, po_id, delivery_id, type, summary, meta, user_id, user_name, at) VALUES (?,?,?,?,?,?,?,?,?)",
    o.project_id ?? null, o.po_id ?? null, o.delivery_id ?? null, o.type, o.summary, o.meta ? JSON.stringify(o.meta) : null, actor.id, actor.name, nowSql());
}

/* ───────── access scope (project-level) ───────── */
export interface Viewer { id: number; role: RoleKey }
/** SQL fragment restricting rows to projects this user may see. `col` is the project id expression. */
export function scopeSql(v: Viewer | undefined, col: string): { sql: string; args: any[] } {
  if (!v || ["md", "admin", "procurement", "finance", "warehouse"].includes(v.role)) return { sql: "1=1", args: [] };
  if (v.role === "pm") return { sql: `EXISTS (SELECT 1 FROM projects sp WHERE sp.id = ${col} AND sp.pm_id = ?)`, args: [v.id] };
  if (v.role === "site_engineer") return { sql: `EXISTS (SELECT 1 FROM projects sp WHERE sp.id = ${col} AND (sp.engineer_id = ? OR sp.pm_id = ?))`, args: [v.id, v.id] };
  if (v.role === "sales") return { sql: `EXISTS (SELECT 1 FROM projects sp JOIN leads sl ON sl.id = sp.lead_id WHERE sp.id = ${col} AND sl.owner_id = ?)`, args: [v.id] };
  return { sql: "1=0", args: [] };
}
export function canSeeProject(v: Viewer, projectId: number): boolean {
  const s = scopeSql(v, "?");
  return !!one(`SELECT 1 x WHERE ${s.sql.replace("?", String(Number(projectId)))}`, ...s.args.slice(0));
}

/* ───────── configurable material categories ───────── */
export const categories = () => all<{ key: string; name: string; criticality: string; milestone_stage: string | null; serialized: number }>("SELECT * FROM material_categories WHERE active = 1 ORDER BY sort");
export function categoryInfo(key?: string | null) {
  return one<any>("SELECT * FROM material_categories WHERE key = ?", key ?? "") ?? { key: key ?? "Other", name: key ?? "Other", criticality: "medium", milestone_stage: "INSTALLATION", serialized: 0 };
}
export function guessCategory(desc: string): string {
  const d = desc.toLowerCase();
  if (/module|panel|pv /.test(d)) return "Panels";
  if (/inverter/.test(d)) return "Inverters";
  if (/structure|mounting|rail/.test(d)) return "Structure";
  if (/cable|conduit/.test(d)) return "Cables";
  if (/acdb|dcdb|earth|lightning|arrest|spd|mcb|monitor|distribution/.test(d)) return "Electrical";
  return "Other";
}

/* ───────── customer order (created when a proposal is accepted) ───────── */
export function createCustomerOrder(projectId: number, actor: Actor) {
  const ex = one("SELECT * FROM customer_orders WHERE project_id = ?", projectId);
  if (ex) return ex;
  const p = one<any>("SELECT * FROM projects WHERE id = ?", projectId);
  if (!p) throw new Error("Project not found");
  const cur = p.proposal_id ? getProposal(p.proposal_id) : null;
  const pct = cur?.terms?.[0]?.pct ?? 0;
  const sub = cur ? cur.pricing.subtotal - cur.pricing.discount : p.value;
  const code = nextCode("ORD");
  run("INSERT INTO customer_orders (code, project_id, customer_id, proposal_id, order_value, subtotal, required_advance_pct, status, approved_by, approved_at) VALUES (?,?,?,?,?,?,?, 'APPROVED', ?, ?)",
    code, projectId, p.customer_id, p.proposal_id, p.value, sub, pct, actor.id, nowSql());
  plog(actor, { project_id: projectId, type: "customer_order", summary: `Customer order ${code} approved — required advance ${pct}%` });
  (require("./zoho") as typeof import("./zoho")).emitEvent("CUSTOMER_ORDER_APPROVED", "customer_order", projectId, code, { order_value: p.value, project: p.code });
  return one("SELECT * FROM customer_orders WHERE project_id = ?", projectId);
}

/* ───────── the hard procurement lock ───────── */
export interface GateReason { code: "NO_PROJECT" | "NO_CUSTOMER" | "ORDER_NOT_APPROVED" | "ADVANCE_PENDING" | "NO_REQUIREMENTS"; message: string; required?: string; received?: string }
export interface Gate { ok: boolean; reasons: GateReason[]; project?: any; customer?: any; order?: any; requiredPct?: number; receivedPct?: number }

export function advanceReceived(projectId: number, orderValue: number) {
  const paid = one<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE project_id = ?", projectId)!.s;
  return { paid, pct: orderValue > 0 ? r2((paid / orderValue) * 100) : 0 };
}

/** Customer + project + approved order + required advance. */
export function procurementGate(projectId: number): Gate {
  const reasons: GateReason[] = [];
  const project = one<any>("SELECT p.*, c.name customer_name FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?", projectId);
  if (!project) return { ok: false, reasons: [{ code: "NO_PROJECT", message: "Project does not exist." }] };
  const customer = project.customer_id ? one("SELECT * FROM customers WHERE id = ?", project.customer_id) : null;
  if (!customer) reasons.push({ code: "NO_CUSTOMER", message: "Customer record does not exist." });
  const order = one<any>("SELECT * FROM customer_orders WHERE project_id = ?", projectId);
  if (!order || order.status !== "APPROVED") reasons.push({ code: "ORDER_NOT_APPROVED", message: "Customer order not approved." });
  let requiredPct: number | undefined, receivedPct: number | undefined;
  if (order) {
    requiredPct = order.required_advance_pct as number;
    receivedPct = advanceReceived(projectId, order.order_value).pct;
    if (receivedPct + 0.01 < (requiredPct as number)) reasons.push({ code: "ADVANCE_PENDING", message: "Required customer advance has not been received.", required: `${requiredPct}%`, received: `${receivedPct}%` });
  }
  return { ok: reasons.length === 0, reasons, project, customer, order, requiredPct, receivedPct };
}
/** Gate + an authorized plan with requirements: what a PR/PO needs. */
export function poGate(projectId: number): Gate {
  const g = procurementGate(projectId);
  if (!g.ok) return g;
  const n = one<{ c: number }>("SELECT COUNT(*) c FROM material_requirements WHERE project_id = ?", projectId)!.c;
  if (!n) g.reasons.push({ code: "NO_REQUIREMENTS", message: "No procurement requirement exists. Authorize procurement to create the plan from the approved BOQ." });
  g.ok = g.reasons.length === 0;
  return g;
}
export function assertGate(g: Gate) {
  if (g.ok) return;
  const r = g.reasons[0];
  throw new Error(`Procurement locked — ${r.message}${r.required ? ` Required ${r.required}, received ${r.received}.` : ""}`);
}

/** Called after every customer payment: when the required advance is first satisfied, unlock procurement. */
export function onCustomerPayment(projectId: number) {
  const order = one<any>("SELECT * FROM customer_orders WHERE project_id = ?", projectId);
  if (!order) return;
  const g = procurementGate(projectId);
  if (!g.ok) return;
  const z = require("./zoho") as typeof import("./zoho");
  if (!one("SELECT 1 FROM zoho_sync_events WHERE event_type = 'ADVANCE_RECEIVED' AND entity_id = ?", projectId))
    z.emitEvent("ADVANCE_RECEIVED", "project", projectId, g.project.code, { required_pct: g.requiredPct, received_pct: g.receivedPct });
  if (!one("SELECT 1 FROM procurement_plans WHERE project_id = ?", projectId))
    (require("../automation") as typeof import("../automation")).fire("payment.advance_received", { project_id: projectId, project_code: g.project.code, link: `/procurement/plans/${projectId}` });
}

/* ───────── procurement plan ───────── */
export const STAGE_TEMPLATES: Record<string, { name: string; cats: string[]; lead: number }[]> = {
  "3-stage": [
    { name: "Stage 1 — Structure & early installation materials", cats: ["Structure"], lead: 8 },
    { name: "Stage 2 — Panels & major equipment", cats: ["Panels", "Inverters"], lead: 5 },
    { name: "Stage 3 — Cables, electrical & protection", cats: ["Cables", "Electrical"], lead: 2 },
  ],
  "2-stage": [
    { name: "Stage 1 — Structure, cables & electrical", cats: ["Structure", "Cables", "Electrical"], lead: 7 },
    { name: "Stage 2 — Panels & inverters", cats: ["Panels", "Inverters"], lead: 4 },
  ],
  single: [{ name: "Single delivery — all materials", cats: [], lead: 4 }],
};

export function authorizeProcurement(projectId: number, actor: Actor, template = "3-stage") {
  const ex = one<any>("SELECT * FROM procurement_plans WHERE project_id = ?", projectId);
  if (ex) return ex;
  createCustomerOrder(projectId, actor);
  const g = procurementGate(projectId);
  assertGate(g);
  const p = g.project;
  const stages = STAGE_TEMPLATES[template] ?? STAGE_TEMPLATES["3-stage"];
  const start = p.start_date ?? today();
  const target = one<any>("SELECT due_date FROM project_milestones WHERE project_id = ? AND stage = 'INSTALLATION'", projectId)?.due_date ?? dateOnly(addDays(parseSql(start) ?? now(), 55));
  const cur = p.proposal_id ? getProposal(p.proposal_id) : null;
  if (!cur) throw new Error("Project has no approved proposal to plan from");
  const boq = all<any>("SELECT bi.* FROM boq_items bi JOIN boqs b ON b.id = bi.boq_id WHERE b.lead_id = ?", p.lead_id);

  const tx = db().transaction(() => {
    const planId = Number(run("INSERT INTO procurement_plans (project_id, status, start_date, target_install, template, authorized_by, authorized_at) VALUES (?, 'AUTHORIZED', ?,?,?,?,?)", projectId, start, target, template, actor.id, nowSql()).lastInsertRowid);
    const stageIds: number[] = [];
    stages.forEach((s, i) => {
      const req = dateOnly(addDays(parseSql(target) ?? now(), -s.lead));
      stageIds.push(Number(run("INSERT INTO procurement_stages (plan_id, name, required_date, sort, depends_on) VALUES (?,?,?,?,?)", planId, s.name, req, i, i > 0 ? stageIds[i - 1] : null).lastInsertRowid));
    });
    for (const it of cur.pricing.items) {
      if (/install|labou?r|commission|service|design/i.test(it.description)) continue; // in-house scope, not purchased
      const b = boq.find((x) => x.description === it.description);
      const cat = b?.category && b.category !== "Installation" ? b.category : guessCategory(it.description);
      let si = stages.findIndex((s) => s.cats.includes(cat));
      if (si < 0) si = stages.length === 1 ? 0 : stages.length - 1;
      run("INSERT INTO material_requirements (project_id, plan_id, stage_id, category, name, spec, qty, unit, required_date, est_unit_cost, source) VALUES (?,?,?,?,?,?,?,?,?,?, 'BOQ')",
        projectId, planId, stageIds[si], cat, it.description, it.spec ?? null, it.qty, it.unit, dateOnly(addDays(parseSql(target) ?? now(), -stages[si].lead)), b ? b.unit_cost : Math.round(it.rate * 0.85));
    }
    return planId;
  });
  const planId = tx();
  plog(actor, { project_id: projectId, type: "procurement_authorized", summary: `Procurement authorized — ${template} plan created from the approved BOQ` });
  audit(actor, "authorized procurement", "project", p.code);
  notify({ role: "procurement", type: "task_assigned", title: `Procurement unlocked for ${p.code}`, body: `${p.customer_name} — plan ready, raise purchase requests.`, link: `/procurement/plans/${projectId}` });
  return one("SELECT * FROM procurement_plans WHERE id = ?", planId);
}

export function addStage(planId: number, name: string, requiredDate: string, actor: Actor) {
  if (!name.trim()) throw new Error("Stage name is required");
  const sort = one<{ m: number }>("SELECT COALESCE(MAX(sort),-1)+1 m FROM procurement_stages WHERE plan_id = ?", planId)!.m;
  const prev = one<any>("SELECT id FROM procurement_stages WHERE plan_id = ? ORDER BY sort DESC LIMIT 1", planId);
  run("INSERT INTO procurement_stages (plan_id, name, required_date, sort, depends_on) VALUES (?,?,?,?,?)", planId, name.trim(), requiredDate || null, sort, prev?.id ?? null);
  const plan = one<any>("SELECT project_id FROM procurement_plans WHERE id = ?", planId);
  plog(actor, { project_id: plan.project_id, type: "stage_added", summary: `Procurement stage added: ${name}` });
}
export function moveRequirement(reqId: number, stageId: number, actor: Actor) {
  const r = one<any>("SELECT * FROM material_requirements WHERE id = ?", reqId);
  const st = one<any>("SELECT * FROM procurement_stages WHERE id = ? AND plan_id = ?", stageId, r.plan_id);
  if (!st) throw new Error("Stage does not belong to this plan");
  run("UPDATE material_requirements SET stage_id = ?, required_date = COALESCE(?, required_date) WHERE id = ?", stageId, st.required_date, reqId);
  plog(actor, { project_id: r.project_id, type: "requirement_moved", summary: `${r.name} moved to ${st.name}` });
}

/* ───────── requirement rollup (one row per required material) ───────── */
export interface ReqRow {
  id: number; project_id: number; stage_id: number; stage_name: string; category: string; name: string; spec: string | null; qty: number; unit: string; required_date: string | null; est_unit_cost: number;
  ordered: number; requested_open: number; received: number; accepted: number; issued: number; consumed: number; returned: number; damaged: number; rejected: number;
  store: number; site: number; balance: number; vendor_names: string | null; po_codes: string | null; status: string; delayed: number;
}
export function requirementRows(projectId: number): ReqRow[] {
  const rows = all<any>(
    `SELECT r.*, s.name stage_name,
      COALESCE((SELECT SUM(i.qty) FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = r.id AND o.status NOT IN ('CANCELLED','REJECTED')),0) ordered,
      COALESCE((SELECT SUM(q.qty) FROM purchase_requests q WHERE q.requirement_id = r.id AND q.status = 'OPEN'),0) requested_open,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'RECEIVED'),0) received,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'ACCEPTED'),0) accepted,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'ISSUED'),0) issued,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'CONSUMED'),0) consumed,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'RETURNED'),0) returned,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'DAMAGED'),0) damaged,
      COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'REJECTED'),0) rejected,
      COALESCE((SELECT SUM(t.store_delta) FROM inventory_transactions t WHERE t.requirement_id = r.id),0) store,
      COALESCE((SELECT SUM(t.site_delta) FROM inventory_transactions t WHERE t.requirement_id = r.id),0) site,
      (SELECT GROUP_CONCAT(DISTINCT v.name) FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id JOIN vendors v ON v.id = o.vendor_id WHERE i.requirement_id = r.id AND o.status NOT IN ('CANCELLED','REJECTED')) vendor_names,
      (SELECT GROUP_CONCAT(DISTINCT o.code) FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = r.id AND o.status NOT IN ('CANCELLED','REJECTED')) po_codes
     FROM material_requirements r LEFT JOIN procurement_stages s ON s.id = r.stage_id WHERE r.project_id = ? ORDER BY s.sort, r.id`, projectId);
  const delayedReq = new Set<number>((require("./intel") as typeof import("./intel")).itemLines({ project_id: projectId }).filter((l: any) => l.status === "DELAYED").map((l: any) => l.requirement_id));
  return rows.map((r) => {
    const got = r.received;
    const status = got >= r.qty - 1e-9 ? "RECEIVED" : delayedReq.has(r.id) ? "DELAYED" : got > 0 ? "PARTIALLY_RECEIVED" : r.ordered > 0 ? "ORDERED" : r.requested_open > 0 ? "REQUESTED" : "NOT_ORDERED";
    return { ...r, balance: Math.max(0, r.qty - got), status, delayed: delayedReq.has(r.id) ? 1 : 0 };
  });
}

/* ───────── purchase requests ───────── */
export const PRIORITIES = ["NORMAL", "HIGH", "URGENT", "CRITICAL"] as const;

function orderableQty(reqId: number) {
  const r = one<any>("SELECT * FROM material_requirements WHERE id = ?", reqId);
  const ordered = one<{ s: number }>("SELECT COALESCE(SUM(i.qty),0) s FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = ? AND o.status NOT IN ('CANCELLED','REJECTED')", reqId)!.s;
  const open = one<{ s: number }>("SELECT COALESCE(SUM(qty),0) s FROM purchase_requests WHERE requirement_id = ? AND status = 'OPEN'", reqId)!.s;
  return { r, ordered, open, free: r.qty - ordered - open };
}

export function createPurchaseRequest(d: { project_id: number; requirement_id: number; qty: number; required_by?: string; priority?: string; preferred_vendor_id?: number | null; notes?: string; stage_id?: number }, actor: Actor) {
  assertGate(poGate(d.project_id));
  const { r, free } = orderableQty(d.requirement_id);
  if (!r || r.project_id !== d.project_id) throw new Error("That material isn't part of this project's requirement");
  if (!(d.qty > 0)) throw new Error("Quantity must be positive");
  if (d.qty > free + 1e-9) throw new Error(`Only ${free} ${r.unit} of ${r.name} is left to request (required ${r.qty}, already ordered/requested ${r.qty - free}).`);
  const pr = PRIORITIES.includes(d.priority as any) ? d.priority! : "NORMAL";
  const code = nextCode("PR");
  run("INSERT INTO purchase_requests (code, project_id, stage_id, requirement_id, material, spec, category, qty, unit, required_by, priority, preferred_vendor_id, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    code, d.project_id, d.stage_id ?? r.stage_id, r.id, r.name, r.spec, r.category, d.qty, r.unit, d.required_by || r.required_date, pr, d.preferred_vendor_id ?? null, d.notes ?? null, actor.id, nowSql());
  plog(actor, { project_id: d.project_id, type: "purchase_request", summary: `Purchase request ${code}: ${d.qty} ${r.unit} ${r.name} (${pr})` });
  return code;
}
export function createRequestsForStage(stageId: number, actor: Actor): number {
  const st = one<any>("SELECT s.*, p.project_id FROM procurement_stages s JOIN procurement_plans p ON p.id = s.plan_id WHERE s.id = ?", stageId);
  assertGate(poGate(st.project_id));
  let n = 0;
  for (const r of all<any>("SELECT id FROM material_requirements WHERE stage_id = ?", stageId)) {
    const { free } = orderableQty(r.id);
    if (free > 1e-9) { createPurchaseRequest({ project_id: st.project_id, requirement_id: r.id, qty: free, stage_id: stageId }, actor); n++; }
  }
  return n;
}
export function cancelRequest(id: number, actor: Actor) {
  const q = one<any>("SELECT * FROM purchase_requests WHERE id = ?", id);
  if (q.status !== "OPEN") throw new Error("Only open requests can be cancelled");
  run("UPDATE purchase_requests SET status = 'CANCELLED' WHERE id = ?", id);
  plog(actor, { project_id: q.project_id, type: "purchase_request_cancelled", summary: `Purchase request ${q.code} cancelled` });
}

/* ───────── vendors ───────── */
export function saveVendor(id: number | null, d: { name: string; contact?: string; phone?: string; email?: string; address?: string; city?: string; gstin?: string; categories: string[]; products?: string; payment_terms?: string; active?: boolean }, actor: Actor) {
  if (!d.name.trim()) throw new Error("Vendor name is required");
  if (d.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/i.test(d.gstin.trim())) throw new Error("GSTIN doesn't look valid (15 characters)");
  const cats = d.categories.join(",");
  if (id) {
    run("UPDATE vendors SET name=?, contact=?, phone=?, email=?, address=?, city=?, gstin=?, categories=?, category=?, products=?, payment_terms=?, active=? WHERE id=?",
      d.name.trim(), d.contact ?? null, d.phone ?? null, d.email ?? null, d.address ?? null, d.city ?? null, d.gstin?.trim().toUpperCase() ?? null, cats, d.categories[0] ?? null, d.products ?? null, d.payment_terms ?? null, d.active === false ? 0 : 1, id);
    audit(actor, "edited vendor", "vendor", id);
    return id;
  }
  const code = nextCode("VEN");
  const nid = Number(run("INSERT INTO vendors (code, name, contact, phone, email, address, city, gstin, categories, category, products, payment_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    code, d.name.trim(), d.contact ?? null, d.phone ?? null, d.email ?? null, d.address ?? null, d.city ?? null, d.gstin?.trim().toUpperCase() ?? null, cats, d.categories[0] ?? null, d.products ?? null, d.payment_terms ?? null).lastInsertRowid);
  audit(actor, "created vendor", "vendor", code);
  return nid;
}

export { usersByRole };
