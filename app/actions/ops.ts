"use server";
import { authorize } from "@/lib/auth";
import { act, s, n, req, type ActionResult } from "@/lib/action-utils";
import * as projects from "@/lib/services/projects";
import * as finance from "@/lib/services/finance";
import * as misc from "@/lib/services/misc";
import { getDb } from "@/lib/db";
import { markRead } from "@/lib/services/core";
import { getUser } from "@/lib/auth";
import { dateOnly } from "@/lib/util";

/* ───────── projects ───────── */
export async function advanceStageAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("projects"); projects.advanceStage(id, actor); }, "Stage advanced");
}
export async function toggleProjectTaskAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("projects"); projects.toggleTask(id, actor); });
}
export async function toggleHandoverAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("projects"); projects.toggleHandover(id, actor); });
}
export async function logInstallAction(projectId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("projects");
    const steps: Record<number, number> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("step_")) steps[Number(k.slice(5))] = Number(v);
    projects.logInstallation(projectId, { log_date: s(fd, "log_date") || dateOnly(new Date()), team: s(fd, "team"), workers: n(fd, "workers") ?? 0, work_done: req(fd, "work_done", "work completed"), issues: s(fd, "issues"), steps }, actor);
  }, "Installation progress logged");
}

/* ───────── queries ───────── */
export async function createQueryAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("queries");
    misc.createQuery({ project_id: Number(req(fd, "project_id", "project")), subject: req(fd, "subject"), description: s(fd, "description"), priority: s(fd, "priority") || "medium", due_date: s(fd, "due_date") || undefined }, actor);
  }, "Query logged");
}
export async function updateQueryAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("queries");
    misc.updateQuery(id, { status: s(fd, "status") || undefined, resolution: s(fd, "resolution") || undefined }, actor);
  }, "Query updated");
}
/** Customer portal: raise a query on one of the customer's own projects. */
export async function portalQueryAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const u = await getUser();
    if (!u || u.role !== "customer" || !u.customer_id) throw new Error("Not allowed");
    const pid = Number(req(fd, "project_id", "project"));
    const own = getDb().prepare("SELECT id FROM projects WHERE id = ? AND customer_id = ?").get(pid, u.customer_id);
    if (!own) throw new Error("Not allowed");
    misc.createQuery({ project_id: pid, subject: req(fd, "subject"), description: s(fd, "description"), priority: "medium" }, { id: u.id, name: u.name, role: u.role });
  }, "Your query has been sent to the project team");
}

/* ───────── finance ───────── */
export async function createInvoiceAction(milestoneId: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("finance"); finance.createInvoiceForMilestone(milestoneId, actor); }, "Invoice drafted");
}
export async function updateInvoiceAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("finance"); finance.updateDraftInvoice(id, { amount: n(fd, "amount") ?? 0, tax: n(fd, "tax") ?? 0, due_on: s(fd, "due_on") }, actor); }, "Invoice updated");
}
export async function issueInvoiceAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("finance"); finance.issueInvoice(id, 15, actor); }, "Invoice issued");
}
export async function recordPaymentAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("finance"); finance.recordPayment(id, n(fd, "amount") ?? 0, s(fd, "mode") || "NEFT", s(fd, "reference"), actor); }, "Payment recorded");
}

/* ───────── documents ───────── */
export async function uploadDocumentAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("documents");
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file");
    await misc.uploadDocument({ project_id: n(fd, "project_id") ?? undefined, lead_id: n(fd, "lead_id") ?? undefined, doc_type: req(fd, "doc_type", "document type"), module: s(fd, "doc_type").toLowerCase().split(" ")[0], file: f, customer_visible: s(fd, "customer_visible") === "on" }, actor);
  }, "Document uploaded");
}

/* ───────── notifications ───────── */
export async function markNotificationsReadAction(id?: number): Promise<ActionResult> {
  return act(async () => { const u = await getUser(); if (u) markRead(u, id); });
}
