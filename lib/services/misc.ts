// CustomerService, QueryService, DocumentService, SearchService.
import { getDb, nextCode } from "../db";
import { audit, notify, type Actor } from "./core";
import { storage } from "../providers";

/* ───────────── customers ───────────── */
export function listCustomers(q?: string) {
  const w = q ? "WHERE c.name LIKE ? OR c.code LIKE ? OR c.city LIKE ?" : "";
  return getDb().prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM leads WHERE customer_id=c.id) leads, (SELECT COUNT(*) FROM projects WHERE customer_id=c.id) projects,
      (SELECT name FROM contacts WHERE customer_id=c.id ORDER BY is_primary DESC LIMIT 1) contact, (SELECT phone FROM contacts WHERE customer_id=c.id ORDER BY is_primary DESC LIMIT 1) phone
     FROM customers c ${w} ORDER BY c.id DESC LIMIT 200`
  ).all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [])) as any[];
}
export function customerFull(id: number) {
  const db = getDb();
  const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
  if (!c) return null;
  // Unified communication history: activities across all leads + queries + project updates.
  const comms = db.prepare(
    `SELECT a.created_at at, a.type, a.summary, l.code ref, '/crm/leads/' || l.id href FROM lead_activities a JOIN leads l ON l.id=a.lead_id WHERE l.customer_id = ?
     UNION ALL SELECT q.created_at, 'query', q.subject, q.code, '/queries' FROM customer_queries q WHERE q.customer_id = ?
     UNION ALL SELECT a.created_at, a.type, a.summary, p.code, '/projects/' || p.id FROM project_activities a JOIN projects p ON p.id=a.project_id WHERE p.customer_id = ?
     UNION ALL SELECT m.received_at, 'message', substr(m.body,1,160), m.source, '/ai-inbox' FROM inbound_messages m JOIN leads l ON m.linked_entity = 'lead:' || l.code WHERE l.customer_id = ?
     ORDER BY at DESC LIMIT 60`
  ).all(id, id, id, id) as any[];
  return {
    c,
    contacts: db.prepare("SELECT * FROM contacts WHERE customer_id = ?").all(id) as any[],
    leads: db.prepare("SELECT id, code, title, status, est_value FROM leads WHERE customer_id = ?").all(id) as any[],
    projects: db.prepare("SELECT id, code, name, stage, health FROM projects WHERE customer_id = ?").all(id) as any[],
    proposals: db.prepare("SELECT p.id, p.code, p.status, v.total FROM proposals p JOIN proposal_versions v ON v.proposal_id=p.id AND v.version=p.current_version WHERE p.customer_id = ?").all(id) as any[],
    docs: (db.prepare("SELECT COUNT(*) c FROM documents WHERE customer_id = ?").get(id) as any).c as number,
    comms,
  };
}

/* ───────────── customer queries ───────────── */
export function listQueries(o: { customerId?: number; status?: string } = {}) {
  const w: string[] = [], a: any[] = [];
  if (o.customerId) { w.push("q.customer_id = ?"); a.push(o.customerId); }
  if (o.status) { w.push("q.status = ?"); a.push(o.status); }
  return getDb().prepare(
    `SELECT q.*, p.code project_code, c.name customer_name, u.name assignee FROM customer_queries q LEFT JOIN projects p ON p.id=q.project_id LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN users u ON u.id=q.assigned_to
     ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY q.status IN ('RESOLVED','CLOSED'), q.id DESC LIMIT 200`
  ).all(...a) as any[];
}
export function createQuery(d: { project_id: number; subject: string; description: string; priority: string; due_date?: string }, actor: Actor): string {
  const db = getDb();
  const p = db.prepare("SELECT id, customer_id, pm_id, code FROM projects WHERE id = ?").get(d.project_id) as any;
  if (!p) throw new Error("Project not found");
  if (!d.subject.trim()) throw new Error("Subject is required");
  const code = nextCode("QRY", db);
  db.prepare("INSERT INTO customer_queries (code, project_id, customer_id, subject, description, priority, assigned_to, due_date) VALUES (?,?,?,?,?,?,?,?)").run(code, p.id, p.customer_id, d.subject.trim(), d.description, d.priority, p.pm_id, d.due_date ?? null);
  notify({ userId: p.pm_id, type: "customer_query", title: `Customer query: ${d.subject}`, body: p.code, link: "/queries" });
  audit(actor, "created customer query", "query", code);
  return code;
}
export function updateQuery(id: number, patch: { status?: string; resolution?: string; assigned_to?: number | null }, actor: Actor) {
  const db = getDb();
  const q = db.prepare("SELECT * FROM customer_queries WHERE id = ?").get(id) as any;
  if (patch.status && ["RESOLVED", "CLOSED"].includes(patch.status) && !(patch.resolution ?? q.resolution)) throw new Error("Add a resolution note first");
  db.prepare("UPDATE customer_queries SET status = COALESCE(?, status), resolution = COALESCE(?, resolution), assigned_to = COALESCE(?, assigned_to) WHERE id = ?").run(patch.status ?? null, patch.resolution ?? null, patch.assigned_to ?? null, id);
  if (patch.status && patch.status !== q.status) {
    audit(actor, "changed query status", "query", q.code, q.status, patch.status);
    if (q.project_id) db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,1)").run(q.project_id, "query", `Query "${q.subject}" is now ${patch.status.toLowerCase().replace("_", " ")}`, actor.id);
  }
}

/* ───────────── documents ───────────── */
export function listDocuments(o: { project?: number; type?: string; q?: string; customerVisible?: boolean } = {}) {
  const w: string[] = [], a: any[] = [];
  if (o.project) { w.push("d.project_id = ?"); a.push(o.project); }
  if (o.type) { w.push("d.doc_type = ?"); a.push(o.type); }
  if (o.q) { w.push("d.name LIKE ?"); a.push(`%${o.q}%`); }
  if (o.customerVisible) w.push("d.customer_visible = 1");
  return getDb().prepare(
    `SELECT d.*, c.name customer_name, l.code lead_code, p.code project_code, u.name uploader FROM documents d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN leads l ON l.id=d.lead_id LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN users u ON u.id=d.uploaded_by
     ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY d.id DESC LIMIT 200`
  ).all(...a) as any[];
}
export async function uploadDocument(d: { project_id?: number; lead_id?: number; doc_type: string; module: string; file: File; customer_visible: boolean }, actor: Actor) {
  const db = getDb();
  if (d.file.size > 15 * 1024 * 1024) throw new Error("File too large (max 15 MB)");
  const ref = d.project_id ? (db.prepare("SELECT customer_id, lead_id FROM projects WHERE id = ?").get(d.project_id) as any) : d.lead_id ? (db.prepare("SELECT customer_id, id lead_id FROM leads WHERE id = ?").get(d.lead_id) as any) : null;
  if (!ref) throw new Error("Select a project or lead");
  const rel = await storage.put(`docs/${d.project_id ? "p" + d.project_id : "l" + d.lead_id}`, d.file.name, Buffer.from(await d.file.arrayBuffer()));
  db.prepare("INSERT INTO documents (customer_id, lead_id, project_id, module, doc_type, name, file_path, customer_visible, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)").run(ref.customer_id, ref.lead_id ?? d.lead_id ?? null, d.project_id ?? null, d.module, d.doc_type, d.file.name, rel, d.customer_visible ? 1 : 0, actor.id);
  audit(actor, "uploaded document", "document", d.file.name);
}

/* ───────────── global search ───────────── */
export interface SearchHit { type: string; code: string; title: string; sub?: string; href: string }
export function globalSearch(q: string): { hits: SearchHit[]; docCount: number } {
  q = q.trim();
  if (q.length < 2) return { hits: [], docCount: 0 };
  const db = getDb();
  const like = `%${q}%`;
  const hits: SearchHit[] = [];
  (db.prepare("SELECT l.id, l.code, l.title, l.status FROM leads l LEFT JOIN customers c ON c.id=l.customer_id WHERE l.code LIKE ? OR l.title LIKE ? OR c.name LIKE ? LIMIT 6").all(like, like, like) as any[]).forEach((r) => hits.push({ type: "Lead", code: r.code, title: r.title, sub: r.status, href: `/crm/leads/${r.id}` }));
  (db.prepare("SELECT id, code, name, city FROM customers WHERE name LIKE ? OR code LIKE ? LIMIT 5").all(like, like) as any[]).forEach((r) => hits.push({ type: "Customer", code: r.code, title: r.name, sub: r.city, href: `/crm/customers/${r.id}` }));
  (db.prepare("SELECT ct.id, ct.name, ct.phone, c.name cname, c.id cid FROM contacts ct JOIN customers c ON c.id=ct.customer_id WHERE ct.name LIKE ? OR ct.phone LIKE ? OR ct.email LIKE ? LIMIT 5").all(like, like, like) as any[]).forEach((r) => hits.push({ type: "Contact", code: r.phone ?? "", title: r.name, sub: r.cname, href: `/crm/customers/${r.cid}` }));
  (db.prepare("SELECT p.id, p.code, p.name, p.stage FROM projects p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.code LIKE ? OR p.name LIKE ? OR c.name LIKE ? LIMIT 6").all(like, like, like) as any[]).forEach((r) => hits.push({ type: "Project", code: r.code, title: r.name, sub: r.stage, href: `/projects/${r.id}` }));
  (db.prepare("SELECT p.id, p.code, c.name cname, p.status FROM proposals p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.code LIKE ? OR c.name LIKE ? LIMIT 5").all(like, like) as any[]).forEach((r) => hits.push({ type: "Proposal", code: r.code, title: r.cname ?? r.code, sub: r.status, href: `/proposals/${r.id}` }));
  (db.prepare("SELECT o.id, o.code, v.name vname, o.status FROM purchase_orders o LEFT JOIN vendors v ON v.id=o.vendor_id WHERE o.code LIKE ? OR v.name LIKE ? LIMIT 5").all(like, like) as any[]).forEach((r) => hits.push({ type: "Purchase Order", code: r.code, title: r.vname ?? r.code, sub: r.status, href: `/procurement/${r.id}` }));
  const docCount = (db.prepare("SELECT COUNT(*) c FROM documents d LEFT JOIN customers c ON c.id=d.customer_id WHERE d.name LIKE ? OR c.name LIKE ?").get(like, like) as any).c as number;
  return { hits, docCount };
}
