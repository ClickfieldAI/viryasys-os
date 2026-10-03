// InvoiceService + PaymentService.
import { getDb, nextCode } from "../db";
import { addDays, dateOnly, sqlTime } from "../util";
import { audit, notify, SYSTEM, type Actor } from "./core";
import { getProposal } from "./proposals";
import { refreshHealth } from "./projects";

export function generateSchedule(projectId: number, proposalId: number): number {
  const db = getDb();
  if ((db.prepare("SELECT COUNT(*) c FROM payment_milestones WHERE project_id = ?").get(projectId) as any).c) return 0;
  const cur = getProposal(proposalId)!;
  const ins = db.prepare("INSERT INTO payment_milestones (project_id, name, pct, amount, sort) VALUES (?,?,?,?,?)");
  cur.payments.forEach((m, n) => ins.run(projectId, m.name, m.pct, m.amount, n));
  // Advance invoice is drafted straight away — finance reviews/edits before it goes out.
  const first = db.prepare("SELECT id FROM payment_milestones WHERE project_id = ? ORDER BY sort LIMIT 1").get(projectId) as any;
  if (first) createInvoiceForMilestone(first.id, SYSTEM);
  return cur.payments.length;
}

export function createInvoiceForMilestone(milestoneId: number, actor: Actor): number {
  const db = getDb();
  const m = db.prepare("SELECT m.*, p.customer_id, p.proposal_id, p.code pcode FROM payment_milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = ?").get(milestoneId) as any;
  if (m.invoice_id) return m.invoice_id;
  const cur = getProposal(m.proposal_id);
  const taxPct = (cur?.taxes ?? []).reduce((a, t) => a + t.pct, 0);
  const amount = Math.round((m.amount / (1 + taxPct / 100)) * 100) / 100; // milestone amounts are tax-inclusive
  const tax = Math.round((m.amount - amount) * 100) / 100;
  const code = nextCode("INV", db);
  const id = Number(db.prepare("INSERT INTO invoices (code, project_id, customer_id, milestone_id, amount, tax, total, status) VALUES (?,?,?,?,?,?,?, 'DRAFT')").run(code, m.project_id, m.customer_id, milestoneId, amount, tax, m.amount).lastInsertRowid);
  db.prepare("UPDATE payment_milestones SET invoice_id = ?, status = 'INVOICE_DRAFT' WHERE id = ?").run(id, milestoneId);
  audit(actor, "generated invoice", "invoice", code, undefined, `${m.name} ${m.amount}`);
  return id;
}

export function updateDraftInvoice(id: number, d: { amount: number; tax: number; due_on: string }, actor: Actor) {
  const db = getDb();
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as any;
  if (inv.status !== "DRAFT") throw new Error("Only draft invoices can be edited");
  if (!(d.amount > 0)) throw new Error("Amount must be positive");
  db.prepare("UPDATE invoices SET amount = ?, tax = ?, total = ?, due_on = ? WHERE id = ?").run(d.amount, d.tax, d.amount + d.tax, d.due_on || null, id);
  audit(actor, "edited draft invoice", "invoice", inv.code, inv.total, d.amount + d.tax);
}

export function issueInvoice(id: number, dueDays: number, actor: Actor) {
  const db = getDb();
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as any;
  if (inv.status !== "DRAFT") throw new Error("Invoice already issued");
  const today = new Date();
  db.prepare("UPDATE invoices SET status = 'SENT', issued_on = ?, due_on = COALESCE(due_on, ?) WHERE id = ?").run(dateOnly(today), dateOnly(addDays(today, dueDays)), id);
  db.prepare("UPDATE payment_milestones SET status = 'INVOICED' WHERE id = ?").run(inv.milestone_id);
  audit(actor, "issued invoice", "invoice", inv.code);
  (require("./proc/zoho") as typeof import("./proc/zoho")).emitEvent("INVOICE_CREATED", "invoice", id, inv.code, { total: inv.total });
}

export function recordPayment(invoiceId: number, amount: number, mode: string, reference: string, actor: Actor) {
  const db = getDb();
  const inv = db.prepare("SELECT i.*, p.code pcode FROM invoices i LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?").get(invoiceId) as any;
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "DRAFT") throw new Error("Issue the invoice before recording payment");
  const paid = (db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?").get(invoiceId) as any).s;
  const due = Math.round((inv.total - paid) * 100) / 100;
  if (!(amount > 0)) throw new Error("Enter a valid amount");
  if (amount > due + 0.01) throw new Error(`Amount exceeds balance due (${due})`);
  db.prepare("INSERT INTO payments (invoice_id, project_id, amount, received_on, mode, reference, recorded_by) VALUES (?,?,?,?,?,?,?)").run(invoiceId, inv.project_id, amount, dateOnly(new Date()), mode, reference || null, actor.id);
  const full = amount >= due - 0.01;
  db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(full ? "PAID" : "PARTIAL", invoiceId);
  audit(actor, "recorded payment", "invoice", inv.code, undefined, amount);
  notify({ role: "md", type: "payment_received", title: `Payment received: ₹${new Intl.NumberFormat("en-IN").format(amount)} — ${inv.pcode}`, body: `${inv.code} · ${mode}`, link: `/finance/invoices` });
  if (full && inv.milestone_id) {
    db.prepare("UPDATE payment_milestones SET status = 'PAID' WHERE id = ?").run(inv.milestone_id);
    const m = db.prepare("SELECT sort, name FROM payment_milestones WHERE id = ?").get(inv.milestone_id) as any;
    db.prepare("INSERT INTO project_activities (project_id, type, summary, user_id, customer_visible) VALUES (?,?,?,?,1)").run(inv.project_id, "payment", `Payment received — ${m.name}`, actor.id);
  }
  if (inv.project_id) (require("./proc/core") as typeof import("./proc/core")).onCustomerPayment(inv.project_id);
  if (inv.project_id) refreshHealth(inv.project_id);
}

export function listInvoices(status?: string) {
  const today = dateOnly(new Date());
  const rows = getDb().prepare(
    `SELECT i.*, c.name customer_name, p.code project_code, pm.name milestone_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = i.id) paid
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN payment_milestones pm ON pm.id = i.milestone_id
     ORDER BY i.id DESC LIMIT 200`
  ).all() as any[];
  const out = rows.map((r) => ({ ...r, balance: r.total - r.paid, overdue: ["SENT", "PARTIAL"].includes(r.status) && r.due_on && r.due_on < today }));
  return status ? out.filter((r) => (status === "OVERDUE" ? r.overdue : r.status === status)) : out;
}
export const listPayments = () =>
  getDb().prepare(
    `SELECT pay.*, i.code invoice_code, p.code project_code, c.name customer_name, u.name recorded_by_name
     FROM payments pay LEFT JOIN invoices i ON i.id = pay.invoice_id LEFT JOIN projects p ON p.id = pay.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = pay.recorded_by
     ORDER BY pay.id DESC LIMIT 200`
  ).all() as any[];

export function financeSummary() {
  const inv = listInvoices();
  const collected = (getDb().prepare("SELECT COALESCE(SUM(amount),0) s FROM payments").get() as any).s as number;
  const outstanding = inv.filter((i) => i.status !== "DRAFT").reduce((a, i) => a + i.balance, 0);
  const overdue = inv.filter((i) => i.overdue).reduce((a, i) => a + i.balance, 0);
  const drafts = inv.filter((i) => i.status === "DRAFT").length;
  const upcoming = (getDb().prepare("SELECT COALESCE(SUM(amount),0) s FROM payment_milestones WHERE status IN ('PENDING','INVOICE_DRAFT')").get() as any).s as number;
  return { collected, outstanding, overdue, drafts, upcoming };
}
export { sqlTime };
