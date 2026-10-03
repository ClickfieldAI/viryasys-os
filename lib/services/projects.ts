// ProjectService — creation from an accepted proposal, stage gating, health, installation, handover.
import { getDb, nextCode } from "../db";
import { addDays, dateOnly, sqlTime } from "../util";
import { audit, notify, type Actor, SYSTEM } from "./core";
import { PROJECT_STAGES } from "../config";
import { fire } from "./automation";
import { today as clockToday } from "../clock";
import { getProposal } from "./proposals";

export type Stage = (typeof PROJECT_STAGES)[number];

const STAGE_PLAN: { stage: Stage; name: string; days: number; tasks: string[] }[] = [
  { stage: "PROJECT_CREATED", name: "Project created", days: 0, tasks: [] },
  { stage: "PLANNING", name: "Planning & kickoff", days: 3, tasks: ["Kickoff call with customer", "Confirm site access & permissions"] },
  { stage: "DESIGN", name: "Final design & approvals", days: 8, tasks: ["Freeze single-line diagram", "Utility / DISCOM approval submitted"] },
  { stage: "PROCUREMENT", name: "Procurement", days: 24, tasks: ["All purchase orders confirmed"] },
  { stage: "MATERIAL_DELIVERY", name: "Material delivery", days: 38, tasks: ["All materials received & inspected"] },
  { stage: "INSTALLATION", name: "Installation", days: 55, tasks: ["Structure erection", "Panel mounting", "Inverter & wiring"] },
  { stage: "COMMISSIONING", name: "Commissioning & testing", days: 62, tasks: ["Electrical completion checks", "System testing & performance run", "Final safety checks"] },
  { stage: "METERING", name: "Net metering", days: 72, tasks: ["Meter installation / bidirectional meter", "Utility approval & documentation"] },
  { stage: "HANDOVER", name: "Handover", days: 78, tasks: ["Customer training", "Handover documents issued"] },
  { stage: "COMPLETED", name: "Completed", days: 80, tasks: [] },
];
const HANDOVER_ITEMS = ["Installation completed", "Commissioning completed", "Metering completed", "Documentation completed", "Customer training", "App setup", "Handover documents", "Customer acknowledgement"];
const INSTALL_STEPS = ["Structure", "Panels", "Inverter", "Wiring", "Testing"];

export function createFromProposal(proposalId: number, actor: Actor, pmChoice?: number | null): { id: number; code: string; pm_id: number | null } {
  const db = getDb();
  const existing = db.prepare("SELECT id, code, pm_id FROM projects WHERE proposal_id = ?").get(proposalId) as any;
  if (existing) return existing;
  const cur = getProposal(proposalId);
  if (!cur) throw new Error("Proposal not found");
  const leadId = cur.proposal.lead_id;
  // A project was already opened from the lead (before the proposal was accepted) — attach the proposal to it instead of creating a second one.
  const early = db.prepare("SELECT id, code, pm_id FROM projects WHERE lead_id = ? AND proposal_id IS NULL").get(leadId) as any;
  if (early) {
    const l = db.prepare("SELECT capacity_kw FROM leads WHERE id = ?").get(leadId) as any;
    db.prepare("UPDATE projects SET proposal_id = ?, value = ?, capacity_kw = COALESCE(?, capacity_kw) WHERE id = ?").run(proposalId, cur.pricing.total, l?.capacity_kw ?? null, early.id);
    if (pmChoice && pmChoice !== early.pm_id) assignPM(early.id, pmChoice, actor);
    db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,1)").run(early.id, "proposal", `Proposal ${cur.proposal.code} accepted and linked to this project`, actor.id);
    (require("./proc/core") as typeof import("./proc/core")).createCustomerOrder(early.id, actor);
    return { id: early.id, code: early.code, pm_id: pmChoice ?? early.pm_id };
  }
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as any;
  const survey = db.prepare("SELECT * FROM site_surveys WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const task = db.prepare("SELECT designer_id FROM design_tasks WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const design = db.prepare("SELECT * FROM designs WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const chosen = pmChoice ? (db.prepare("SELECT id FROM users WHERE id = ? AND role = 'pm' AND active = 1").get(pmChoice) as any) : null;
  if (pmChoice && !chosen) throw new Error("Choose an active project manager");
  const pm = chosen ? chosen : survey?.pm_id
    ? { id: survey.pm_id }
    : (db.prepare(`SELECT u.id FROM users u WHERE u.role='pm' AND u.active=1 ORDER BY (SELECT COUNT(*) FROM projects p WHERE p.pm_id=u.id AND p.stage!='COMPLETED') ASC LIMIT 1`).get() as any);
  const code = nextCode("PROJ", db);
  const today = new Date();
  const equipment = design ? JSON.stringify({ panels: `${design.panel_brand} ${design.panel_count}×${design.panel_wp}Wp`, inverters: `${design.inverter_brand} ${design.inverter_count}×${design.inverter_kw}kW`, structure: design.structure }) : null;

  const id = db.transaction(() => {
    const pid = Number(
      db.prepare(
        `INSERT INTO projects (code, lead_id, customer_id, proposal_id, name, capacity_kw, site, city, pm_id, designer_id, value, start_date, target_end, equipment)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(code, leadId, lead.customer_id, proposalId, `${cur.proposal.customer_name} — ${lead.capacity_kw ?? ""} kW`, design?.capacity_kw ?? lead.capacity_kw, survey?.site_address ?? lead.city, lead.city, pm?.id ?? null, task?.designer_id ?? null, cur.pricing.total, dateOnly(today), dateOnly(addDays(today, 80)), equipment).lastInsertRowid
    );
    const mIns = db.prepare("INSERT INTO project_milestones (project_id, stage, name, owner_id, due_date, done_at, status, sort) VALUES (?,?,?,?,?,?,?,?)");
    const tIns = db.prepare("INSERT INTO project_tasks (project_id, stage, title, assignee_id, due_date) VALUES (?,?,?,?,?)");
    STAGE_PLAN.forEach((s, n) => {
      const due = dateOnly(addDays(today, s.days));
      mIns.run(pid, s.stage, s.name, pm?.id ?? null, due, n === 0 ? sqlTime() : null, n === 0 ? "DONE" : n === 1 ? "CURRENT" : "UPCOMING", n);
      s.tasks.forEach((t) => tIns.run(pid, s.stage, t, pm?.id ?? null, due));
    });
    const hIns = db.prepare("INSERT INTO handover_items (project_id, label, sort) VALUES (?,?,?)");
    HANDOVER_ITEMS.forEach((h, n) => hIns.run(pid, h, n));
    const iIns = db.prepare("INSERT INTO install_steps (project_id, name, sort) VALUES (?,?,?)");
    INSTALL_STEPS.forEach((h, n) => iIns.run(pid, h, n));
    db.prepare("UPDATE projects SET stage = 'PLANNING' WHERE id = ?").run(pid);
    // Everything gathered in the sales cycle now belongs to the project too.
    db.prepare("UPDATE documents SET project_id = ? WHERE lead_id = ? AND project_id IS NULL").run(pid, leadId);
    db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,1)").run(pid, "created", `Project ${code} created from proposal ${cur.proposal.code}`, actor.id);
    return pid;
  })();
  audit(actor, "created project", "project", code, undefined, `from ${cur.proposal.code}`);
  (require("./proc/core") as typeof import("./proc/core")).createCustomerOrder(id, actor);
  if (pm?.id) notify({ userId: pm.id, type: "task_assigned", title: `New project assigned: ${code}`, body: cur.proposal.customer_name, link: `/projects/${id}` });
  notify({ role: "finance", type: "proposal_approved", title: `Project ${code} won`, body: `${cur.proposal.customer_name} · ${cur.vars.total_value}`, link: `/projects/${id}` });
  return { id, code, pm_id: pm?.id ?? null };
}

/* ───────────── stage advance with gates ───────────── */
export function advanceGate(projectId: number): { ok: boolean; next?: Stage; blockers: string[] } {
  const db = getDb();
  syncProcurementTasks(projectId);
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const i = PROJECT_STAGES.indexOf(p.stage);
  if (i >= PROJECT_STAGES.length - 1) return { ok: false, blockers: ["Project already completed"] };
  const next = PROJECT_STAGES[i + 1];
  const blockers: string[] = [];
  const open = db.prepare("SELECT title FROM project_tasks WHERE project_id = ? AND stage = ? AND status != 'done'").all(projectId, p.stage) as any[];
  open.forEach((t) => blockers.push(`Open task: ${t.title}`));
  if (next === "PROCUREMENT") {
    const adv = db.prepare("SELECT status FROM payment_milestones WHERE project_id = ? ORDER BY sort LIMIT 1").get(projectId) as any;
    if (adv?.status !== "PAID") blockers.push("Advance payment not yet received");
  }
  if (p.stage === "MATERIAL_DELIVERY") {
    const pend = db.prepare(
      `SELECT r.name FROM material_requirements r WHERE r.project_id = ? AND COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'ACCEPTED'),0) < r.qty - 1e-9`
    ).all(projectId) as any[];
    if (pend.length) blockers.push(`Material not yet received & accepted: ${pend.slice(0, 3).map((x) => x.name).join(", ")}${pend.length > 3 ? ` +${pend.length - 3} more` : ""}`);
  }
  if (next === "COMPLETED") {
    const h = db.prepare("SELECT label FROM handover_items WHERE project_id = ? AND done = 0").all(projectId) as any[];
    h.forEach((x) => blockers.push(`Handover pending: ${x.label}`));
  }
  return { ok: blockers.length === 0, next, blockers };
}

export function advanceStage(projectId: number, actor: Actor) {
  const gate = advanceGate(projectId);
  if (!gate.ok) throw new Error(gate.blockers.join("; "));
  const db = getDb();
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const next = gate.next!;
  db.transaction(() => {
    db.prepare("UPDATE project_milestones SET status='DONE', done_at=? WHERE project_id=? AND stage=?").run(sqlTime(), projectId, p.stage);
    db.prepare("UPDATE project_milestones SET status = CASE WHEN stage = 'COMPLETED' THEN 'DONE' ELSE 'CURRENT' END, done_at = CASE WHEN stage='COMPLETED' THEN ? ELSE done_at END WHERE project_id=? AND stage=?").run(sqlTime(), projectId, next);
    db.prepare("UPDATE projects SET stage = ?, completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END WHERE id = ?").run(next, next, sqlTime(), projectId);
    db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,1)").run(projectId, "stage", `Stage moved: ${p.stage} → ${next}`, actor.id);
  })();
  audit(actor, "changed project status", "project", p.code, p.stage, next);
  if (next === "COMPLETED") fire("project.completed", { project_id: projectId, project_code: p.code, link: `/projects/${projectId}` });
  if (next === "INSTALLATION") notify({ role: "md", type: "installation_milestone", title: `${p.code} entered installation`, link: `/projects/${projectId}` });
  refreshHealth(projectId);
}

export function toggleTask(taskId: number, actor: Actor) {
  const db = getDb();
  const t = db.prepare("SELECT t.*, p.code FROM project_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?").get(taskId) as any;
  const ns = t.status === "done" ? "open" : "done";
  db.prepare("UPDATE project_tasks SET status = ? WHERE id = ?").run(ns, taskId);
  db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id) VALUES (?,?,?,?)").run(t.project_id, "task", `${ns === "done" ? "Completed" : "Reopened"}: ${t.title}`, actor.id);
  refreshHealth(t.project_id);
}

/* ───────────── installation + handover ───────────── */
export function logInstallation(projectId: number, d: { log_date: string; team: string; workers: number; work_done: string; issues: string; steps: Record<number, number> }, actor: Actor) {
  const db = getDb();
  const upd = db.prepare("UPDATE install_steps SET pct = ? WHERE id = ? AND project_id = ?");
  Object.entries(d.steps).forEach(([id, pct]) => upd.run(Math.max(0, Math.min(100, Math.round(pct))), Number(id), projectId));
  const steps = db.prepare("SELECT pct FROM install_steps WHERE project_id = ?").all(projectId) as any[];
  const overall = Math.round(steps.reduce((a, s) => a + s.pct, 0) / Math.max(1, steps.length));
  db.prepare("INSERT INTO installation_logs (project_id, log_date, team, workers, work_done, progress_pct, issues, user_id) VALUES (?,?,?,?,?,?,?,?)").run(projectId, d.log_date, d.team, d.workers, d.work_done, overall, d.issues || null, actor.id);
  db.prepare("UPDATE projects SET install_progress = ? WHERE id = ?").run(overall, projectId);
  db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,1)").run(projectId, "installation", `Installation update: ${overall}% complete — ${d.work_done}`, actor.id);
  const p = db.prepare("SELECT code FROM projects WHERE id = ?").get(projectId) as any;
  if (overall >= 50) notify({ role: "md", type: "installation_milestone", title: `${p.code} installation at ${overall}%`, link: `/projects/${projectId}` });
  audit(actor, "logged installation progress", "project", p.code, undefined, `${overall}%`);
}

export function toggleHandover(itemId: number, actor: Actor) {
  const db = getDb();
  const h = db.prepare("SELECT h.*, p.code FROM handover_items h JOIN projects p ON p.id = h.project_id WHERE h.id = ?").get(itemId) as any;
  db.prepare("UPDATE handover_items SET done = ? WHERE id = ?").run(h.done ? 0 : 1, itemId);
  audit(actor, `${h.done ? "unchecked" : "checked"} handover item`, "project", h.code, undefined, h.label);
}

/** Procurement tasks complete themselves from PO facts — nobody ticks them by hand. */
export function syncProcurementTasks(projectId: number) {
  const db = getDb();
  const reqs = (db.prepare("SELECT COUNT(*) c FROM material_requirements WHERE project_id = ?").get(projectId) as any).c;
  const unordered = (db.prepare(`SELECT COUNT(*) c FROM material_requirements r WHERE r.project_id = ? AND COALESCE((SELECT SUM(i.qty) FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = r.id AND o.status IN ('VENDOR_CONFIRMED','PARTIALLY_CONFIRMED')),0) < r.qty - 1e-9`).get(projectId) as any).c;
  db.prepare("UPDATE project_tasks SET status = ? WHERE project_id = ? AND title = 'All purchase orders confirmed'").run(reqs > 0 && unordered === 0 ? "done" : "open", projectId);
  const unaccepted = (db.prepare(`SELECT COUNT(*) c FROM material_requirements r WHERE r.project_id = ? AND COALESCE((SELECT SUM(t.qty) FROM inventory_transactions t WHERE t.requirement_id = r.id AND t.type = 'ACCEPTED'),0) < r.qty - 1e-9`).get(projectId) as any).c;
  db.prepare("UPDATE project_tasks SET status = ? WHERE project_id = ? AND title = 'All materials received & inspected'").run(reqs > 0 && unaccepted === 0 ? "done" : "open", projectId);
}

/* ───────────── health ───────────── */
export type Health = "ON_TRACK" | "AT_RISK" | "DELAYED" | "BLOCKED" | "COMPLETED";
export function computeHealth(projectId: number): { health: Health; reasons: string[] } {
  const db = getDb();
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (p.stage === "COMPLETED") return { health: "COMPLETED", reasons: [] };
  const today = dateOnly(new Date());
  const soon = dateOnly(addDays(new Date(), 3));
  const reasons: string[] = [];
  let level = 0; // 0 ok, 1 risk, 2 delayed, 3 blocked

  const overdue = db.prepare("SELECT name FROM project_milestones WHERE project_id = ? AND status != 'DONE' AND due_date < ?").all(projectId, today) as any[];
  if (overdue.length) { level = Math.max(level, 2); reasons.push(`${overdue.length} milestone(s) overdue: ${overdue.map((m) => m.name).join(", ")}`); }
  const dueSoon = db.prepare("SELECT name FROM project_milestones WHERE project_id = ? AND status = 'CURRENT' AND due_date BETWEEN ? AND ?").all(projectId, today, soon) as any[];
  if (dueSoon.length) { level = Math.max(level, 1); reasons.push(`Milestone due within 3 days: ${dueSoon[0].name}`); }
  const overdueTasks = db.prepare("SELECT COUNT(*) c FROM project_tasks WHERE project_id = ? AND status != 'done' AND due_date < ?").get(projectId, today) as any;
  if (overdueTasks.c) { level = Math.max(level, 1); reasons.push(`${overdueTasks.c} task(s) overdue`); }

  const lines = (require("./proc/intel") as typeof import("./proc/intel")).itemLines({ project_id: projectId }).filter((l) => l.status === "DELAYED");
  if (lines.length) { level = Math.max(level, 2); reasons.push(`Procurement delay: ${lines.map((d) => d.description).slice(0, 3).join(", ")}`); }

  const adv = db.prepare("SELECT status, invoice_id FROM payment_milestones WHERE project_id = ? ORDER BY sort LIMIT 1").get(projectId) as any;
  const stageIdx = PROJECT_STAGES.indexOf(p.stage);
  if (adv && adv.status !== "PAID" && stageIdx >= PROJECT_STAGES.indexOf("PLANNING") && stageIdx <= PROJECT_STAGES.indexOf("DESIGN") && adv.invoice_id) {
    const od = db.prepare("SELECT due_on FROM invoices WHERE id = ? AND status != 'PAID'").get(adv.invoice_id) as any;
    if (od?.due_on && od.due_on < today) { level = Math.max(level, 3); reasons.push("Blocked: advance payment overdue"); }
  }
  const q = db.prepare("SELECT COUNT(*) c FROM customer_queries WHERE project_id = ? AND status IN ('OPEN','IN_PROGRESS') AND due_date < ?").get(projectId, today) as any;
  if (q.c) { level = Math.max(level, 1); reasons.push(`${q.c} customer quer${q.c > 1 ? "ies" : "y"} overdue`); }
  if (p.target_end && p.target_end < today) { level = Math.max(level, 2); reasons.push("Past target completion date"); }

  return { health: (["ON_TRACK", "AT_RISK", "DELAYED", "BLOCKED"] as const)[level], reasons };
}
export function refreshHealth(projectId: number) {
  const db = getDb();
  syncProcurementTasks(projectId);
  const h = computeHealth(projectId);
  const old = db.prepare("SELECT health, code FROM projects WHERE id = ?").get(projectId) as any;
  if (old.health !== h.health) {
    db.prepare("UPDATE projects SET health = ? WHERE id = ?").run(h.health, projectId);
    if (["DELAYED", "BLOCKED"].includes(h.health)) notify({ role: "md", type: "project_delay", title: `${old.code} is ${h.health.toLowerCase()}`, body: h.reasons[0], link: `/projects/${projectId}` });
  }
  return h;
}
export function refreshAllHealth() {
  (getDb().prepare("SELECT id FROM projects WHERE stage != 'COMPLETED'").all() as { id: number }[]).forEach((p) => refreshHealth(p.id));
}

/* ───────────── queries ───────────── */
export function listProjects(o: { q?: string; stage?: string; health?: string; pm?: number } = {}) {
  const where: string[] = [], args: any[] = [];
  if (o.q) { where.push("(p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ?)"); args.push(`%${o.q}%`, `%${o.q}%`, `%${o.q}%`); }
  if (o.stage) { where.push("p.stage = ?"); args.push(o.stage); }
  if (o.health) { where.push("p.health = ?"); args.push(o.health); }
  if (o.pm) { where.push("p.pm_id = ?"); args.push(o.pm); }
  return getDb().prepare(
    `SELECT p.*, c.name customer_name, u.name pm_name FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.pm_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.stage = 'COMPLETED', p.id DESC LIMIT 200`
  ).all(...args) as any[];
}

export function projectFull(id: number) {
  const db = getDb();
  const p = db.prepare(
    `SELECT p.*, c.name customer_name, c.code customer_code, u.name pm_name, d.name designer_name, e.name engineer_name, pr.code proposal_code, l.code lead_code
     FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.pm_id LEFT JOIN users d ON d.id = p.designer_id
     LEFT JOIN users e ON e.id = p.engineer_id LEFT JOIN proposals pr ON pr.id = p.proposal_id LEFT JOIN leads l ON l.id = p.lead_id WHERE p.id = ?`
  ).get(id) as any;
  if (!p) return null;
  return {
    p,
    milestones: db.prepare("SELECT m.*, u.name owner FROM project_milestones m LEFT JOIN users u ON u.id = m.owner_id WHERE project_id = ? ORDER BY sort").all(id) as any[],
    tasks: db.prepare("SELECT t.*, u.name assignee FROM project_tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE project_id = ? ORDER BY t.id").all(id) as any[],
    activities: db.prepare("SELECT a.*, u.name user FROM project_activities a LEFT JOIN users u ON u.id = a.user_id WHERE project_id = ? ORDER BY a.id DESC LIMIT 40").all(id) as any[],
    installLogs: db.prepare("SELECT * FROM installation_logs WHERE project_id = ? ORDER BY id DESC LIMIT 20").all(id) as any[],
    steps: db.prepare("SELECT * FROM install_steps WHERE project_id = ? ORDER BY sort").all(id) as any[],
    handover: db.prepare("SELECT * FROM handover_items WHERE project_id = ? ORDER BY sort").all(id) as any[],
    payments: db.prepare("SELECT * FROM payment_milestones WHERE project_id = ? ORDER BY sort").all(id) as any[],
    health: computeHealth(id),
    gate: advanceGate(id),
  };
}

export { SYSTEM };


/** Project managers with their current load, for pickers. */
export function pmOptions() {
  return getDb().prepare(`SELECT u.id, u.name, (SELECT COUNT(*) FROM projects p WHERE p.pm_id = u.id AND p.stage != 'COMPLETED') active FROM users u WHERE u.role = 'pm' AND u.active = 1 ORDER BY u.name`).all() as { id: number; name: string; active: number }[];
}

/** Assign or change the project manager: moves open milestones/tasks to them and notifies both people. */
export function assignPM(projectId: number, pmId: number, actor: Actor) {
  const db = getDb();
  const p = db.prepare("SELECT id, code, name, pm_id FROM projects WHERE id = ?").get(projectId) as any;
  if (!p) throw new Error("Project not found");
  const pm = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'pm' AND active = 1").get(pmId) as any;
  if (!pm) throw new Error("Choose an active project manager");
  if (p.pm_id === pm.id) throw new Error(`${pm.name} is already the project manager`);
  db.transaction(() => {
    db.prepare("UPDATE projects SET pm_id = ? WHERE id = ?").run(pm.id, projectId);
    db.prepare("UPDATE project_milestones SET owner_id = ? WHERE project_id = ? AND done_at IS NULL").run(pm.id, projectId);
    db.prepare("UPDATE project_tasks SET assignee_id = ? WHERE project_id = ? AND status = 'open' AND (assignee_id IS NULL OR assignee_id = ?)").run(pm.id, projectId, p.pm_id ?? -1);
    db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,0)").run(projectId, "pm_assigned", `Project manager ${p.pm_id ? "changed to" : "assigned:"} ${pm.name}`, actor.id);
  })();
  audit(actor, "assigned project manager", "project", p.code, undefined, pm.name);
  notify({ userId: pm.id, type: "task_assigned", title: `You are the project manager for ${p.code}`, body: p.name, link: `/projects/${projectId}` });
  if (p.pm_id) notify({ userId: p.pm_id, type: "task_assigned", title: `${p.code} has been reassigned to ${pm.name}`, body: p.name, link: `/projects/${projectId}` });
}


/** Open a project straight from a lead (no accepted proposal needed yet); the PM is notified and builds the plan. */
export function createFromLead(leadId: number, pmChoice: number | null, actor: Actor): { id: number; code: string } {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM projects WHERE lead_id = ?").get(leadId)) throw new Error("This lead already has a project");
  const lead = db.prepare("SELECT l.*, c.name customer_name FROM leads l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.id = ?").get(leadId) as any;
  if (!lead) throw new Error("Lead not found");
  if (["LOST", "DISQUALIFIED"].includes(lead.status)) throw new Error("A lost or disqualified lead can't become a project");
  const pm = pmChoice
    ? (db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'pm' AND active = 1").get(pmChoice) as any)
    : (db.prepare(`SELECT u.id, u.name FROM users u WHERE u.role='pm' AND u.active=1 ORDER BY (SELECT COUNT(*) FROM projects p WHERE p.pm_id=u.id AND p.stage!='COMPLETED') ASC LIMIT 1`).get() as any);
  if (pmChoice && !pm) throw new Error("Choose an active project manager");
  const task = db.prepare("SELECT designer_id FROM design_tasks WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const code = nextCode("PROJ", db);
  const today = new Date();
  const id = db.transaction(() => {
    const pid = Number(db.prepare(`INSERT INTO projects (code, lead_id, customer_id, proposal_id, name, capacity_kw, site, city, pm_id, designer_id, value, start_date, target_end)
      VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?)`).run(code, leadId, lead.customer_id, `${lead.customer_name} — ${lead.capacity_kw ?? ""} kW`, lead.capacity_kw, lead.city, lead.city, pm?.id ?? null, task?.designer_id ?? null, lead.est_value ?? 0, dateOnly(today), dateOnly(addDays(today, 80))).lastInsertRowid);
    const mIns = db.prepare("INSERT INTO project_milestones (project_id, stage, name, owner_id, due_date, done_at, status, sort) VALUES (?,?,?,?,?,?,?,?)");
    const tIns = db.prepare("INSERT INTO project_tasks (project_id, stage, title, assignee_id, due_date) VALUES (?,?,?,?,?)");
    STAGE_PLAN.forEach((st, n) => {
      const due = dateOnly(addDays(today, st.days));
      mIns.run(pid, st.stage, st.name, pm?.id ?? null, due, n === 0 ? sqlTime() : null, n === 0 ? "DONE" : n === 1 ? "CURRENT" : "UPCOMING", n);
      st.tasks.forEach((t) => tIns.run(pid, st.stage, t, pm?.id ?? null, due));
    });
    const hIns = db.prepare("INSERT INTO handover_items (project_id, label, sort) VALUES (?,?,?)");
    HANDOVER_ITEMS.forEach((h, n) => hIns.run(pid, h, n));
    const iIns = db.prepare("INSERT INTO install_steps (project_id, name, sort) VALUES (?,?,?)");
    INSTALL_STEPS.forEach((h, n) => iIns.run(pid, h, n));
    db.prepare("UPDATE projects SET stage = 'PLANNING' WHERE id = ?").run(pid);
    db.prepare("UPDATE documents SET project_id = ? WHERE lead_id = ? AND project_id IS NULL").run(pid, leadId);
    db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,0)").run(pid, "created", `Project ${code} created from lead ${lead.code}${pm ? ` — project manager ${pm.name}` : ""}`, actor.id);
    db.prepare("INSERT INTO lead_activities (lead_id, type, summary, user_id) VALUES (?,?,?,?)").run(leadId, "project", `Project ${code} created${pm ? ` · PM ${pm.name}` : ""}`, actor.id);
    return pid;
  })();
  audit(actor, "created project", "project", code, undefined, `from lead ${lead.code}`);
  if (pm) notify({ userId: pm.id, type: "task_assigned", title: `New project assigned: ${code}`, body: `${lead.customer_name} — please build the project plan`, link: `/projects/${id}?tab=stages` });
  return { id, code };
}

/* ───────────── project plan (PM edits their own plan) ───────────── */
export function addPlanTask(projectId: number, d: { stage: string; title: string; due?: string | null; assignee_id?: number | null }, actor: Actor) {
  const db = getDb();
  if (!d.title.trim()) throw new Error("Give the task a title");
  const m = db.prepare("SELECT due_date, owner_id FROM project_milestones WHERE project_id = ? AND stage = ?").get(projectId, d.stage) as any;
  if (!m) throw new Error("Unknown stage");
  db.prepare("INSERT INTO project_tasks (project_id, stage, title, assignee_id, due_date) VALUES (?,?,?,?,?)").run(projectId, d.stage, d.title.trim(), d.assignee_id ?? m.owner_id ?? null, d.due || m.due_date);
  db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id) VALUES (?,?,?,?)").run(projectId, "plan", `Task added: ${d.title.trim()}`, actor.id);
  if (d.assignee_id && d.assignee_id !== actor.id) notify({ userId: d.assignee_id, type: "task_assigned", title: "New project task", body: d.title.trim(), link: `/projects/${projectId}?tab=stages` });
}
export function removePlanTask(taskId: number, actor: Actor) {
  const db = getDb();
  const t = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as any;
  if (!t) throw new Error("Task not found");
  if (t.status === "done") throw new Error("Completed tasks stay on the record");
  db.prepare("DELETE FROM project_tasks WHERE id = ?").run(taskId);
  db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id) VALUES (?,?,?,?)").run(t.project_id, "plan", `Task removed: ${t.title}`, actor.id);
}
export function setMilestoneDue(milestoneId: number, due: string, actor: Actor) {
  const db = getDb();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Choose a valid date");
  const m = db.prepare("SELECT * FROM project_milestones WHERE id = ?").get(milestoneId) as any;
  if (!m) throw new Error("Stage not found");
  db.prepare("UPDATE project_milestones SET due_date = ? WHERE id = ?").run(due, milestoneId);
  db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id) VALUES (?,?,?,?)").run(m.project_id, "plan", `${m.name} due date ${m.due_date} → ${due}`, actor.id);
  refreshHealth(m.project_id);
}
