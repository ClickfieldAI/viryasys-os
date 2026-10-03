// Material ledger: every movement is an immutable transaction. Balances are always derived, never edited.
import { nextCode } from "../../db";
import { now, nowSql } from "../../clock";
import { audit, type Actor } from "../core";
import { all, one, run, r2, plog } from "./core";

export type TxType = "RECEIVED" | "ACCEPTED" | "DAMAGED" | "REJECTED" | "ISSUED" | "CONSUMED" | "RETURNED" | "ADJUST_IN" | "ADJUST_OUT";

export function balanceOf(reqId: number) {
  const sum = (t: string) => one<{ s: number }>("SELECT COALESCE(SUM(qty),0) s FROM inventory_transactions WHERE requirement_id = ? AND type = ?", reqId, t)!.s;
  const d = one<any>("SELECT COALESCE(SUM(store_delta),0) store, COALESCE(SUM(site_delta),0) site FROM inventory_transactions WHERE requirement_id = ?", reqId)!;
  return { received: sum("RECEIVED"), accepted: sum("ACCEPTED"), damaged: sum("DAMAGED"), rejected: sum("REJECTED"), issued: sum("ISSUED"), consumed: sum("CONSUMED"), returned: sum("RETURNED"),
    adjIn: sum("ADJUST_IN"), adjOut: sum("ADJUST_OUT"), store: r2(d.store), site: r2(d.site), onHand: r2(d.store + d.site) };
}

export function postTxn(t: { project_id: number; requirement_id: number; type: TxType; qty: number; ref_type?: string; ref_id?: number; ref_code?: string; note?: string; user_id?: number | null }) {
  const req = one<any>("SELECT * FROM material_requirements WHERE id = ?", t.requirement_id);
  if (!req) throw new Error("Unknown material");
  if (!(t.qty > 0)) return;
  const b = balanceOf(t.requirement_id);
  let store = 0, site = 0;
  switch (t.type) {
    case "ACCEPTED": case "ADJUST_IN": store = t.qty; break;
    case "ISSUED": store = -t.qty; site = t.qty; break;
    case "CONSUMED": site = -t.qty; break;
    case "RETURNED": case "ADJUST_OUT": { const fromSite = Math.min(Math.max(b.site, 0), t.qty); site = -fromSite; store = -(t.qty - fromSite); break; }
    default: break; // RECEIVED / DAMAGED / REJECTED are information rows: they don't add usable stock
  }
  run("INSERT INTO inventory_transactions (project_id, requirement_id, material, unit, type, qty, store_delta, site_delta, ref_type, ref_id, ref_code, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    t.project_id, t.requirement_id, req.name, req.unit, t.type, t.qty, store, site, t.ref_type ?? null, t.ref_id ?? null, t.ref_code ?? null, t.note ?? null, t.user_id ?? null, nowSql());
}

const reqOf = (id: number, projectId: number) => {
  const r = one<any>("SELECT * FROM material_requirements WHERE id = ? AND project_id = ?", id, projectId);
  if (!r) throw new Error("That material isn't part of this project");
  return r;
};

export function issueMaterial(d: { project_id: number; requirement_id: number; qty: number; issued_by: string; received_by: string; purpose?: string; install_stage?: string }, actor: Actor) {
  const r = reqOf(d.requirement_id, d.project_id);
  const b = balanceOf(r.id);
  if (!(d.qty > 0)) throw new Error("Quantity must be positive");
  if (d.qty > b.store + 1e-9) throw new Error(`Only ${b.store} ${r.unit} of ${r.name} is available in store (accepted material not yet issued).`);
  if (!d.issued_by.trim() || !d.received_by.trim()) throw new Error("Enter who issued and who received the material");
  const code = nextCode("MI");
  const id = Number(run("INSERT INTO material_issues (code, project_id, requirement_id, qty, issued_by, received_by, purpose, install_stage, at, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)", code, d.project_id, r.id, d.qty, d.issued_by, d.received_by, d.purpose ?? null, d.install_stage ?? null, nowSql(), actor.id).lastInsertRowid);
  postTxn({ project_id: d.project_id, requirement_id: r.id, type: "ISSUED", qty: d.qty, ref_type: "material_issue", ref_id: id, ref_code: code, user_id: actor.id, note: d.install_stage });
  plog(actor, { project_id: d.project_id, type: "material_issue", summary: `${code}: ${d.qty} ${r.unit} ${r.name} issued to ${d.received_by}${d.install_stage ? ` for ${d.install_stage}` : ""}` });
  return code;
}

export function consumeMaterial(d: { project_id: number; requirement_id: number; qty: number; note?: string }, actor: Actor) {
  const r = reqOf(d.requirement_id, d.project_id);
  const b = balanceOf(r.id);
  if (!(d.qty > 0)) throw new Error("Quantity must be positive");
  if (d.qty > b.site + 1e-9) throw new Error(`Only ${b.site} ${r.unit} of ${r.name} is issued to site and unconsumed. Issue material first.`);
  const id = Number(run("INSERT INTO material_consumption (project_id, requirement_id, qty, note, user_id, at) VALUES (?,?,?,?,?,?)", d.project_id, r.id, d.qty, d.note ?? null, actor.id, nowSql()).lastInsertRowid);
  postTxn({ project_id: d.project_id, requirement_id: r.id, type: "CONSUMED", qty: d.qty, ref_type: "material_consumption", ref_id: id, note: d.note, user_id: actor.id });
  plog(actor, { project_id: d.project_id, type: "material_consumed", summary: `${d.qty} ${r.unit} ${r.name} consumed${d.note ? ` — ${d.note}` : ""}` });
  checkVariance(r.id);
}

export function returnMaterial(d: { project_id: number; requirement_id: number; qty: number; condition?: string; returned_by: string; received_by: string; reason?: string }, actor: Actor) {
  const r = reqOf(d.requirement_id, d.project_id);
  const b = balanceOf(r.id);
  if (!(d.qty > 0)) throw new Error("Quantity must be positive");
  if (d.qty > b.onHand + 1e-9) throw new Error(`Only ${b.onHand} ${r.unit} of ${r.name} is on hand for this project.`);
  if (!d.returned_by.trim() || !d.received_by.trim()) throw new Error("Enter who returned and who received the material");
  const code = nextCode("RET");
  const id = Number(run("INSERT INTO material_returns (code, project_id, requirement_id, qty, condition, returned_by, received_by, reason, at, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)", code, d.project_id, r.id, d.qty, d.condition ?? "Good", d.returned_by, d.received_by, d.reason ?? null, nowSql(), actor.id).lastInsertRowid);
  postTxn({ project_id: d.project_id, requirement_id: r.id, type: "RETURNED", qty: d.qty, ref_type: "material_return", ref_id: id, ref_code: code, note: d.reason, user_id: actor.id });
  plog(actor, { project_id: d.project_id, type: "material_return", summary: `${code}: ${d.qty} ${r.unit} ${r.name} returned (${d.condition ?? "Good"})` });
  return code;
}

/** Stock count: what is physically left vs what the ledger says. The difference is posted as an adjustment — never edited away. */
export function reconcile(projectId: number, reqId: number, physical: number, note: string, actor: Actor) {
  const r = reqOf(reqId, projectId);
  const b = balanceOf(reqId);
  if (physical < 0) throw new Error("Physical count can't be negative");
  const diff = r2(b.onHand - physical);
  if (Math.abs(diff) < 1e-9) return { diff: 0 };
  postTxn({ project_id: projectId, requirement_id: reqId, type: diff > 0 ? "ADJUST_OUT" : "ADJUST_IN", qty: Math.abs(diff), ref_type: "stock_count", note: note || "Stock count adjustment", user_id: actor.id });
  plog(actor, { project_id: projectId, type: "stock_count", summary: `Stock count ${r.name}: ledger ${b.onHand}, physical ${physical} → ${diff > 0 ? `${diff} unaccounted` : `${-diff} surplus`}` });
  audit(actor, "stock count adjustment", "project", projectId, b.onHand, physical);
  checkVariance(reqId);
  return { diff };
}

export function tolerancePct() { return 3; }

/** Flags consumption above plan and unaccounted stock as management exceptions. */
export function checkVariance(reqId: number) {
  const r = one<any>("SELECT r.*, p.code pcode FROM material_requirements r JOIN projects p ON p.id = r.project_id WHERE r.id = ?", reqId);
  const b = balanceOf(reqId);
  const intel = require("./intel") as typeof import("./intel");
  const over = b.consumed - r.qty;
  if (over > r.qty * (tolerancePct() / 100) + 1e-9)
    intel.raiseException({ key: `var:over:${reqId}`, type: "MATERIAL_VARIANCE", severity: over > r.qty * 0.1 ? "high" : "medium", project_id: r.project_id, requirement_id: reqId, material: r.name, detail: `Consumed ${b.consumed} ${r.unit} against a plan of ${r.qty} (+${r2(over)})` });
  const lost = b.adjOut - b.adjIn;
  if (lost > 1e-9) intel.raiseException({ key: `var:lost:${reqId}`, type: "MATERIAL_VARIANCE", severity: lost > r.qty * 0.02 ? "high" : "medium", project_id: r.project_id, requirement_id: reqId, material: r.name, detail: `${r2(lost)} ${r.unit} unaccounted after stock count` });
}

/* ───────── views ───────── */
export function ledger(projectId: number, reqId?: number, limit = 100, offset = 0) {
  const w = reqId ? "AND t.requirement_id = ?" : "";
  const args = reqId ? [projectId, reqId] : [projectId];
  const rows = all<any>(`SELECT t.*, u.name by_name FROM inventory_transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.project_id = ? ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = one<{ c: number }>(`SELECT COUNT(*) c FROM inventory_transactions t WHERE t.project_id = ? ${w}`, ...args)!.c;
  return { rows, total };
}

/** Planned vs issued vs consumed with variance, per material. */
export function consumptionSummary(projectId: number) {
  return all<any>("SELECT id, name, unit, qty, category FROM material_requirements WHERE project_id = ? ORDER BY id", projectId).map((r) => {
    const b = balanceOf(r.id);
    return { ...r, ...b, variance: r2(b.consumed - r.qty), unaccounted: r2(Math.max(0, b.adjOut - b.adjIn)), flagged: b.consumed - r.qty > r.qty * (tolerancePct() / 100) + 1e-9 || b.adjOut - b.adjIn > 1e-9 };
  });
}
export { now };

/* ───────── pickers & summaries ───────── */
import { scopeSql, type Viewer } from "./core";
export function stockOptions(viewer?: Viewer) {
  const sc = scopeSql(viewer, "r.project_id");
  const mats = all<any>(`SELECT r.id, r.project_id, r.name, r.unit, r.category, r.qty,
      COALESCE((SELECT SUM(store_delta) FROM inventory_transactions WHERE requirement_id = r.id),0) store, COALESCE((SELECT SUM(site_delta) FROM inventory_transactions WHERE requirement_id = r.id),0) site
    FROM material_requirements r WHERE ${sc.sql} AND EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.requirement_id = r.id) ORDER BY r.project_id, r.id`, ...sc.args).map((m) => ({ ...m, store: r2(m.store), site: r2(m.site), onHand: r2(m.store + m.site) }));
  const projIds = [...new Set(mats.map((m) => m.project_id))];
  const projects = projIds.length ? all<any>(`SELECT p.id, p.code, c.name cname FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id IN (${projIds.map(() => "?").join(",")}) ORDER BY p.id DESC`, ...projIds).map((p) => ({ id: p.id, label: `${p.cname} · ${p.code}` })) : [];
  return { mats, projects };
}

/** Project stock roll-up in ₹ (valued at PO rates, BOQ estimate as fallback). */
export function projectStock(viewer?: Viewer) {
  const sc = scopeSql(viewer, "t.project_id");
  const rows = all<any>(`SELECT t.project_id, t.type, SUM(t.qty * COALESCE((SELECT SUM(i.qty*i.rate)/SUM(i.qty) FROM purchase_order_items i WHERE i.requirement_id = t.requirement_id), r.est_unit_cost)) v
    FROM inventory_transactions t JOIN material_requirements r ON r.id = t.requirement_id WHERE ${sc.sql} GROUP BY t.project_id, t.type`, ...sc.args);
  const store = all<any>(`SELECT t.project_id, SUM(t.store_delta * COALESCE((SELECT SUM(i.qty*i.rate)/SUM(i.qty) FROM purchase_order_items i WHERE i.requirement_id = t.requirement_id), r.est_unit_cost)) v, SUM(t.site_delta * COALESCE((SELECT SUM(i.qty*i.rate)/SUM(i.qty) FROM purchase_order_items i WHERE i.requirement_id = t.requirement_id), r.est_unit_cost)) s
    FROM inventory_transactions t JOIN material_requirements r ON r.id = t.requirement_id WHERE ${sc.sql} GROUP BY t.project_id`, ...sc.args);
  const by = new Map<number, any>();
  for (const r of rows) by.set(r.project_id, { ...(by.get(r.project_id) ?? {}), [r.type]: r.v });
  const out = [...by.entries()].map(([pid, v]) => {
    const p = one<any>("SELECT p.id, p.code, p.name, p.stage, c.name customer FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?", pid)!;
    const s = store.find((x) => x.project_id === pid);
    const flags = one<{ c: number }>("SELECT COUNT(*) c FROM procurement_exceptions WHERE project_id = ? AND type = 'MATERIAL_VARIANCE' AND status = 'OPEN'", pid)!.c;
    return { ...p, received: v.RECEIVED ?? 0, accepted: v.ACCEPTED ?? 0, issued: v.ISSUED ?? 0, consumed: v.CONSUMED ?? 0, returned: v.RETURNED ?? 0, damaged: (v.DAMAGED ?? 0) + (v.REJECTED ?? 0), store: s?.v ?? 0, site: s?.s ?? 0, flags };
  });
  return out.sort((a, b) => b.received - a.received);
}
export const issuesList = (viewer?: Viewer, projectId?: number) => {
  const sc = scopeSql(viewer, "m.project_id");
  return all<any>(`SELECT m.*, r.name material, r.unit, p.code pcode, c.name cname FROM material_issues m JOIN material_requirements r ON r.id = m.requirement_id JOIN projects p ON p.id = m.project_id LEFT JOIN customers c ON c.id = p.customer_id WHERE ${sc.sql} ${projectId ? "AND m.project_id = ?" : ""} ORDER BY m.id DESC LIMIT 200`, ...sc.args, ...(projectId ? [projectId] : []));
};
export const returnsList = (viewer?: Viewer, projectId?: number) => {
  const sc = scopeSql(viewer, "m.project_id");
  return all<any>(`SELECT m.*, r.name material, r.unit, p.code pcode, c.name cname FROM material_returns m JOIN material_requirements r ON r.id = m.requirement_id JOIN projects p ON p.id = m.project_id LEFT JOIN customers c ON c.id = p.customer_id WHERE ${sc.sql} ${projectId ? "AND m.project_id = ?" : ""} ORDER BY m.id DESC LIMIT 200`, ...sc.args, ...(projectId ? [projectId] : []));
};
