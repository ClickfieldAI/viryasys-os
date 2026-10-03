// Dashboard, attention queue, activity feed and analytics — read-only aggregation.
import { getDb } from "../db";
import { dateOnly, inrShort, fmtKw, addDays, timeAgo, parseSql } from "../util";
import type { RoleKey } from "../config";
import { LEAD_STAGES, PROJECT_STAGES, label } from "../config";
import { slaInfo } from "./leads";
import { financeSummary } from "./finance";
import { itemLines, towerKpis, health as procHealth } from "./proc/intel";

const one = <T = any>(sql: string, ...a: any[]) => getDb().prepare(sql).get(...a) as T;
const all = <T = any>(sql: string, ...a: any[]) => getDb().prepare(sql).all(...a) as T[];
const count = (sql: string, ...a: any[]) => (one<{ c: number }>(`SELECT COUNT(*) c FROM (${sql})`, ...a)).c;

export interface Kpi { label: string; value: string; sub?: string; href: string; tone?: "warn" | "bad" | "good" }
export interface AttentionItem { key: string; text: string; count: number; href: string; tone: "bad" | "warn" | "info" }
export interface Panel { title: string; href?: string; empty: string; rows: { primary: string; secondary?: string; badge?: string; tone?: string; href: string }[] }

export function attention(): Record<string, AttentionItem> {
  const today = dateOnly(new Date());
  const d = (key: string, text: (n: number) => string, n: number, href: string, tone: AttentionItem["tone"]): [string, AttentionItem] => [key, { key, text: text(n), count: n, href, tone }];
  return Object.fromEntries([
    d("uncontacted", (n) => `${n} lead${n > 1 ? "s haven't" : " hasn't"} been contacted`, count("SELECT id FROM leads WHERE status='NEW' AND first_response_at IS NULL"), "/crm/leads?status=NEW", "bad"),
    d("delayed_ms", (n) => `${n} project milestone${n > 1 ? "s are" : " is"} delayed`, count("SELECT m.id FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE m.status!='DONE' AND m.due_date < ? AND p.stage!='COMPLETED'", today), "/projects?health=DELAYED", "bad"),
    d("proposals", (n) => `${n} proposal${n > 1 ? "s" : ""} awaiting approval`, count("SELECT p.id FROM proposals p JOIN proposal_versions v ON v.proposal_id=p.id AND v.version=p.current_version WHERE v.approval_status='DRAFT'"), "/proposals?status=DRAFT", "warn"),
    d("delivery", (n) => `${n} procurement deliver${n > 1 ? "ies" : "y"} delayed`, itemLines().filter((l) => l.status === "DELAYED").length, "/procurement?view=delayed", "bad"),
    d("queries", (n) => `${n} customer quer${n > 1 ? "ies" : "y"} unanswered`, count("SELECT id FROM customer_queries WHERE status='OPEN'"), "/queries", "warn"),
    d("surveys", (n) => `${n} site survey${n > 1 ? "s" : ""} pending`, count("SELECT l.id FROM leads l WHERE l.status IN ('SITE_VISIT') "), "/survey", "warn"),
    d("design", (n) => `${n} design task${n > 1 ? "s" : ""} pending`, count("SELECT id FROM design_tasks WHERE status!='COMPLETED'"), "/design", "info"),
    d("ai", (n) => `${n} AI inbox item${n > 1 ? "s" : ""} need review`, count("SELECT id FROM inbound_messages WHERE processing_status IN ('REVIEW','READY')"), "/ai-inbox", "info"),
    d("followups", (n) => `${n} follow-up${n > 1 ? "s" : ""} overdue`, count("SELECT id FROM lead_tasks WHERE status='open' AND due_at < ?", today), "/crm/followups", "warn"),
    d("po_drafts", (n) => `${n} purchase order${n > 1 ? "s" : ""} in draft or awaiting approval`, count("SELECT id FROM purchase_orders WHERE status IN ('DRAFT','PENDING_APPROVAL')"), "/procurement/orders?status=PENDING_APPROVAL", "info"),
    d("receipts", (n) => `${n} deliver${n > 1 ? "ies" : "y"} awaiting inspection`, count("SELECT id FROM deliveries WHERE status = 'RECEIVED'"), "/procurement?view=inspection_pending", "warn"),
  ]);
}

const ROLE_ATTENTION: Record<RoleKey, string[]> = {
  md: ["uncontacted", "delayed_ms", "proposals", "delivery", "queries", "surveys"],
  admin: ["ai", "uncontacted", "delayed_ms", "queries"],
  sales: ["uncontacted", "followups", "proposals", "ai", "design"],
  pm: ["surveys", "delayed_ms", "delivery", "queries"],
  designer: ["design"],
  procurement: ["po_drafts", "delivery", "receipts"],
  site_engineer: ["receipts"],
  warehouse: ["receipts"],
  finance: ["po_drafts", "delivery"],
  customer: [],
};

export function dashboardFor(role: RoleKey, userId: number) {
  const att = attention();
  const items = ROLE_ATTENTION[role].map((k) => att[k]).filter((a) => a && a.count > 0);
  const today = dateOnly(new Date());
  const fin = financeSummary();

  const activeProjects = count("SELECT id FROM projects WHERE stage!='COMPLETED'");
  const execution = count("SELECT id FROM projects WHERE stage IN ('PROCUREMENT','MATERIAL_DELIVERY','INSTALLATION','COMMISSIONING','METERING')");
  const delayed = count("SELECT id FROM projects WHERE health IN ('DELAYED','BLOCKED')");
  const newLeads = count("SELECT id FROM leads WHERE received_at >= datetime('now','-30 days')");
  const pipeline = one<{ s: number }>("SELECT COALESCE(SUM(est_value),0) s FROM leads WHERE status NOT IN ('WON','LOST','DISQUALIFIED','ON_HOLD')").s;
  const pending = items.reduce((a, i) => a + i.count, 0);
  const proposalsInProgress = count("SELECT id FROM proposals WHERE status IN ('DRAFT','APPROVED','SENT','NEGOTIATION')");

  const mine = (col: string) => (role === "sales" || role === "pm" ? ` AND ${col} = ${Number(userId)}` : "");
  let kpis: Kpi[];
  let panels: Panel[] = [];

  if (role === "sales") {
    const myLeads = all("SELECT l.*, c.name customer_name FROM leads l LEFT JOIN customers c ON c.id=l.customer_id WHERE l.owner_id = ? AND l.status='NEW' AND l.first_response_at IS NULL ORDER BY l.received_at DESC LIMIT 6", userId);
    kpis = [
      { label: "My New Leads", value: String(count("SELECT id FROM leads WHERE owner_id=? AND status='NEW'", userId)), href: "/crm/leads?status=NEW&mine=1" },
      { label: "Follow-ups Today", value: String(count("SELECT id FROM lead_tasks WHERE status='open' AND assignee_id=? AND substr(due_at,1,10)=?", userId, today)), href: "/crm/followups" },
      { label: "SLA Breaches", value: String(count("SELECT id FROM leads WHERE owner_id=? AND sla_status='breached' AND first_response_at IS NULL", userId)), tone: "bad", href: "/crm/leads?status=NEW" },
      { label: "In Qualification", value: String(count("SELECT id FROM leads WHERE owner_id=? AND status IN ('CONTACTED','QUALIFIED')", userId)), href: "/crm/pipeline" },
      { label: "Proposals Open", value: String(count("SELECT p.id FROM proposals p JOIN leads l ON l.id=p.lead_id WHERE l.owner_id=? AND p.status IN ('DRAFT','APPROVED','SENT','NEGOTIATION')", userId)), href: "/proposals" },
      { label: "My Pipeline", value: inrShort(one<{ s: number }>("SELECT COALESCE(SUM(est_value),0) s FROM leads WHERE owner_id=? AND status NOT IN ('WON','LOST','DISQUALIFIED','ON_HOLD')", userId).s), href: "/crm/pipeline" },
    ];
    panels = [
      { title: "Leads awaiting first response", href: "/crm/leads?status=NEW", empty: "Everything has been contacted.", rows: myLeads.map((l: any) => ({ primary: l.customer_name, secondary: `${fmtKw(l.capacity_kw)} · ${l.city ?? ""}`, badge: slaInfo(l).state, href: `/crm/leads/${l.id}` })) },
      { title: "Negotiations", href: "/crm/pipeline", empty: "No open negotiations.", rows: all("SELECT l.id, l.title, l.est_value FROM leads l WHERE l.owner_id=? AND l.status='NEGOTIATION'", userId).map((l: any) => ({ primary: l.title, secondary: inrShort(l.est_value), href: `/crm/leads/${l.id}` })) },
    ];
  } else if (role === "pm") {
    kpis = [
      { label: "My Projects", value: String(count("SELECT id FROM projects WHERE pm_id=? AND stage!='COMPLETED'", userId)), href: "/projects?mine=1" },
      { label: "Site Surveys Pending", value: String(count("SELECT id FROM site_visits WHERE pm_id=? AND status='SCHEDULED'", userId)), href: "/survey" },
      { label: "In Installation", value: String(count("SELECT id FROM projects WHERE pm_id=? AND stage='INSTALLATION'", userId)), href: "/projects?stage=INSTALLATION" },
      { label: "Delayed", value: String(count("SELECT id FROM projects WHERE pm_id=? AND health IN ('DELAYED','BLOCKED')", userId)), tone: "bad", href: "/projects?health=DELAYED" },
      { label: "Open Customer Issues", value: String(count("SELECT id FROM customer_queries WHERE status IN ('OPEN','IN_PROGRESS')")), href: "/queries" },
      { label: "Milestones Due (7d)", value: String(count("SELECT m.id FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE p.pm_id=? AND m.status='CURRENT' AND m.due_date <= ?", userId, dateOnly(addDays(new Date(), 7)))), href: "/projects" },
    ];
    panels = [
      { title: "My projects", href: "/projects", empty: "No projects assigned.", rows: all("SELECT id, code, name, stage, health FROM projects WHERE pm_id=? AND stage!='COMPLETED' ORDER BY health='ON_TRACK', id DESC LIMIT 8", userId).map((p: any) => ({ primary: p.name, secondary: `${p.code} · ${label(p.stage)}`, badge: p.health, href: `/projects/${p.id}` })) },
      { title: "Upcoming site visits", href: "/survey", empty: "No visits scheduled.", rows: all("SELECT v.id, v.scheduled_at, v.location, l.title, l.id lid FROM site_visits v JOIN leads l ON l.id=v.lead_id WHERE v.pm_id=? AND v.status='SCHEDULED' ORDER BY v.scheduled_at LIMIT 6", userId).map((v: any) => ({ primary: v.title, secondary: `${v.scheduled_at} · ${v.location ?? ""}`, href: `/survey` })) },
    ];
  } else if (role === "designer") {
    kpis = [
      { label: "Assigned Design Tasks", value: String(count("SELECT id FROM design_tasks WHERE designer_id=? AND status!='COMPLETED'", userId)), href: "/design" },
      { label: "Awaiting Start", value: String(count("SELECT id FROM design_tasks WHERE designer_id=? AND status='PENDING'", userId)), href: "/design" },
      { label: "In Progress", value: String(count("SELECT id FROM design_tasks WHERE designer_id=? AND status='IN_PROGRESS'", userId)), href: "/design" },
      { label: "Completed", value: String(count("SELECT id FROM design_tasks WHERE designer_id=? AND status='COMPLETED'", userId)), tone: "good", href: "/design" },
    ];
    panels = [{ title: "My design queue", href: "/design", empty: "No design tasks.", rows: all("SELECT t.id, t.status, t.due_at, l.title FROM design_tasks t JOIN leads l ON l.id=t.lead_id WHERE t.designer_id=? AND t.status!='COMPLETED' ORDER BY t.due_at", userId).map((t: any) => ({ primary: t.title, secondary: `Due ${t.due_at?.slice(0, 10)}`, badge: t.status, href: `/design/${t.id}` })) }];
  } else if (role === "procurement" || role === "site_engineer" || role === "warehouse") {
    const lines = itemLines({ viewer: { id: userId, role } });
    const k = towerKpis(lines, { id: userId, role });
    kpis = role === "procurement" ? [
      { label: "Open POs", value: String(k.openPos), href: "/procurement?view=open" },
      { label: "Awaiting Confirmation", value: String(k.awaitingConfirmation), href: "/procurement?view=awaiting_confirmation" },
      { label: "Payment Pending", value: String(k.paymentPending), href: "/procurement?view=payment_pending" },
      { label: "In Transit", value: String(k.inTransit), href: "/procurement?view=in_transit" },
      { label: "Delayed", value: String(k.delayed), tone: k.delayed ? "bad" : undefined, href: "/procurement?view=delayed" },
      { label: "Inspection Pending", value: String(k.inspectionPending), href: "/procurement?view=inspection_pending" },
    ] : [
      { label: "In Transit To Me", value: String(k.inTransit), href: "/procurement/deliveries" },
      { label: "Expected Today", value: String(k.dueToday), href: "/procurement?view=due_today" },
      { label: "Received Today", value: String(k.receivedToday), href: "/procurement?view=received_today" },
      { label: "Inspection Pending", value: String(k.inspectionPending), tone: k.inspectionPending ? "warn" : undefined, href: "/procurement?view=inspection_pending" },
    ];
    panels = [{ title: role === "procurement" ? "Delayed deliveries" : "Deliveries to receive", href: "/procurement/deliveries", empty: role === "procurement" ? "All current procurement commitments are on schedule." : "Nothing is on its way to your sites.",
      rows: (role === "procurement" ? lines.filter((l) => l.status === "DELAYED") : lines.filter((l) => l.in_transit > 0 || l.pending_inspection > 0)).slice(0, 8).map((l) => ({ primary: l.description, secondary: `${l.po_code} · ${l.project_code} · expected ${l.expected_date ?? "TBC"}`, badge: l.status === "DELAYED" ? "delayed" : l.status, href: `/procurement/${l.po_id}` })) }];
  } else if (role === "finance") {
    const k = towerKpis(itemLines());
    kpis = [
      { label: "POs Awaiting Approval", value: String(count("SELECT id FROM purchase_orders WHERE status='PENDING_APPROVAL'")), tone: "warn", href: "/procurement/orders?status=PENDING_APPROVAL" },
      { label: "Payable to Vendors", value: inrShort(k.payable), href: "/procurement?view=payment_pending" },
      { label: "Committed Value", value: inrShort(k.value), href: "/procurement/orders" },
      { label: "Delayed Lines", value: String(k.delayed), tone: k.delayed ? "bad" : undefined, href: "/procurement?view=delayed" },
    ];
    panels = [{ title: "Purchase orders awaiting approval", href: "/procurement/orders?status=PENDING_APPROVAL", empty: "Nothing waiting for approval.", rows: all(`SELECT o.id, o.code, o.total, v.name vendor FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id WHERE o.status='PENDING_APPROVAL' ORDER BY o.id DESC LIMIT 8`).map((o: any) => ({ primary: o.code, secondary: `${o.vendor} · ${inrShort(o.total)}`, badge: "PENDING_APPROVAL", href: `/procurement/${o.id}` })) }];
  } else {
    // md + admin
    kpis = [
      { label: "Active Projects", value: String(activeProjects), href: "/projects" },
      { label: "New Leads", value: String(newLeads), sub: "last 30 days", href: "/crm/leads" },
      { label: "Pipeline Value", value: inrShort(pipeline), href: "/crm/pipeline" },
      { label: "Projects in Execution", value: String(execution), href: "/projects" },
      { label: "Pending Actions", value: String(pending), tone: pending ? "warn" : undefined, href: "#attention" },
      { label: "Delayed Items", value: String(delayed), sub: "projects", tone: delayed ? "bad" : undefined, href: "/projects?health=DELAYED" },
    ];
    panels = [
      { title: "Where are the materials", href: "/procurement/deliveries", empty: "No open deliveries.", rows: itemLines().filter((l) => l.live && l.remaining > 0 && l.expected_date).sort((x, y) => x.expected_date!.localeCompare(y.expected_date!)).slice(0, 6).map((l) => ({ primary: l.description, secondary: `${l.project_code} · expected ${l.expected_date}`, badge: l.status === "DELAYED" ? "delayed" : l.status, href: `/procurement/${l.po_id}` })) },
    ];
  }
  void proposalsInProgress; void mine;
  return { kpis, attention: items, panels };
}

/* ───────────── live activity feed ───────────── */
export function activityFeed(limit = 8) {
  const rows: { at: string; title: string; sub: string; kind: string; href: string }[] = [];
  all(`SELECT a.created_at at, a.type, a.summary, l.id lid, l.title, l.source FROM lead_activities a JOIN leads l ON l.id=a.lead_id WHERE a.type IN ('created','proposal','survey','design','status','negotiation') ORDER BY a.id DESC LIMIT 20`).forEach((a: any) => {
    const title = a.type === "created" ? `New lead from ${label(a.source)}` : a.type === "survey" ? "Site survey completed" : a.type === "proposal" ? "Proposal update" : a.type === "design" ? "Design update" : a.type === "negotiation" ? "Negotiation update" : "Lead status changed";
    rows.push({ at: a.at, title, sub: `${a.title}${a.type === "created" ? "" : ` — ${a.summary}`}`, kind: a.type, href: `/crm/leads/${a.lid}` });
  });
  all("SELECT a.created_at at, a.summary, a.type, p.id pid, p.code, p.name FROM project_activities a JOIN projects p ON p.id=a.project_id WHERE a.type IN ('delivery','payment','stage','installation','created') ORDER BY a.id DESC LIMIT 15").forEach((a: any) =>
    rows.push({ at: a.at, title: a.type === "delivery" ? "Material received" : a.type === "payment" ? "Payment received" : a.type === "created" ? "Project created" : a.type === "installation" ? "Installation progress" : "Project stage moved", sub: `${a.name} — ${a.summary}`, kind: a.type, href: `/projects/${a.pid}` }));
  all("SELECT n.created_at at, n.title, n.body, n.link FROM notifications n WHERE n.type = 'procurement_delay' ORDER BY n.id DESC LIMIT 5").forEach((n: any) => rows.push({ at: n.at, title: "Material delivery delayed", sub: n.title, kind: "delay", href: n.link ?? "/procurement" }));
  all("SELECT received_at at, source, sender, body, id FROM inbound_messages WHERE processing_status NOT IN ('NOT_A_LEAD','IGNORED') ORDER BY id DESC LIMIT 5").forEach((m: any) => rows.push({ at: m.at, title: `Message received via ${label(m.source)}`, sub: m.body.slice(0, 90), kind: "inbound", href: "/ai-inbox" }));
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit).map((r) => ({ ...r, ago: timeAgo(r.at) }));
}

/* ───────────── analytics ───────────── */
export function analytics() {
  const funnel = LEAD_STAGES.map((s) => ({ stage: s, count: count("SELECT id FROM leads WHERE status = ?", s), value: one<{ s: number }>("SELECT COALESCE(SUM(est_value),0) s FROM leads WHERE status = ?", s).s }));
  const total = count("SELECT id FROM leads");
  const won = count("SELECT id FROM leads WHERE status='WON'");
  const qualified = count("SELECT id FROM leads WHERE status NOT IN ('NEW','CONTACTED','LOST','DISQUALIFIED','ON_HOLD')");
  const bySource = all("SELECT source, COUNT(*) n, SUM(CASE WHEN status='WON' THEN 1 ELSE 0 END) won FROM leads GROUP BY source ORDER BY n DESC");
  const sales = all(
    `SELECT u.name, COUNT(l.id) leads, SUM(CASE WHEN l.status='WON' THEN 1 ELSE 0 END) won,
      AVG(CASE WHEN l.first_response_at IS NOT NULL THEN (julianday(l.first_response_at) - julianday(l.received_at)) * 86400 END) avg_resp,
      SUM(CASE WHEN l.sla_status='met' THEN 1 ELSE 0 END) sla_met, SUM(CASE WHEN l.first_response_at IS NOT NULL THEN 1 ELSE 0 END) responded
     FROM users u LEFT JOIN leads l ON l.owner_id = u.id WHERE u.role='sales' GROUP BY u.id`
  );
  const projectsByStage = PROJECT_STAGES.map((s) => ({ stage: s, count: count("SELECT id FROM projects WHERE stage = ?", s) }));
  const health = all("SELECT health, COUNT(*) n FROM projects WHERE stage != 'COMPLETED' GROUP BY health");
  const durations = one<{ d: number | null }>("SELECT AVG(julianday(completed_at) - julianday(created_at)) d FROM projects WHERE completed_at IS NOT NULL").d;
  const projTotal = count("SELECT id FROM projects");
  const projDone = count("SELECT id FROM projects WHERE stage='COMPLETED'");
  const projectValue = one<{ s: number }>("SELECT COALESCE(SUM(value),0) s FROM projects WHERE stage != 'COMPLETED'").s;
  const pos = { pending: count("SELECT id FROM purchase_orders WHERE status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','VENDOR_CONFIRMED','PARTIALLY_CONFIRMED')"), delayed: new Set(itemLines().filter((l) => l.status === "DELAYED").map((l) => l.po_id)).size };
  return { funnel, total, won, qualified, bySource, sales, projectsByStage, health, avgDuration: durations, projTotal, projDone, projectValue, pos, fin: financeSummary(), conversion: total ? Math.round((won / total) * 100) : 0 };
}
export { parseSql };


/* ───────── executive statistics (MD / Admin dashboard) ───────── */
export function executiveStats() {
  const now = Date.now();
  const d = (n: number) => new Date(now - n * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const new30 = count("SELECT id FROM leads WHERE received_at >= ?", d(30));
  const prev30 = count("SELECT id FROM leads WHERE received_at >= ? AND received_at < ?", d(60), d(30));
  const won = count("SELECT id FROM leads WHERE status='WON'"), lost = count("SELECT id FROM leads WHERE status IN ('LOST','DISQUALIFIED')");
  const totalLeads = count("SELECT id FROM leads");
  const weights: Record<string, number> = { NEW: 0.05, CONTACTED: 0.1, QUALIFIED: 0.2, SITE_VISIT: 0.3, SITE_SURVEY: 0.4, DESIGN: 0.5, PROPOSAL: 0.6, NEGOTIATION: 0.8 };
  const weighted = all("SELECT status, COALESCE(SUM(est_value),0) v FROM leads WHERE status IN ('NEW','CONTACTED','QUALIFIED','SITE_VISIT','SITE_SURVEY','DESIGN','PROPOSAL','NEGOTIATION') GROUP BY status").reduce((a: number, r: any) => a + r.v * (weights[r.status] ?? 0), 0);
  const resp = one<any>("SELECT AVG(CASE WHEN first_response_at IS NOT NULL THEN (julianday(first_response_at) - julianday(received_at)) * 86400 END) s, SUM(CASE WHEN sla_status='met' THEN 1 ELSE 0 END) met, SUM(CASE WHEN sla_status IN ('met','breached') THEN 1 ELSE 0 END) n FROM leads");
  const openProposals = one<any>("SELECT COUNT(*) n, COALESCE(SUM(v.total),0) v FROM proposals p JOIN proposal_versions v ON v.proposal_id=p.id AND v.version=p.current_version WHERE p.status IN ('DRAFT','APPROVED','SENT','NEGOTIATION')");
  const active = one<any>("SELECT COUNT(*) n, COALESCE(SUM(capacity_kw),0) kw, COALESCE(SUM(value),0) v FROM projects WHERE stage != 'COMPLETED'");
  const done = one<any>("SELECT COUNT(*) n, COALESCE(SUM(capacity_kw),0) kw FROM projects WHERE stage = 'COMPLETED'");
  const month = new Date().toISOString().slice(0, 7);
  const collectedMonth = one<any>("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE substr(received_on,1,7) = ?", month).s as number;
  const fin = financeSummary();
  const lines = itemLines();
  const k = towerKpis(lines);
  const h = procHealth(lines);
  const health = all("SELECT health, COUNT(*) n FROM projects WHERE stage != 'COMPLETED' GROUP BY health");
  // weekly new leads (last 8 weeks) and monthly collections (last 6 months)
  const weeks = Array.from({ length: 8 }, (_, i) => { const from = d((7 - i) * 7 + 7), to = d((7 - i) * 7); return { label: new Date(now - ((7 - i) * 7) * 86400000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }), value: count("SELECT id FROM leads WHERE received_at >= ? AND received_at < ?", from, to) }; });
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - (5 - i)); const m = dt.toISOString().slice(0, 7); return { label: dt.toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" }), value: one<any>("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE substr(received_on,1,7) = ?", m).s as number }; });
  const sources = all("SELECT source, COUNT(*) n FROM leads WHERE received_at >= ? GROUP BY source ORDER BY n DESC LIMIT 6", d(90));
  const capByStage = PROJECT_STAGES.filter((st) => st !== "PROJECT_CREATED" && st !== "COMPLETED").map((st) => ({ stage: st, kw: one<any>("SELECT COALESCE(SUM(capacity_kw),0) s FROM projects WHERE stage = ?", st).s as number, n: count("SELECT id FROM projects WHERE stage = ?", st) }));
  const topCustomers = all("SELECT c.name, SUM(p.value) v, SUM(p.capacity_kw) kw FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.stage != 'COMPLETED' GROUP BY c.id ORDER BY v DESC LIMIT 5");
  return {
    new30, leadDelta: prev30 ? Math.round(((new30 - prev30) / prev30) * 100) : null, winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null, conversion: totalLeads ? Math.round((won / totalLeads) * 100) : null,
    weighted, avgResponse: resp?.s ?? null, slaMetPct: resp?.n ? Math.round((resp.met / resp.n) * 100) : null, openProposals, active, done, collectedMonth, fin, proc: { pct: h.pct, payable: k.payable, delayed: k.delayed, value: k.value }, health, weeks, months, sources, capByStage, topCustomers,
    milestonesWeek: count("SELECT m.id FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE m.status='CURRENT' AND m.due_date <= ? AND p.stage != 'COMPLETED'", dateOnly(addDays(new Date(), 7))),
    avgDuration: one<any>("SELECT AVG(julianday(completed_at) - julianday(created_at)) d FROM projects WHERE completed_at IS NOT NULL")?.d ?? null,
  };
}

/** Widgets for the v2 dashboard: recent projects + upcoming milestones (scoped to what the viewer may see). */
export function projectWidgets(user: { id: number; role: RoleKey }) {
  const { scopeSql } = require("./proc/core") as typeof import("./proc/core");
  const s = scopeSql(user as any, "p.id");
  const db = getDb();
  const recent = db.prepare(`SELECT p.id, p.code, p.name, p.city, p.capacity_kw, p.stage, p.health, p.install_progress, p.value FROM projects p WHERE ${s.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT 6`).all(...s.args) as any[];
  const upcoming = db.prepare(`SELECT m.id, m.name, m.due_date, m.status, p.id project_id, p.name project FROM project_milestones m JOIN projects p ON p.id = m.project_id WHERE ${s.sql} AND m.done_at IS NULL AND m.status = 'CURRENT' AND p.stage != 'COMPLETED' AND m.due_date >= ? ORDER BY m.due_date LIMIT 5`).all(...s.args, dateOnly(new Date())) as any[];
  return { recent, upcoming };
}
