import { getDb, nextCode, settings } from "../db";
import { fmtKw, parseSql, sqlTime, dateOnly } from "../util";
import { audit, notify, userName, type Actor, SYSTEM } from "./core";
import { fire } from "./automation";
import { ai } from "../providers";
import { ALL_LEAD_STATUSES, LEAD_STAGES } from "../config";

export interface LeadInput {
  company?: string | null; contact?: string | null; phone?: string | null; email?: string | null;
  vertical?: string | null; location?: string | null; capacity_kw?: number | null; solar_type?: string | null;
  source?: string; industry?: string | null; inbound_message_id?: number | null; notes?: string | null;
}

/* ───────────── duplicate detection ───────────── */
const NOISE = /\b(pvt|private|ltd|limited|industries|industry|textiles|textile|enterprises|company|co|the|and|&|llp|inc)\b/g;
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "").slice(-10);
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  const inter = [...A].filter((x) => B.has(x)).length;
  const jac = inter / (A.size + B.size - inter);
  const contains = a.includes(b) || b.includes(a) ? 0.85 : 0;
  return Math.max(jac, contains);
}

export interface DupMatch { lead_id: number; code: string; title: string; customer: string | null; confidence: number; reasons: string[] }
export function findDuplicates(input: LeadInput): DupMatch[] {
  const rows = getDb()
    .prepare(
      `SELECT l.id, l.code, l.title, l.city, c.name cname, c.website, ct.name contact, ct.phone, ct.email
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN contacts ct ON ct.id = l.contact_id
       WHERE l.status NOT IN ('LOST','DISQUALIFIED')`
    )
    .all() as any[];
  const out: DupMatch[] = [];
  for (const r of rows) {
    let score = 0;
    const reasons: string[] = [];
    if (input.phone && digits(input.phone).length >= 10 && digits(input.phone) === digits(r.phone)) { score = Math.max(score, 98); reasons.push("phone matches"); }
    if (input.email && input.email.toLowerCase() === (r.email ?? "").toLowerCase()) { score = Math.max(score, 97); reasons.push("email matches"); }
    const sim = similarity(norm(input.company), norm(r.cname));
    if (sim >= 0.6 && norm(input.company)) {
      let s = 70 + sim * 24;
      reasons.push("company name similar");
      if (input.location && r.city && input.location.toLowerCase() === r.city.toLowerCase()) { s += 3; reasons.push("same city"); }
      score = Math.max(score, Math.min(99, Math.round(s)));
    }
    if (input.contact && r.contact && norm(input.contact) === norm(r.contact) && input.location && r.city?.toLowerCase() === input.location.toLowerCase()) {
      score = Math.max(score, 72); reasons.push("same contact & city");
    }
    if (score >= 70) out.push({ lead_id: r.id, code: r.code, title: r.title, customer: r.cname, confidence: score, reasons });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

/* ───────────── creation ───────────── */
export function createLead(input: LeadInput, actor: Actor): { id: number; code: string } {
  const db = getDb();
  const s = settings();
  const tx = db.transaction(() => {
    let customerId: number | null = null;
    const cname = input.company?.trim() || `Unnamed enquiry${input.contact ? ` — ${input.contact}` : ""}`;
    const existing = input.company ? (db.prepare("SELECT id FROM customers WHERE lower(name) = lower(?)").get(cname) as { id: number } | undefined) : undefined;
    if (existing) customerId = existing.id;
    else {
      const code = nextCode("CUST", db);
      customerId = Number(
        db.prepare("INSERT INTO customers (code, name, industry, city) VALUES (?,?,?,?)").run(code, cname, input.industry ?? input.vertical ?? null, input.location ?? null).lastInsertRowid
      );
    }
    let contactId: number | null = null;
    if (input.contact || input.phone || input.email) {
      contactId = Number(
        db.prepare("INSERT INTO contacts (customer_id, name, phone, email, is_primary) VALUES (?,?,?,?,1)").run(customerId, input.contact ?? "Contact", input.phone ?? null, input.email ?? null).lastInsertRowid
      );
    }
    const code = nextCode("LEAD", db);
    const title = `${input.company?.trim() || "New enquiry"} — ${fmtKw(input.capacity_kw)} ${input.solar_type ?? ""}${input.location ? ` · ${input.location}` : ""}`.replace(/\s+/g, " ");
    const estValue = input.capacity_kw ? Math.round(input.capacity_kw * s.calc.cost_per_kwp) : null;
    const id = Number(
      db.prepare(
        `INSERT INTO leads (code, customer_id, contact_id, title, source, vertical, solar_type, capacity_kw, city, est_value, sla_seconds, inbound_message_id, received_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(code, customerId, contactId, title, input.source ?? "manual", input.vertical ?? null, input.solar_type ?? null, input.capacity_kw ?? null, input.location ?? null, estValue, s.sla_seconds, input.inbound_message_id ?? null, sqlTime()).lastInsertRowid
    );
    db.prepare("INSERT INTO lead_status_history (lead_id, from_status, to_status, user_id) VALUES (?,NULL,'NEW',?)").run(id, actor.id);
    logActivity(id, "created", `Lead created from ${input.source ?? "manual"}${input.notes ? ` — ${input.notes}` : ""}`, actor);
    audit(actor, "created lead", "lead", code);
    return { id, code };
  });
  const res = tx();
  const l = getDb().prepare("SELECT title FROM leads WHERE id = ?").get(res.id) as { title: string };
  fire("lead.created", { lead_id: res.id, lead_code: res.code, title: l.title, source: input.source ?? "manual", capacity_kw: input.capacity_kw ?? 0, link: `/crm/leads/${res.id}` });
  return res;
}

/* ───────────── assignment + SLA ───────────── */
export function assignOwner(leadId: number, ownerId?: number) {
  const db = getDb();
  let owner: { id: number; name: string } | undefined;
  if (ownerId) owner = { id: ownerId, name: userName(ownerId) };
  else {
    owner = db
      .prepare(
        `SELECT u.id, u.name FROM users u WHERE u.role = 'sales' AND u.active = 1
         ORDER BY (SELECT COUNT(*) FROM leads l WHERE l.owner_id = u.id AND l.status IN ('NEW','CONTACTED','QUALIFIED')) ASC, u.id ASC LIMIT 1`
      )
      .get() as any;
  }
  if (!owner) return null;
  db.prepare("UPDATE leads SET owner_id = ?, updated_at = ? WHERE id = ?").run(owner.id, sqlTime(), leadId);
  logActivity(leadId, "assigned", `Assigned to ${owner.name}`, SYSTEM);
  return owner;
}

export function startSla(leadId: number): string {
  const db = getDb();
  db.prepare("UPDATE leads SET sla_status = 'running', received_at = COALESCE(received_at, ?) WHERE id = ? AND first_response_at IS NULL").run(sqlTime(), leadId);
  const l = db.prepare("SELECT sla_seconds FROM leads WHERE id = ?").get(leadId) as { sla_seconds: number };
  return `${l.sla_seconds}s timer running`;
}

export interface SlaInfo { state: "running" | "met" | "breached"; deadline: number; remaining: number; responseSeconds: number | null; total: number }
export function slaInfo(l: { received_at: string; first_response_at: string | null; sla_seconds: number; sla_status: string }, now = Date.now()): SlaInfo {
  const rec = parseSql(l.received_at)!.getTime();
  const deadline = rec + l.sla_seconds * 1000;
  const resp = l.first_response_at ? Math.round((parseSql(l.first_response_at)!.getTime() - rec) / 1000) : null;
  const state = l.sla_status === "met" ? "met" : l.sla_status === "breached" ? "breached" : "running";
  return { state, deadline, remaining: Math.round((deadline - now) / 1000), responseSeconds: resp, total: l.sla_seconds };
}

/** Marks overdue timers breached and escalates. Cheap; called from dashboard/lead views. */
export function slaTick() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, code, title, owner_id, received_at, sla_seconds FROM leads
     WHERE sla_status = 'running' AND first_response_at IS NULL AND status = 'NEW'`
  ).all() as any[];
  const now = Date.now();
  for (const l of rows) {
    const deadline = parseSql(l.received_at)!.getTime() + l.sla_seconds * 1000;
    if (now > deadline) {
      db.prepare("UPDATE leads SET sla_status = 'breached' WHERE id = ?").run(l.id);
      logActivity(l.id, "sla", "SLA BREACHED — no response within " + l.sla_seconds + "s", SYSTEM);
      if (l.owner_id) notify({ userId: l.owner_id, type: "sla_breach", title: `SLA breached: ${l.code}`, body: l.title, link: `/crm/leads/${l.id}` });
      fire("lead.sla_breached", { lead_id: l.id, lead_code: l.code, title: l.title, summary: `${l.title} — nobody responded within ${l.sla_seconds}s (owner: ${userName(l.owner_id)})`, link: `/crm/leads/${l.id}` });
    }
  }
  proposalIdleTick();
}

/**
 * Proposal sent but the customer hasn't moved on (no Negotiation) for `followup_days` → the lead goes to Follow-ups.
 * Runs with the SLA tick; the "Proposal idle → follow-up" automation rule decides what happens (switch it off in Automation).
 */
export function proposalIdleTick() {
  const db = getDb();
  const days = settings().followup_days ?? 10;
  const rule = db.prepare("SELECT id FROM automation_rules WHERE trigger = 'proposal.stale'").get();
  if (!rule) db.prepare("INSERT INTO automation_rules (name,trigger,conditions,actions,runs) VALUES (?,?,?,?,0)").run("Proposal idle → add lead to Follow-ups", "proposal.stale", "[]", JSON.stringify([{ type: "add_followup", title: "Proposal idle {idle_days} days — follow up with {title}" }, { type: "notify", to: "owner", notif: "task_assigned", title: "Follow up: {title}", body: "The proposal has had no response for {idle_days} days.", link: "{link}" }]));
  const rows = db.prepare(
    `SELECT l.id, l.code, l.title, l.owner_id,
       (SELECT MAX(h.at) FROM lead_status_history h WHERE h.lead_id = l.id AND h.to_status = 'PROPOSAL') entered
     FROM leads l WHERE l.status = 'PROPOSAL'`
  ).all() as any[];
  const now = Date.now();
  for (const l of rows) {
    const since = parseSql(l.entered)?.getTime();
    if (!since || now - since < days * 86400000) continue;
    if (db.prepare("SELECT 1 FROM lead_tasks WHERE lead_id = ? AND kind = 'proposal_idle' AND status = 'open'").get(l.id)) continue;
    const last = db.prepare("SELECT MAX(created_at) c FROM lead_tasks WHERE lead_id = ? AND kind = 'proposal_idle'").get(l.id) as any;
    const lastAt = last?.c ? parseSql(last.c)?.getTime() : null;
    if (lastAt && now - lastAt < days * 86400000) continue; // already chased recently; ask again after another period
    const idle = Math.floor((now - since) / 86400000);
    fire("proposal.stale", { lead_id: l.id, lead_code: l.code, title: l.title, owner_id: l.owner_id, idle_days: idle, link: `/crm/leads/${l.id}`, summary: `${l.title} — proposal idle for ${idle} days` });
    logActivity(l.id, "followup", `Proposal idle ${idle} days — added to Follow-ups`, SYSTEM);
  }
}

/* ───────────── activity / status ───────────── */
export function logActivity(leadId: number, type: string, summary: string, actor: Actor, meta?: unknown) {
  getDb().prepare("INSERT INTO lead_activities (lead_id, type, summary, user_id, meta) VALUES (?,?,?,?,?)").run(leadId, type, summary, actor.id, meta ? JSON.stringify(meta) : null);
  getDb().prepare("UPDATE leads SET updated_at = ? WHERE id = ?").run(sqlTime(), leadId);
}

/** Records a contact attempt; the first one stops the SLA clock. */
export function logContact(leadId: number, kind: "call" | "email" | "whatsapp" | "meeting", note: string, actor: Actor) {
  const db = getDb();
  const l = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as any;
  if (!l) throw new Error("Lead not found");
  let summary = `${kind[0].toUpperCase()}${kind.slice(1)} logged${note ? ` — ${note}` : ""}`;
  if (!l.first_response_at) {
    const now = sqlTime();
    const resp = Math.round((Date.now() - parseSql(l.received_at)!.getTime()) / 1000);
    const met = resp <= l.sla_seconds;
    db.prepare("UPDATE leads SET first_response_at = ?, sla_status = ? WHERE id = ?").run(now, l.sla_status === "breached" ? "breached" : met ? "met" : "breached", leadId);
    const mm = String(Math.floor(resp / 60)).padStart(2, "0"), ss = String(resp % 60).padStart(2, "0");
    summary += ` · Response time ${mm}:${ss} · SLA ${met && l.sla_status !== "breached" ? "MET" : "BREACHED"}`;
    if (l.status === "NEW") changeStatus(leadId, "CONTACTED", actor, "First contact logged");
  }
  logActivity(leadId, kind, summary, actor);
  audit(actor, `logged ${kind}`, "lead", l.code);
}

export function changeStatus(leadId: number, to: string, actor: Actor, reason?: string) {
  if (!(ALL_LEAD_STATUSES as readonly string[]).includes(to)) throw new Error("Invalid status");
  const db = getDb();
  const l = db.prepare("SELECT code, status FROM leads WHERE id = ?").get(leadId) as { code: string; status: string } | undefined;
  if (!l) throw new Error("Lead not found");
  if (l.status === to) return;
  db.prepare("UPDATE leads SET status = ?, updated_at = ?, lost_reason = CASE WHEN ? IN ('LOST','DISQUALIFIED') THEN ? ELSE lost_reason END WHERE id = ?").run(to, sqlTime(), to, reason ?? null, leadId);
  db.prepare("INSERT INTO lead_status_history (lead_id, from_status, to_status, user_id) VALUES (?,?,?,?)").run(leadId, l.status, to, actor.id);
  logActivity(leadId, "status", `Status: ${l.status} → ${to}${reason ? ` (${reason})` : ""}`, actor);
  audit(actor, "changed lead status", "lead", l.code, l.status, to);
}

export function updateLead(leadId: number, patch: Partial<Record<"vertical" | "solar_type" | "capacity_kw" | "temperature" | "priority" | "est_value" | "expected_close" | "owner_id" | "city", any>>, actor: Actor) {
  const db = getDb();
  const old = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as any;
  const cols = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
  if (!cols.length) return;
  db.prepare(`UPDATE leads SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => patch[c as keyof typeof patch] === "" ? null : patch[c as keyof typeof patch]), sqlTime(), leadId);
  for (const c of cols) if (String(old[c] ?? "") !== String(patch[c as keyof typeof patch] ?? "")) audit(actor, `changed lead ${c}`, "lead", old.code, old[c], patch[c as keyof typeof patch]);
}

export function saveQualification(leadId: number, q: Record<string, string>, actor: Actor) {
  const res = ai.summarizeCall(q);
  const db = getDb();
  db.prepare("UPDATE leads SET qualification = ?, ai_summary = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(q), JSON.stringify(res), sqlTime(), leadId);
  const cap = parseFloat(q.desired_capacity ?? "");
  if (cap) updateLead(leadId, { capacity_kw: cap }, actor);
  logActivity(leadId, "qualification", `Qualification captured — AI recommendation: ${res.recommendation}`, actor);
  return res;
}

export function addTask(leadId: number, title: string, dueAt: string | null, assigneeId: number | null, kind = "follow_up", actor: Actor = SYSTEM) {
  getDb().prepare("INSERT INTO lead_tasks (lead_id, title, kind, due_at, assignee_id) VALUES (?,?,?,?,?)").run(leadId, title, kind, dueAt, assigneeId);
  if (assigneeId) notify({ userId: assigneeId, type: "task_assigned", title: `Task: ${title}`, link: `/crm/leads/${leadId}` });
  logActivity(leadId, "task", `Task added: ${title}`, actor);
}
export function completeTask(taskId: number, actor: Actor) {
  const t = getDb().prepare("SELECT lead_id, title FROM lead_tasks WHERE id = ?").get(taskId) as any;
  getDb().prepare("UPDATE lead_tasks SET status = 'done' WHERE id = ?").run(taskId);
  if (t?.lead_id) logActivity(t.lead_id, "task", `Task completed: ${t.title}`, actor);
}

export function scheduleVisit(leadId: number, v: { scheduled_at: string; location?: string; pm_id?: number | null; designer_id?: number | null; engineer_id?: number | null; contact?: string }, actor: Actor) {
  const db = getDb();
  const id = Number(db.prepare("INSERT INTO site_visits (lead_id, scheduled_at, location, pm_id, designer_id, engineer_id, contact) VALUES (?,?,?,?,?,?,?)").run(leadId, v.scheduled_at, v.location ?? null, v.pm_id ?? null, v.designer_id ?? null, v.engineer_id ?? null, v.contact ?? null).lastInsertRowid);
  logActivity(leadId, "visit", `Site visit scheduled for ${v.scheduled_at}`, actor);
  const l = db.prepare("SELECT status, code FROM leads WHERE id = ?").get(leadId) as any;
  if (["NEW", "CONTACTED", "QUALIFIED"].includes(l.status)) changeStatus(leadId, "SITE_VISIT", actor);
  if (v.pm_id) notify({ userId: v.pm_id, type: "site_survey_scheduled", title: `Site visit scheduled — ${l.code}`, body: `${v.scheduled_at} · ${v.location ?? ""}`, link: `/crm/leads/${leadId}` });
  audit(actor, "scheduled site visit", "lead", l.code);
  return id;
}

/* ───────────── queries ───────────── */
export const LEAD_SELECT = `SELECT l.*, c.name customer_name, c.code customer_code, ct.name contact_name, ct.phone contact_phone, ct.email contact_email, u.name owner_name
  FROM leads l LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN contacts ct ON ct.id = l.contact_id LEFT JOIN users u ON u.id = l.owner_id`;

export function listLeads(o: { q?: string; status?: string; owner?: number; source?: string; page?: number; pageSize?: number }) {
  const where: string[] = [];
  const args: any[] = [];
  if (o.q) { where.push("(l.title LIKE ? OR c.name LIKE ? OR l.code LIKE ? OR ct.name LIKE ? OR l.city LIKE ?)"); const q = `%${o.q}%`; args.push(q, q, q, q, q); }
  if (o.status) { where.push("l.status = ?"); args.push(o.status); }
  if (o.owner) { where.push("l.owner_id = ?"); args.push(o.owner); }
  if (o.source) { where.push("l.source = ?"); args.push(o.source); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pageSize = o.pageSize ?? 15, page = Math.max(1, o.page ?? 1);
  const total = (getDb().prepare(`SELECT COUNT(*) c FROM leads l LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN contacts ct ON ct.id = l.contact_id ${w}`).get(...args) as { c: number }).c;
  const rows = getDb().prepare(`${LEAD_SELECT} ${w} ORDER BY (l.status IN ('WON','LOST','DISQUALIFIED')), l.received_at DESC, l.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as any[];
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
export const getLead = (id: number) => getDb().prepare(`${LEAD_SELECT} WHERE l.id = ?`).get(id) as any | undefined;

export function pipelineBoard() {
  const rows = getDb().prepare(`${LEAD_SELECT} WHERE l.status NOT IN ('LOST','ON_HOLD','DISQUALIFIED') ORDER BY l.updated_at DESC`).all() as any[];
  const cols: Record<string, any[]> = {};
  LEAD_STAGES.forEach((s) => (cols[s] = []));
  rows.forEach((r) => cols[r.status]?.push(r));
  cols.WON = cols.WON.slice(0, 6); // the board shows recent wins only; the full history is in Leads
  return cols;
}

export function followUps() {
  const today = dateOnly(new Date());
  const rows = getDb().prepare(
    `SELECT t.*, l.code lead_code, l.title lead_title, u.name assignee FROM lead_tasks t
     LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN users u ON u.id = t.assignee_id WHERE t.status = 'open' ORDER BY t.due_at`
  ).all() as any[];
  return {
    overdue: rows.filter((r) => r.due_at && r.due_at.slice(0, 10) < today),
    today: rows.filter((r) => r.due_at?.slice(0, 10) === today),
    upcoming: rows.filter((r) => !r.due_at || r.due_at.slice(0, 10) > today),
  };
}
