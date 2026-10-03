// Procurement intelligence: derived statuses (nobody updates a status by hand), delay detection,
// project-impact risk, health, exceptions/alerts, vendor performance, cost control, analytics.
import { nextCode } from "../../db";
import { addDays, dateOnly, parseSql, inr, fmtDate } from "../../util";
import { now, nowSql, today } from "../../clock";
import { audit, notify, usersByRole, type Actor } from "../core";
import { fire } from "../automation";
import { all, one, run, r2, scopeSql, categoryInfo, type Viewer } from "./core";

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000);

/* ───────── item lines: one per PO line, with everything derived ───────── */
export type LineStatus = "DRAFT" | "AWAITING_APPROVAL" | "APPROVED" | "AWAITING_CONFIRMATION" | "ORDERED" | "IN_TRANSIT" | "DELAYED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "INSPECTED" | "ACKNOWLEDGED" | "REJECTED" | "CANCELLED";
export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface Line {
  id: number; po_id: number; po_code: string; po_status: string; po_total: number; po_paid: number; owner_id: number | null; owner_name: string | null; project_id: number; project_code: string; project_name: string; customer_name: string;
  capacity_kw: number | null; pm_id: number | null; city: string | null; vendor_id: number; vendor_name: string; requirement_id: number; category: string; description: string; spec: string | null; qty: number; unit: string; rate: number;
  required_date: string | null; sent_at: string | null; po_date: string | null; conf_status: string | null; original_expected: string | null; expected_date: string | null; promise_count: number; accepted: number; received: number;
  pending_inspection: number; inflight: number; in_transit: number; damaged: number; rejected: number; short: number; unacked: number; first_received: string | null; last_received: string | null;
  target: number; remaining: number; status: LineStatus; live: boolean; delay_days: number; total_delay: number; actual_date: string | null; health: "ON_TRACK" | "AT_RISK" | "DELAYED" | "DONE" | "NA"; value: number;
}

export function itemLines(o: { project_id?: number; po_id?: number; vendor_id?: number; viewer?: Viewer } = {}): Line[] {
  const w: string[] = ["1=1"]; const a: any[] = [];
  if (o.project_id) { w.push("o.project_id = ?"); a.push(o.project_id); }
  if (o.po_id) { w.push("o.id = ?"); a.push(o.po_id); }
  if (o.vendor_id) { w.push("o.vendor_id = ?"); a.push(o.vendor_id); }
  const sc = scopeSql(o.viewer, "o.project_id"); w.push(sc.sql); a.push(...sc.args);
  const D = (cond: string, col: string) => `COALESCE((SELECT SUM(${col}) FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE di.po_item_id = i.id AND ${cond}),0)`;
  const rows = all<any>(`SELECT i.*, o.code po_code, o.status po_status, o.total po_total, o.owner_id, o.project_id, o.vendor_id, o.sent_at, o.po_date, u.name owner_name,
      p.code project_code, p.name project_name, p.capacity_kw, p.pm_id, p.city, c.name customer_name, v.name vendor_name,
      COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE po_id = o.id),0) po_paid,
      (SELECT status FROM vendor_confirmations WHERE po_item_id = i.id ORDER BY id DESC LIMIT 1) conf_status,
      (SELECT confirmed_qty FROM vendor_confirmations WHERE po_item_id = i.id ORDER BY id DESC LIMIT 1) conf_qty,
      (SELECT promised_date FROM vendor_delivery_updates WHERE po_item_id = i.id ORDER BY seq ASC LIMIT 1) original_expected,
      (SELECT promised_date FROM vendor_delivery_updates WHERE po_item_id = i.id ORDER BY seq DESC LIMIT 1) expected_date,
      (SELECT COUNT(*) FROM vendor_delivery_updates WHERE po_item_id = i.id) promise_count,
      COALESCE((SELECT SUM(qty_accepted) FROM delivery_items WHERE po_item_id = i.id),0) accepted,
      ${D("d.status IN ('RECEIVED','INSPECTED','ACKNOWLEDGED','CLOSED')", "di.qty_received")} received,
      ${D("d.status = 'RECEIVED'", "di.qty_received")} pending_inspection,
      ${D("d.status IN ('PLANNED','READY_FOR_DISPATCH','IN_TRANSIT')", "di.qty_dispatched")} inflight,
      ${D("d.status = 'IN_TRANSIT'", "di.qty_dispatched")} in_transit,
      COALESCE((SELECT SUM(qty_damaged) FROM delivery_items WHERE po_item_id = i.id),0) damaged,
      COALESCE((SELECT SUM(qty_rejected) FROM delivery_items WHERE po_item_id = i.id),0) rejected,
      ${D("d.status IN ('RECEIVED','INSPECTED','ACKNOWLEDGED','CLOSED')", "di.qty_short")} short,
      ${D("d.status = 'INSPECTED'", "di.qty_accepted")} unacked,
      (SELECT MIN(d.received_at) FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE di.po_item_id = i.id AND d.received_at IS NOT NULL) first_received,
      (SELECT MAX(d.received_at) FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE di.po_item_id = i.id AND d.received_at IS NOT NULL) last_received
    FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN projects p ON p.id = o.project_id
    LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN vendors v ON v.id = o.vendor_id WHERE ${w.join(" AND ")} ORDER BY o.id DESC, i.id`, ...a);
  const t = today();
  return rows.map((r) => deriveLine(r, t));
}

function deriveLine(r: any, t: string): Line {
  const target = r.conf_status == null ? r.qty : r.conf_status === "REJECTED" ? 0 : r.conf_qty;
  const remaining = Math.max(0, target - r.accepted - r.pending_inspection);
  const done = target > 0 && r.accepted >= target - 1e-9;
  const delayed = remaining > 1e-9 && !!r.expected_date && r.expected_date < t;
  let status: LineStatus;
  if (r.po_status === "DRAFT") status = "DRAFT";
  else if (r.po_status === "PENDING_APPROVAL") status = "AWAITING_APPROVAL";
  else if (r.po_status === "APPROVED") status = "APPROVED";
  else if (r.po_status === "CANCELLED") status = "CANCELLED";
  else if (r.po_status === "REJECTED" || r.conf_status === "REJECTED") status = "REJECTED";
  else if (r.po_status === "SENT" && r.conf_status == null) status = "AWAITING_CONFIRMATION";
  else if (done) status = r.unacked > 0 ? "INSPECTED" : "ACKNOWLEDGED";
  else if (remaining <= 1e-9 && r.pending_inspection > 0) status = "RECEIVED";
  else if (delayed) status = "DELAYED";
  else if (r.accepted + r.pending_inspection > 0) status = "PARTIALLY_RECEIVED";
  else if (r.in_transit > 0) status = "IN_TRANSIT";
  else status = "ORDERED";
  const live = ["AWAITING_CONFIRMATION", "ORDERED", "IN_TRANSIT", "DELAYED", "PARTIALLY_RECEIVED", "RECEIVED", "INSPECTED"].includes(status);
  const delay_days = status === "DELAYED" ? dayDiff(t, r.expected_date) : 0;
  const actual_date = r.first_received ? dateOnly(parseSql(r.first_received)!) : null;
  const total_delay = r.original_expected ? Math.max(0, dayDiff(actual_date ?? (remaining > 0 ? t : r.original_expected), r.original_expected)) : 0;
  let health: Line["health"] = "NA";
  if (["ACKNOWLEDGED", "INSPECTED", "REJECTED", "CANCELLED", "DRAFT", "AWAITING_APPROVAL", "APPROVED"].includes(status)) health = ["ACKNOWLEDGED", "INSPECTED"].includes(status) ? "DONE" : "NA";
  else if (status === "DELAYED") health = "DELAYED";
  else {
    const hrs = r.sent_at ? (now().getTime() - parseSql(r.sent_at)!.getTime()) / 3600000 : 0;
    const late = r.expected_date && r.required_date && r.expected_date > r.required_date;
    const soon = remaining > 0 && r.required_date && dayDiff(r.required_date, t) <= 2 && dayDiff(r.required_date, t) >= 0;
    health = (status === "AWAITING_CONFIRMATION" && hrs > 12) || late || soon || r.damaged + r.rejected + r.short > 0 && remaining > 0 ? "AT_RISK" : "ON_TRACK";
  }
  return { ...r, target, remaining, status, live, delay_days, total_delay, actual_date, health, value: r.qty * r.rate } as Line;
}

/* ───────── project impact & risk ───────── */
export interface Impact { line: Line; delayDays: number; criticality: string; milestone: string | null; milestoneDue: string | null; daysToDeadline: number | null; risk: Risk; score: number }
const milestoneCache = new Map<string, any>();
export function impactOf(l: Line): Impact {
  const cat = categoryInfo(l.category);
  const key = `${l.project_id}:${cat.milestone_stage}`;
  let m = milestoneCache.get(key);
  if (m === undefined || milestoneCache.size > 500) {
    if (milestoneCache.size > 500) milestoneCache.clear();
    m = (cat.milestone_stage ? one<any>("SELECT name, due_date, status FROM project_milestones WHERE project_id = ? AND stage = ?", l.project_id, cat.milestone_stage) : null) ?? one<any>("SELECT NULL name, target_end due_date FROM projects WHERE id = ?", l.project_id) ?? null;
    milestoneCache.set(key, m);
  }
  const t = today();
  const slip = l.required_date && l.expected_date ? Math.max(0, dayDiff(l.expected_date, l.required_date)) : 0;
  const delayDays = l.status === "DELAYED" ? Math.max(l.delay_days, slip) : slip;
  const dl = m?.due_date ? dayDiff(m.due_date, t) : null;
  const pDelay = delayDays === 0 ? 0 : delayDays <= 2 ? 1 : delayDays <= 5 ? 2 : 3;
  const pCrit = ({ low: 0, medium: 1, high: 2, critical: 3 } as any)[cat.criticality] ?? 1;
  const pDead = dl == null ? 0 : dl <= 3 ? 3 : dl <= 7 ? 2 : dl <= 14 ? 1 : 0;
  const pDep = delayDays > 0 && m?.status && m.status !== "DONE" ? 1 : 0;
  const score = delayDays === 0 ? 0 : pDelay + pCrit + pDead + pDep;
  const risk: Risk = score >= 8 ? "CRITICAL" : score >= 6 ? "HIGH" : score >= 4 ? "MEDIUM" : "LOW";
  return { line: l, delayDays, criticality: cat.criticality, milestone: m?.name ?? null, milestoneDue: m?.due_date ?? null, daysToDeadline: dl, risk, score };
}
export function projectImpacts(projectId: number): Impact[] {
  return itemLines({ project_id: projectId }).filter((l) => l.live && (l.status === "DELAYED" || (l.expected_date && l.required_date && l.expected_date > l.required_date))).map(impactOf).sort((a, b) => b.score - a.score);
}
const RISK_SEV: Record<Risk, string> = { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };

/* ───────── exceptions & alerts ───────── */
export const EXCEPTION_TYPES: Record<string, string> = { VENDOR_DELAY: "Vendor delay", PAYMENT_PENDING: "Payment pending", QUANTITY_SHORTAGE: "Quantity shortage", DAMAGED_MATERIAL: "Damaged material", WRONG_SPECIFICATION: "Wrong specification", PO_REJECTION: "PO rejection", PROJECT_IMPACT: "Project impact", MATERIAL_VARIANCE: "Material variance" };

export function addAlert(a: { key: string; type: string; title: string; body?: string; project_id?: number | null; po_id?: number | null; link?: string; severity?: string; roles?: string[]; pm?: number | null; md?: boolean }): boolean {
  const r = run("INSERT OR IGNORE INTO procurement_alerts (key, type, title, body, project_id, po_id, link, severity, created_at) VALUES (?,?,?,?,?,?,?,?,?)", a.key, a.type, a.title, a.body ?? null, a.project_id ?? null, a.po_id ?? null, a.link ?? null, a.severity ?? "medium", nowSql());
  if (!r.changes) return false;
  for (const role of a.roles ?? ["procurement"]) notify({ role: role as any, type: a.type === "SHORTAGE" ? "material_shortage" : a.type === "DAMAGE" ? "material_damage" : "delivery_delay", title: a.title, body: a.body, link: a.link });
  if (a.pm) notify({ userId: a.pm, type: "delivery_delay", title: a.title, body: a.body, link: a.link });
  if (a.md) notify({ role: "md", type: "delivery_delay", title: a.title, body: a.body, link: a.link });
  return true;
}

export function raiseException(o: { key: string; type: string; severity: string; project_id?: number | null; po_id?: number | null; requirement_id?: number | null; material?: string; vendor_id?: number | null; owner_id?: number | null; due_date?: string; detail?: string; alert?: { type: string; title: string; roles?: string[]; pm?: number | null } }): boolean {
  const ex = one<any>("SELECT * FROM procurement_exceptions WHERE key = ?", o.key);
  if (ex) {
    if (ex.status === "RESOLVED") run("UPDATE procurement_exceptions SET status = 'OPEN', resolution = NULL, resolved_at = NULL, severity = ?, detail = ? WHERE id = ?", o.severity, o.detail ?? ex.detail, ex.id);
    else if (ex.severity !== o.severity || (o.detail && ex.detail !== o.detail)) run("UPDATE procurement_exceptions SET severity = ?, detail = COALESCE(?, detail) WHERE id = ?", o.severity, o.detail ?? null, ex.id);
    return false;
  }
  const owner = o.owner_id ?? usersByRole("procurement")[0]?.id ?? null;
  const code = nextCode("EXC");
  const link = o.po_id ? `/procurement/${o.po_id}` : o.project_id ? `/procurement/plans/${o.project_id}` : "/procurement/exceptions";
  run("INSERT INTO procurement_exceptions (code, key, type, severity, project_id, po_id, requirement_id, material, vendor_id, owner_id, due_date, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    code, o.key, o.type, o.severity, o.project_id ?? null, o.po_id ?? null, o.requirement_id ?? null, o.material ?? null, o.vendor_id ?? null, owner, o.due_date ?? dateOnly(addDays(now(), o.severity === "critical" ? 1 : o.severity === "high" ? 2 : 5)), o.detail ?? null, nowSql());
  if (o.alert) addAlert({ key: `alert:${o.key}`, type: o.alert.type, title: o.alert.title, body: o.detail, project_id: o.project_id, po_id: o.po_id, link, severity: o.severity, roles: o.alert.roles, pm: o.alert.pm, md: ["high", "critical"].includes(o.severity) });
  if (["critical", "high"].includes(o.severity)) notify({ role: "md", type: "delivery_delay", title: `${EXCEPTION_TYPES[o.type] ?? o.type}: ${o.material ?? ""}`, body: o.detail, link });
  return true;
}
export function resolveException(id: number, resolution: string, actor: Actor) {
  if (!resolution.trim()) throw new Error("Describe how it was resolved");
  const e = one<any>("SELECT * FROM procurement_exceptions WHERE id = ?", id);
  if (!e || e.status === "RESOLVED") throw new Error("Exception is already resolved");
  run("UPDATE procurement_exceptions SET status = 'RESOLVED', resolution = ?, resolved_at = ? WHERE id = ?", resolution.trim(), nowSql(), id);
  audit(actor, "resolved procurement exception", "procurement_exception", e.code, "OPEN", "RESOLVED");
}

let lastTick = 0;
/** Idempotent scan: delays, project impact, confirmations overdue, payments, inspections. Cheap enough to run on page loads (throttled). */
export function procurementTick(force = false) {
  if (!force && Date.now() - lastTick < 45_000) return;
  lastTick = Date.now();
  const t = today();
  const lines = itemLines().filter((l) => l.live || l.po_status === "SENT");
  const stillDelayed = new Set<number>(), stillImpact = new Set<number>();
  for (const l of lines) {
    const link = `/procurement/${l.po_id}`;
    if (l.status === "DELAYED") {
      stillDelayed.add(l.id);
      const im = impactOf(l);
      raiseException({ key: `delay:${l.id}`, type: "VENDOR_DELAY", severity: RISK_SEV[im.risk], project_id: l.project_id, po_id: l.po_id, requirement_id: l.requirement_id, material: l.description, vendor_id: l.vendor_id, detail: `${l.vendor_name}: expected ${fmtDate(l.expected_date)}, ${l.delay_days} day${l.delay_days > 1 ? "s" : ""} late` });
      const fresh = addAlert({ key: `alert:overdue:${l.id}:${l.expected_date}`, type: "OVERDUE", title: `Delivery overdue: ${l.description}`, body: `Expected ${l.expected_date}, today ${t} — DELAYED (${l.project_code})`, project_id: l.project_id, po_id: l.po_id, link, severity: RISK_SEV[im.risk], roles: [], pm: null, md: false });
      if (fresh) fire("delivery.overdue", { po_id: l.po_id, project_id: l.project_id, pm_id: l.pm_id, title: l.description, expected: l.expected_date ?? "", days: l.delay_days, risk: im.risk, critical: ["HIGH", "CRITICAL"].includes(im.risk) ? 1 : 0, link });
    }
    const im = l.live ? impactOf(l) : null;
    if (im && im.delayDays > 0 && (im.risk === "HIGH" || im.risk === "CRITICAL")) {
      stillImpact.add(l.id);
      raiseException({ key: `impact:${l.id}`, type: "PROJECT_IMPACT", severity: RISK_SEV[im.risk], project_id: l.project_id, po_id: l.po_id, requirement_id: l.requirement_id, material: l.description, vendor_id: l.vendor_id, owner_id: l.pm_id,
        detail: `${l.description} is ${im.delayDays}d late; ${im.milestone ?? "project completion"} due in ${im.daysToDeadline ?? "?"}d (risk ${im.risk})`,
        alert: { type: "IMPACT", title: `Material delay affecting ${im.milestone ?? "project"}: ${l.description}`, roles: ["procurement"], pm: l.pm_id } });
    }
    if (l.status === "AWAITING_CONFIRMATION" && l.sent_at) {
      const hrs = Math.floor((now().getTime() - parseSql(l.sent_at)!.getTime()) / 3600000);
      if (hrs >= 12) addAlert({ key: `alert:conf:${l.po_id}`, type: "CONFIRMATION", title: `PO ${l.po_code} not confirmed — sent ${hrs}h ago`, body: `${l.vendor_name}: vendor confirmation pending`, project_id: l.project_id, po_id: l.po_id, link, severity: hrs > 24 ? "high" : "medium", roles: ["procurement"] });
    }
  }
  // payment pending: confirmed >2 days ago and unpaid
  for (const po of all<any>(`SELECT o.*, v.name vname, (SELECT MIN(at) FROM vendor_confirmations WHERE po_id = o.id) conf_at, COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE po_id = o.id),0) paid
      FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id WHERE o.status IN ('VENDOR_CONFIRMED','PARTIALLY_CONFIRMED')`)) {
    const key = `pay:${po.id}`;
    const days = po.conf_at ? dayDiff(t, po.conf_at) : 0;
    if (po.total - po.paid > 0.5 && days >= 2) raiseException({ key, type: "PAYMENT_PENDING", severity: days > 5 ? "high" : "medium", project_id: po.project_id, po_id: po.id, material: po.code, vendor_id: po.vendor_id, detail: `${inr(po.total - po.paid)} payable to ${po.vname}, confirmed ${days}d ago` });
    else if (po.total - po.paid <= 0.5) autoResolve(key, "Paid in full");
  }
  // inspection pending > 24h
  for (const d of all<any>("SELECT d.*, o.code po_code FROM deliveries d JOIN purchase_orders o ON o.id = d.po_id WHERE d.status = 'RECEIVED'")) {
    const hrs = Math.floor((now().getTime() - parseSql(d.received_at)!.getTime()) / 3600000);
    if (hrs >= 24) addAlert({ key: `alert:insp:${d.id}`, type: "INSPECTION", title: `Inspection pending ${hrs}h — ${d.code}`, body: d.po_code, project_id: d.project_id, po_id: d.po_id, link: `/procurement/deliveries/${d.id}`, severity: "medium", roles: ["procurement"], pm: one<any>("SELECT pm_id FROM projects WHERE id = ?", d.project_id)?.pm_id });
  }
  for (const e of all<any>("SELECT * FROM procurement_exceptions WHERE status = 'OPEN' AND (key LIKE 'delay:%' OR key LIKE 'impact:%')")) {
    const id = Number(e.key.split(":")[1]);
    if (e.key.startsWith("delay:") && !stillDelayed.has(id)) autoResolve(e.key, "Auto: delivered or rescheduled");
    if (e.key.startsWith("impact:") && !stillImpact.has(id)) autoResolve(e.key, "Auto: no longer at risk");
  }
}
function autoResolve(key: string, why: string) {
  run("UPDATE procurement_exceptions SET status = 'RESOLVED', resolution = ?, resolved_at = ? WHERE key = ? AND status = 'OPEN'", why, nowSql(), key);
}

/* ───────── control tower ───────── */
export function health(lines: Line[]) {
  const live = lines.filter((l) => l.live && !["INSPECTED"].includes(l.status));
  const d = live.filter((l) => l.health === "DELAYED").length, r = live.filter((l) => l.health === "AT_RISK").length, n = live.length;
  const ok = n - d - r;
  return { total: n, onTrack: ok, atRisk: r, delayed: d, pct: n ? Math.round((ok / n) * 100) : 100, pctRisk: n ? Math.round((r / n) * 100) : 0, pctDelayed: n ? Math.round((d / n) * 100) : 0 };
}

export function towerKpis(lines: Line[], viewer?: Viewer) {
  const t = today();
  const scope = scopeSql(viewer, "o.project_id");
  const pos = all<any>(`SELECT o.*, COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE po_id = o.id),0) paid FROM purchase_orders o WHERE ${scope.sql}`, ...scope.args);
  const committed = pos.filter((p) => !["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].includes(p.status));
  const openPos = committed.filter((p) => lines.some((l) => l.po_id === p.id && !["INSPECTED", "ACKNOWLEDGED", "REJECTED"].includes(l.status)));
  const payPending = committed.filter((p) => ["VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(p.status) && p.total - p.paid > 0.5);
  const dsc = scopeSql(viewer, "d.project_id");
  const inTransit = one<{ c: number }>(`SELECT COUNT(*) c FROM deliveries d WHERE d.status = 'IN_TRANSIT' AND ${dsc.sql}`, ...dsc.args)!.c;
  const receivedToday = one<{ c: number }>(`SELECT COUNT(*) c FROM deliveries d WHERE substr(d.received_at,1,10) = ? AND ${dsc.sql}`, t, ...dsc.args)!.c;
  const inspPending = one<{ c: number }>(`SELECT COUNT(*) c FROM deliveries d WHERE d.status = 'RECEIVED' AND ${dsc.sql}`, ...dsc.args)!.c;
  const dueToday = lines.filter((l) => l.live && l.remaining > 0 && l.expected_date === t).length;
  return {
    value: committed.reduce((a, p) => a + p.total, 0), openPos: openPos.length, awaitingConfirmation: pos.filter((p) => p.status === "SENT").length,
    awaitingApproval: pos.filter((p) => p.status === "PENDING_APPROVAL").length, drafts: pos.filter((p) => p.status === "DRAFT").length,
    paymentPending: payPending.length, paymentPendingAmount: payPending.reduce((a, p) => a + (p.total - p.paid), 0), payable: committed.reduce((a, p) => a + (p.total - p.paid), 0),
    inTransit, delayed: lines.filter((l) => l.status === "DELAYED").length, receivedToday, inspectionPending: inspPending, dueToday,
  };
}

/** Material position in ₹: where is the material, valued at PO rates (falling back to the BOQ estimate). */
export function materialPosition(lines: Line[], viewer?: Viewer) {
  const sc = scopeSql(viewer, "t.project_id");
  const led = all<any>(`SELECT t.type, SUM(t.qty * COALESCE((SELECT SUM(i.qty*i.rate)/SUM(i.qty) FROM purchase_order_items i WHERE i.requirement_id = t.requirement_id), r.est_unit_cost)) v
    FROM inventory_transactions t JOIN material_requirements r ON r.id = t.requirement_id WHERE ${sc.sql} GROUP BY t.type`, ...sc.args);
  const g = (k: string) => led.find((x) => x.type === k)?.v ?? 0;
  const sum = (f: (l: Line) => number) => lines.reduce((a, l) => a + f(l) * l.rate, 0);
  return { ordered: sum((l) => (["REJECTED", "CANCELLED", "DRAFT"].includes(l.status) ? 0 : l.target)), inTransit: sum((l) => l.inflight), received: g("RECEIVED"), underInspection: sum((l) => l.pending_inspection), accepted: g("ACCEPTED"),
    shortages: sum((l) => l.short), damaged: g("DAMAGED") + g("REJECTED"), issued: g("ISSUED"), consumed: g("CONSUMED"), returned: g("RETURNED") };
}

export interface ProjectProc { project_id: number; code: string; name: string; customer: string; capacity_kw: number | null; stage: string; poValue: number; receivedValue: number; pendingValue: number; pct: number; nextDelivery: string | null; delayedItems: number; health: "ON_TRACK" | "AT_RISK" | "DELAYED" | "NOT_STARTED"; lines: number }
export function projectOverview(lines: Line[], viewer?: Viewer): ProjectProc[] {
  const by = new Map<number, Line[]>();
  lines.filter((l) => !["DRAFT", "REJECTED", "CANCELLED"].includes(l.status)).forEach((l) => by.set(l.project_id, [...(by.get(l.project_id) ?? []), l]));
  const out: ProjectProc[] = [];
  for (const [pid, ls] of by) {
    const p = one<any>("SELECT p.*, c.name customer FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?", pid);
    const poValue = ls.reduce((a, l) => a + l.qty * l.rate, 0);
    const recv = ls.reduce((a, l) => a + Math.min(l.target, l.accepted + l.pending_inspection) * l.rate, 0);
    const next = ls.filter((l) => l.remaining > 0 && l.expected_date).map((l) => l.expected_date!).sort()[0] ?? null;
    const delayed = ls.filter((l) => l.status === "DELAYED").length;
    const health = delayed ? "DELAYED" : ls.some((l) => l.health === "AT_RISK") ? "AT_RISK" : "ON_TRACK";
    out.push({ project_id: pid, code: p.code, name: p.name, customer: p.customer, capacity_kw: p.capacity_kw, stage: p.stage, poValue, receivedValue: recv, pendingValue: poValue - recv, pct: poValue ? Math.round((recv / poValue) * 100) : 0, nextDelivery: next, delayedItems: delayed, health, lines: ls.length });
  }
  return out.sort((a, b) => (b.delayedItems - a.delayedItems) || (a.health === "AT_RISK" ? -1 : 0) - (b.health === "AT_RISK" ? -1 : 0) || b.poValue - a.poValue);
}

/** Projects waiting on something before procurement can begin. */
export function lockedProjects(viewer?: Viewer, limit = 8) {
  const sc = scopeSql(viewer, "p.id");
  const rows = all<any>(`SELECT p.id, p.code, p.name, c.name customer FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.stage IN ('PROJECT_CREATED','PLANNING','DESIGN') AND NOT EXISTS (SELECT 1 FROM procurement_plans pl WHERE pl.project_id = p.id) AND ${sc.sql} ORDER BY p.id DESC LIMIT 40`, ...sc.args);
  const core = require("./core") as typeof import("./core");
  return rows.map((p) => ({ ...p, gate: core.procurementGate(p.id) })).filter((p) => !p.gate.ok).slice(0, limit);
}
export function readyToAuthorize(viewer?: Viewer) {
  const sc = scopeSql(viewer, "p.id");
  const rows = all<any>(`SELECT p.id, p.code, p.name, c.name customer FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.stage NOT IN ('COMPLETED') AND NOT EXISTS (SELECT 1 FROM procurement_plans pl WHERE pl.project_id = p.id) AND ${sc.sql} ORDER BY p.id DESC LIMIT 60`, ...sc.args);
  const core = require("./core") as typeof import("./core");
  return rows.filter((p) => core.procurementGate(p.id).ok);
}

export function openExceptions(viewer?: Viewer, limit = 50) {
  const sc = scopeSql(viewer, "e.project_id");
  return all<any>(`SELECT e.*, p.code project_code, c.name customer_name, v.name vendor_name, u.name owner_name FROM procurement_exceptions e LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN users u ON u.id = e.owner_id WHERE e.status = 'OPEN' AND (e.project_id IS NULL OR ${sc.sql})
    ORDER BY CASE e.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, e.id DESC LIMIT ?`, ...sc.args, limit);
}
export function allExceptions(o: { status?: string; type?: string; viewer?: Viewer } = {}) {
  const w = ["1=1"]; const a: any[] = [];
  if (o.status) { w.push("e.status = ?"); a.push(o.status); }
  if (o.type) { w.push("e.type = ?"); a.push(o.type); }
  const sc = scopeSql(o.viewer, "e.project_id"); w.push(`(e.project_id IS NULL OR ${sc.sql})`); a.push(...sc.args);
  return all<any>(`SELECT e.*, p.code project_code, c.name customer_name, v.name vendor_name, u.name owner_name FROM procurement_exceptions e LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN users u ON u.id = e.owner_id WHERE ${w.join(" AND ")} ORDER BY e.status = 'RESOLVED', CASE e.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, e.id DESC LIMIT 300`, ...a);
}

/** The things that need a person right now (control-tower attention list). */
export function attentionList(lines: Line[], k: ReturnType<typeof towerKpis>, viewer?: Viewer) {
  const t = today();
  const exc = openExceptions(viewer, 200);
  const items = [
    { text: `${k.delayed} delayed deliver${k.delayed === 1 ? "y" : "ies"}`, n: k.delayed, href: "/procurement?view=delayed", tone: "bad" },
    { text: `${k.awaitingConfirmation} PO${k.awaitingConfirmation === 1 ? "" : "s"} awaiting vendor confirmation`, n: k.awaitingConfirmation, href: "/procurement?view=awaiting_confirmation", tone: "warn" },
    { text: `${k.awaitingApproval} PO${k.awaitingApproval === 1 ? "" : "s"} awaiting approval`, n: k.awaitingApproval, href: "/procurement/orders?status=PENDING_APPROVAL", tone: "warn" },
    { text: `${k.paymentPending} vendor payment${k.paymentPending === 1 ? "" : "s"} pending (${inr(k.paymentPendingAmount)})`, n: k.paymentPending, href: "/procurement?view=payment_pending", tone: "warn" },
    { text: `${k.dueToday} material${k.dueToday === 1 ? "" : "s"} expected today`, n: k.dueToday, href: "/procurement?view=due_today", tone: "info" },
    { text: `${exc.filter((e) => e.type === "PROJECT_IMPACT").length} project${exc.filter((e) => e.type === "PROJECT_IMPACT").length === 1 ? "" : "s"} at risk`, n: exc.filter((e) => e.type === "PROJECT_IMPACT").length, href: "/procurement/exceptions?type=PROJECT_IMPACT", tone: "bad" },
    { text: `${k.inspectionPending} inspection${k.inspectionPending === 1 ? "" : "s"} pending`, n: k.inspectionPending, href: "/procurement?view=inspection_pending", tone: "warn" },
    { text: `${exc.filter((e) => e.type === "MATERIAL_VARIANCE").length} material variance${exc.filter((e) => e.type === "MATERIAL_VARIANCE").length === 1 ? "" : "s"}`, n: exc.filter((e) => e.type === "MATERIAL_VARIANCE").length, href: "/procurement/exceptions?type=MATERIAL_VARIANCE", tone: "warn" },
  ];
  void t; void lines;
  return items.filter((i) => i.n > 0);
}

/* ───────── procurement table + saved views ───────── */
export const SAVED_VIEWS: { key: string; label: string }[] = [
  { key: "all", label: "All Procurement" }, { key: "mine", label: "My Procurement" }, { key: "delayed", label: "Delayed" }, { key: "due_today", label: "Due Today" }, { key: "due_week", label: "Due This Week" },
  { key: "awaiting_confirmation", label: "Awaiting Confirmation" }, { key: "payment_pending", label: "Payment Pending" }, { key: "partially_received", label: "Partially Received" },
  { key: "inspection_pending", label: "Inspection Pending" }, { key: "project_at_risk", label: "Project At Risk" }, { key: "completed", label: "Completed" },
];
const VIEW_PRED: Record<string, (l: Line, v?: Viewer) => boolean> = {
  all: () => true, mine: (l, v) => !!v && l.owner_id === v.id, open: (l) => l.live && !["INSPECTED"].includes(l.status), delayed: (l) => l.status === "DELAYED",
  due_today: (l) => l.live && l.remaining > 0 && l.expected_date === today(), due_week: (l) => l.live && l.remaining > 0 && !!l.expected_date && l.expected_date >= today() && l.expected_date <= dateOnly(addDays(now(), 7)),
  awaiting_confirmation: (l) => l.status === "AWAITING_CONFIRMATION", payment_pending: (l) => ["VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(l.po_status) && l.po_total - l.po_paid > 0.5 && l.live,
  partially_received: (l) => l.status === "PARTIALLY_RECEIVED", inspection_pending: (l) => l.pending_inspection > 0, in_transit: (l) => l.inflight > 0 && l.live,
  received_today: (l) => !!l.last_received && l.last_received.slice(0, 10) === today(), project_at_risk: (l) => l.live && l.health !== "ON_TRACK", completed: (l) => ["INSPECTED", "ACKNOWLEDGED"].includes(l.status),
};
export interface TableOpts { view?: string; q?: string; sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number; vendor?: number; project?: number; category?: string }
export function procurementTable(lines: Line[], o: TableOpts, viewer?: Viewer) {
  const pred = VIEW_PRED[o.view ?? "all"] ?? VIEW_PRED.all;
  const q = o.q?.trim().toLowerCase();
  let rows = lines.filter((l) => pred(l, viewer) && !(["DRAFT"].includes(l.status) && (o.view ?? "all") !== "all" && !["mine"].includes(o.view ?? "")));
  if (o.vendor) rows = rows.filter((l) => l.vendor_id === o.vendor);
  if (o.project) rows = rows.filter((l) => l.project_id === o.project);
  if (o.category) rows = rows.filter((l) => l.category === o.category);
  if (q) rows = rows.filter((l) => [l.po_code, l.project_code, l.project_name, l.customer_name, l.vendor_name, l.description, l.spec ?? ""].some((s) => s.toLowerCase().includes(q)));
  const key = o.sort ?? "po";
  const get = (l: Line): any => ({ po: l.po_code, project: l.project_code, customer: l.customer_name, vendor: l.vendor_name, material: l.description, value: l.value, ordered: l.qty, received: l.accepted + l.pending_inspection, expected: l.expected_date ?? "9999", actual: l.actual_date ?? "9999", delay: l.delay_days, status: l.status, owner: l.owner_name ?? "" } as any)[key];
  const dir = o.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => { const x = get(a), y = get(b); return x < y ? -dir : x > y ? dir : 0; });
  const pageSize = o.pageSize ?? 20, page = Math.max(1, o.page ?? 1);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pages: Math.max(1, Math.ceil(rows.length / pageSize)), all: rows };
}
export const viewCounts = (lines: Line[], viewer?: Viewer) => Object.fromEntries(SAVED_VIEWS.map((v) => [v.key, lines.filter((l) => (VIEW_PRED[v.key] ?? VIEW_PRED.all)(l, viewer) && (v.key === "all" || l.status !== "DRAFT")).length]));

export function toCsv(rows: Line[]) {
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["PO", "Project", "Customer", "Vendor", "Material", "PO Value", "Ordered", "Received", "Original Promise", "Current Promise", "Actual", "Delay Days", "Status", "Owner"];
  return [head.map(esc).join(","), ...rows.map((l) => [l.po_code, l.project_code, l.customer_name, l.vendor_name, l.description, l.value, l.qty, l.accepted + l.pending_inspection, l.original_expected, l.expected_date, l.actual_date, l.delay_days, l.status, l.owner_name].map(esc).join(","))].join("\n");
}

/* ───────── vendor performance (derived only — never a manual rating) ───────── */
export interface VendorStat { id: number; code: string; name: string; contact: string | null; phone: string | null; email: string | null; city: string | null; gstin: string | null; categories: string | null; products: string | null; payment_terms: string | null; active: number;
  pos: number; activePos: number; pendingPos: number; delayedPos: number; value: number; delivered: number; onTimePct: number | null; avgDelay: number | null; avgDeliveryDays: number | null; avgDateShift: number | null; qualityPct: number | null; rejectedQty: number; damagedQty: number; health: "GOOD" | "FAIR" | "POOR" | "NEW" }
export function vendorStats(lines?: Line[]): VendorStat[] {
  const L = lines ?? itemLines();
  return all<any>("SELECT * FROM vendors ORDER BY name").map((v) => {
    const ls = L.filter((l) => l.vendor_id === v.id);
    const poIds = new Set(ls.filter((l) => !["DRAFT", "REJECTED", "CANCELLED", "AWAITING_APPROVAL", "APPROVED"].includes(l.status)).map((l) => l.po_id));
    const delivered = ls.filter((l) => l.first_received && l.original_expected);
    const late = delivered.filter((l) => dayDiff(dateOnly(parseSql(l.first_received!)!), l.original_expected!) > 0);
    const onTimePct = delivered.length ? Math.round(((delivered.length - late.length) / delivered.length) * 100) : null;
    const avgDelay = delivered.length ? r2(delivered.reduce((a, l) => a + Math.max(0, dayDiff(dateOnly(parseSql(l.first_received!)!), l.original_expected!)), 0) / delivered.length) : null;
    const withSent = ls.filter((l) => l.sent_at && l.first_received);
    const avgDeliveryDays = withSent.length ? r2(withSent.reduce((a, l) => a + dayDiff(dateOnly(parseSql(l.first_received!)!), l.sent_at!), 0) / withSent.length) : null;
    const shifted = ls.filter((l) => l.promise_count > 0 && l.original_expected && l.expected_date);
    const avgDateShift = shifted.length ? r2(shifted.reduce((a, l) => a + dayDiff(l.expected_date!, l.original_expected!), 0) / shifted.length) : null;
    const recvQty = ls.reduce((a, l) => a + l.received, 0), bad = ls.reduce((a, l) => a + l.damaged + l.rejected, 0);
    const qualityPct = recvQty ? r2((bad / recvQty) * 100) : null;
    const delayedPos = new Set(ls.filter((l) => l.status === "DELAYED").map((l) => l.po_id)).size;
    const health = onTimePct == null ? "NEW" : onTimePct >= 85 && (qualityPct ?? 0) <= 3 ? "GOOD" : onTimePct >= 65 && (qualityPct ?? 0) <= 8 ? "FAIR" : "POOR";
    return { ...v, pos: poIds.size, activePos: new Set(ls.filter((l) => l.live).map((l) => l.po_id)).size, pendingPos: new Set(ls.filter((l) => l.status === "AWAITING_CONFIRMATION").map((l) => l.po_id)).size, delayedPos,
      value: [...poIds].reduce((a, id) => a + (ls.find((l) => l.po_id === id)?.po_total ?? 0), 0), delivered: delivered.length, onTimePct, avgDelay, avgDeliveryDays, avgDateShift, qualityPct,
      rejectedQty: ls.reduce((a, l) => a + l.rejected, 0), damagedQty: ls.reduce((a, l) => a + l.damaged, 0), health } as VendorStat;
  });
}

/* ───────── cost control ───────── */
export function costControl(projectId?: number, viewer?: Viewer) {
  const sc = scopeSql(viewer, "p.id");
  const projects = all<any>(`SELECT p.id, p.code, p.name, c.name customer, co.subtotal approved, co.order_value FROM projects p JOIN customer_orders co ON co.project_id = p.id LEFT JOIN customers c ON c.id = p.customer_id
    WHERE ${projectId ? "p.id = ? AND" : ""} ${sc.sql}`, ...(projectId ? [projectId] : []), ...sc.args);
  return projects.map((p) => {
    const reqs = all<any>("SELECT id, qty, est_unit_cost FROM material_requirements WHERE project_id = ?", p.id);
    const estimated = reqs.reduce((a, r) => a + r.qty * r.est_unit_cost, 0);
    let covered = 0, actual = 0;
    for (const r of reqs) {
      const o = one<any>("SELECT COALESCE(SUM(i.qty),0) q, COALESCE(SUM(i.qty*i.rate),0) v FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = ? AND o.status NOT IN ('DRAFT','CANCELLED','REJECTED')", r.id)!;
      covered += Math.min(o.q, r.qty) * r.est_unit_cost; actual += o.v;
    }
    const variance = actual - covered;
    const pct = covered ? r2((variance / covered) * 100) : 0;
    return { ...p, estimated, covered, actual, variance, pct, uncovered: estimated - covered, status: !covered ? "NOT_STARTED" : pct <= 0.5 ? "WITHIN_BUDGET" : pct <= 5 ? "AT_RISK" : "OVER_BUDGET" };
  });
}

/* ───────── analytics ───────── */
export function analyticsData(lines: Line[], viewer?: Viewer) {
  const delivered = lines.filter((l) => l.first_received && l.original_expected);
  const late = delivered.filter((l) => dayDiff(dateOnly(parseSql(l.first_received!)!), l.original_expected!) > 0);
  const sent = lines.filter((l) => l.sent_at && l.first_received);
  const recvQty = lines.reduce((a, l) => a + l.received, 0), accQty = lines.reduce((a, l) => a + l.accepted, 0), damQty = lines.reduce((a, l) => a + l.damaged, 0), shortQty = lines.reduce((a, l) => a + l.short, 0);
  const dispatched = one<{ s: number }>("SELECT COALESCE(SUM(qty_dispatched),0) s FROM delivery_items")!.s;
  const returned = one<{ s: number }>("SELECT COALESCE(SUM(qty),0) s FROM inventory_transactions WHERE type = 'RETURNED'")!.s;
  const conf = all<any>("SELECT o.sent_at, MIN(vc.at) at FROM purchase_orders o JOIN vendor_confirmations vc ON vc.po_id = o.id WHERE o.sent_at IS NOT NULL GROUP BY o.id");
  const cyc = all<any>("SELECT created_at, sent_at FROM purchase_orders WHERE sent_at IS NOT NULL");
  const hours = (a: string, b: string) => (parseSql(b)!.getTime() - parseSql(a)!.getTime()) / 3600000;
  const cost = costControl(undefined, viewer);
  const covered = cost.reduce((a, c) => a + c.covered, 0), actual = cost.reduce((a, c) => a + c.actual, 0);
  const monthly = all<any>("SELECT substr(po_date,1,7) m, SUM(total) v, COUNT(*) n FROM purchase_orders WHERE status NOT IN ('DRAFT','CANCELLED','REJECTED') AND po_date IS NOT NULL GROUP BY m ORDER BY m DESC LIMIT 8").reverse();
  const byCategory = all<any>("SELECT i.category cat, SUM(i.qty*i.rate) v FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE o.status NOT IN ('DRAFT','CANCELLED','REJECTED') GROUP BY i.category ORDER BY v DESC");
  const byProject = all<any>("SELECT p.code, p.name, SUM(o.total) v FROM purchase_orders o JOIN projects p ON p.id = o.project_id WHERE o.status NOT IN ('DRAFT','CANCELLED','REJECTED') GROUP BY p.id ORDER BY v DESC LIMIT 8");
  const variance = all<any>("SELECT e.*, p.code project_code FROM procurement_exceptions e LEFT JOIN projects p ON p.id = e.project_id WHERE e.type = 'MATERIAL_VARIANCE' ORDER BY e.id DESC LIMIT 8");
  return {
    metrics: {
      poToDelivery: sent.length ? r2(sent.reduce((a, l) => a + dayDiff(dateOnly(parseSql(l.first_received!)!), l.sent_at!), 0) / sent.length) : null,
      confirmHours: conf.length ? r2(conf.reduce((a, c) => a + hours(c.sent_at, c.at), 0) / conf.length) : null,
      onTimePct: delivered.length ? Math.round(((delivered.length - late.length) / delivered.length) * 100) : null,
      avgDelay: delivered.length ? r2(delivered.reduce((a, l) => a + Math.max(0, dayDiff(dateOnly(parseSql(l.first_received!)!), l.original_expected!)), 0) / delivered.length) : null,
      delayFrequencyPct: delivered.length ? Math.round((late.length / delivered.length) * 100) : null,
      costVariancePct: covered ? r2(((actual - covered) / covered) * 100) : null,
      acceptancePct: recvQty ? r2((accQty / recvQty) * 100) : null, damagePct: recvQty ? r2((damQty / recvQty) * 100) : null, shortagePct: dispatched ? r2((shortQty / dispatched) * 100) : null,
      returnPct: accQty ? r2((returned / accQty) * 100) : null, poCycleHours: cyc.length ? r2(cyc.reduce((a, c) => a + hours(c.created_at, c.sent_at), 0) / cyc.length) : null,
    },
    monthly, byCategory, byProject, variance, cost,
    pending: lines.filter((l) => l.live && l.remaining > 0).reduce((a, l) => a + l.remaining * l.rate, 0),
  };
}

/* ───────── calendar ───────── */
export interface CalEvent { date: string; kind: string; label: string; project?: string; href: string; tone: "done" | "upcoming" | "late" | "neutral" }
export function calendarEvents(from: string, to: string, viewer?: Viewer): CalEvent[] {
  const ev: CalEvent[] = []; const t = today();
  const sc = (col: string) => scopeSql(viewer, col);
  const s1 = sc("o.project_id");
  for (const p of all<any>(`SELECT o.id, o.code, o.po_date d, p.code pc FROM purchase_orders o LEFT JOIN projects p ON p.id = o.project_id WHERE o.po_date BETWEEN ? AND ? AND o.status != 'DRAFT' AND ${s1.sql}`, from, to, ...s1.args))
    ev.push({ date: p.d, kind: "PO", label: `PO ${p.code}`, project: p.pc, href: `/procurement/${p.id}`, tone: "neutral" });
  for (const c of all<any>(`SELECT o.id, o.code, substr(MIN(vc.at),1,10) d, p.code pc FROM vendor_confirmations vc JOIN purchase_orders o ON o.id = vc.po_id LEFT JOIN projects p ON p.id = o.project_id WHERE ${s1.sql} GROUP BY o.id HAVING d BETWEEN ? AND ?`, ...s1.args, from, to))
    ev.push({ date: c.d, kind: "Confirmation", label: `Vendor confirmed ${c.code}`, project: c.pc, href: `/procurement/${c.id}`, tone: "done" });
  for (const p of all<any>(`SELECT o.id, o.code, vp.paid_on d, vp.amount, p.code pc FROM vendor_payments vp JOIN purchase_orders o ON o.id = vp.po_id LEFT JOIN projects p ON p.id = o.project_id WHERE vp.paid_on BETWEEN ? AND ? AND ${s1.sql}`, from, to, ...s1.args))
    ev.push({ date: p.d, kind: "Payment", label: `Paid ${inr(p.amount)} — ${p.code}`, project: p.pc, href: `/procurement/${p.id}`, tone: "done" });
  for (const l of itemLines({ viewer }).filter((x) => x.live && x.remaining > 0 && x.expected_date && x.expected_date >= from && x.expected_date <= to))
    ev.push({ date: l.expected_date!, kind: "Expected", label: `${l.description} (${l.qty} ${l.unit})`, project: l.project_code, href: `/procurement/${l.po_id}`, tone: l.status === "DELAYED" ? "late" : "upcoming" });
  const s2 = sc("d.project_id");
  for (const d of all<any>(`SELECT d.id, d.code, substr(d.received_at,1,10) dt, p.code pc FROM deliveries d LEFT JOIN projects p ON p.id = d.project_id WHERE d.received_at IS NOT NULL AND substr(d.received_at,1,10) BETWEEN ? AND ? AND ${s2.sql}`, from, to, ...s2.args))
    ev.push({ date: d.dt, kind: "Delivered", label: `${d.code} received`, project: d.pc, href: `/procurement/deliveries/${d.id}`, tone: "done" });
  for (const i of all<any>(`SELECT d.id, d.code, substr(mi.at,1,10) dt, mi.result, p.code pc FROM material_inspections mi JOIN deliveries d ON d.id = mi.delivery_id LEFT JOIN projects p ON p.id = d.project_id WHERE substr(mi.at,1,10) BETWEEN ? AND ? AND ${s2.sql}`, from, to, ...s2.args))
    ev.push({ date: i.dt, kind: "Inspection", label: `${i.code} inspected — ${i.result.replace("_", " ").toLowerCase()}`, project: i.pc, href: `/procurement/deliveries/${i.id}`, tone: i.result === "ACCEPTED" ? "done" : "late" });
  const s3 = sc("st.project_id");
  for (const r of all<any>(`SELECT s.name, s.required_date d, pl.project_id, p.code pc FROM procurement_stages s JOIN procurement_plans pl ON pl.id = s.plan_id JOIN projects p ON p.id = pl.project_id WHERE s.required_date BETWEEN ? AND ? AND ${s3.sql.replace(/st\.project_id/g, "pl.project_id")}`, from, to, ...s3.args))
    ev.push({ date: r.d, kind: "Required", label: r.name, project: r.pc, href: `/procurement/plans/${r.project_id}`, tone: r.d < t ? "late" : "neutral" });
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

/* ───────── search ───────── */
export function procurementSearch(q: string, viewer?: Viewer) {
  q = q.trim();
  if (q.length < 2) return { groups: [] as { type: string; items: { code: string; title: string; sub?: string; href: string }[] }[] };
  const like = `%${q}%`;
  const groups: { type: string; items: { code: string; title: string; sub?: string; href: string }[] }[] = [];
  const add = (type: string, items: any[]) => items.length && groups.push({ type, items });
  const sp = scopeSql(viewer, "p.id");
  const projects = all<any>(`SELECT p.id, p.code, p.name, c.name cname FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE (p.code LIKE ? OR p.name LIKE ? OR c.name LIKE ?) AND ${sp.sql} LIMIT 5`, like, like, like, ...sp.args);
  add("Project", projects.map((p) => ({ code: p.code, title: p.name, sub: p.cname, href: `/procurement/plans/${p.id}` })));
  const s1 = scopeSql(viewer, "o.project_id");
  add("Purchase order", all<any>(`SELECT o.id, o.code, v.name vname, o.status, p.code pc FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN projects p ON p.id = o.project_id LEFT JOIN customers c ON c.id = p.customer_id WHERE (o.code LIKE ? OR v.name LIKE ? OR c.name LIKE ?) AND ${s1.sql} LIMIT 6`, like, like, like, ...s1.args).map((o) => ({ code: o.code, title: o.vname ?? o.code, sub: `${o.pc} · ${o.status}`, href: `/procurement/${o.id}` })));
  const s2 = scopeSql(viewer, "d.project_id");
  add("Delivery", all<any>(`SELECT d.id, d.code, d.status, p.code pc FROM deliveries d LEFT JOIN projects p ON p.id = d.project_id WHERE d.code LIKE ? AND ${s2.sql} LIMIT 5`, like, ...s2.args).map((d) => ({ code: d.code, title: d.code, sub: `${d.pc} · ${d.status}`, href: `/procurement/deliveries/${d.id}` })));
  add("GRN", all<any>(`SELECT g.id, g.code, d.id did, p.code pc FROM grns g JOIN deliveries d ON d.id = g.delivery_id LEFT JOIN projects p ON p.id = g.project_id WHERE g.code LIKE ? AND ${s2.sql} LIMIT 5`, like, ...s2.args).map((g) => ({ code: g.code, title: g.code, sub: g.pc, href: `/procurement/grn/${g.id}` })));
  add("Delivery note", all<any>(`SELECT n.id, n.code, p.code pc FROM delivery_notes n JOIN deliveries d ON d.id = n.delivery_id LEFT JOIN projects p ON p.id = n.project_id WHERE n.code LIKE ? AND ${s2.sql} LIMIT 5`, like, ...s2.args).map((g) => ({ code: g.code, title: g.code, sub: g.pc, href: `/procurement/dn/${g.id}` })));
  add("Serial number", all<any>(`SELECT s.serial, s.material, p.code pc, s.project_id FROM serial_numbers s LEFT JOIN projects p ON p.id = s.project_id WHERE (s.serial LIKE ? OR s.model LIKE ?) LIMIT 5`, like, like).map((s) => ({ code: s.serial, title: s.material, sub: s.pc, href: `/procurement/inventory/${s.project_id}` })));
  add("Material", all<any>(`SELECT DISTINCT r.name, r.project_id, p.code pc FROM material_requirements r JOIN projects p ON p.id = r.project_id WHERE r.name LIKE ? AND ${sp.sql} LIMIT 5`, like, ...sp.args).map((r) => ({ code: r.pc, title: r.name, sub: "material requirement", href: `/procurement/inventory/${r.project_id}` })));
  add("Vendor", all<any>("SELECT id, code, name FROM vendors WHERE name LIKE ? OR code LIKE ? LIMIT 5", like, like).map((v) => ({ code: v.code, title: v.name, href: `/procurement/vendors/${v.id}` })));
  // counts for the first matched project (issues / returns), like the brief's example
  if (projects[0]) {
    const iss = one<{ c: number }>("SELECT COUNT(*) c FROM material_issues WHERE project_id = ?", projects[0].id)!.c;
    const ret = one<{ c: number }>("SELECT COUNT(*) c FROM material_returns WHERE project_id = ?", projects[0].id)!.c;
    if (iss) groups.push({ type: "Material issues", items: [{ code: String(iss), title: `${iss} material issue${iss > 1 ? "s" : ""} on ${projects[0].code}`, href: `/procurement/issues?project=${projects[0].id}` }] });
    if (ret) groups.push({ type: "Material returns", items: [{ code: String(ret), title: `${ret} material return${ret > 1 ? "s" : ""} on ${projects[0].code}`, href: `/procurement/returns?project=${projects[0].id}` }] });
  }
  return { groups };
}

export function recentActivity(viewer?: Viewer, limit = 10) {
  const sc = scopeSql(viewer, "a.project_id");
  return all<any>(`SELECT a.*, p.code project_code FROM procurement_activity_logs a LEFT JOIN projects p ON p.id = a.project_id WHERE (a.project_id IS NULL OR ${sc.sql}) ORDER BY a.id DESC LIMIT ?`, ...sc.args, limit);
}
export function upcomingDeliveries(lines: Line[], days = 7) {
  const t = today(), end = dateOnly(addDays(now(), days));
  return lines.filter((l) => l.live && l.remaining > 0 && l.expected_date && l.expected_date >= t && l.expected_date <= end).sort((a, b) => a.expected_date!.localeCompare(b.expected_date!)).slice(0, 10);
}
export { itemLines as lines };
