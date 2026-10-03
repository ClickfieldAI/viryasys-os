"use server";
import { authorize } from "@/lib/auth";
import { act, s, n, req, dateTimeSql, type ActionResult } from "@/lib/action-utils";
import * as leads from "@/lib/services/leads";
import * as inbox from "@/lib/services/inbox";
import { ingest } from "@/lib/services/inbox";
import { LEAD_SOURCES } from "@/lib/config";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/services/core";

export async function createLeadAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const input = {
      company: s(fd, "company") || null, contact: req(fd, "contact", "contact name"), phone: s(fd, "phone") || null, email: s(fd, "email") || null,
      vertical: s(fd, "vertical") || null, location: req(fd, "location"), capacity_kw: n(fd, "capacity_kw"), solar_type: s(fd, "solar_type") || null,
      source: s(fd, "source") in LEAD_SOURCES ? s(fd, "source") : "manual",
    };
    if (!s(fd, "force")) {
      const dups = leads.findDuplicates(input);
      if (dups.length) throw new Error(`Possible duplicate: ${dups[0].code} “${dups[0].title}” (${dups[0].confidence}% match — ${dups[0].reasons.join(", ")}). Tick “Create anyway” to proceed.`);
    }
    const r = leads.createLead(input, actor);
    return { message: `Lead ${r.code} created`, redirect: `/crm/leads/${r.id}` };
  });
}

export async function logContactAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const kind = s(fd, "kind") as "call" | "email" | "whatsapp" | "meeting";
    if (!["call", "email", "whatsapp", "meeting"].includes(kind)) throw new Error("Choose a contact type");
    leads.logContact(leadId, kind, s(fd, "note"), actor);
  }, "Contact logged");
}

export async function changeStatusAction(leadId: number, status: string, fd?: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    if (["LOST", "DISQUALIFIED"].includes(status) && fd && !s(fd, "reason")) throw new Error("A reason is required");
    leads.changeStatus(leadId, status, actor, fd ? s(fd, "reason") : undefined);
  }, "Status updated");
}

export async function updateLeadAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    leads.updateLead(leadId, {
      temperature: s(fd, "temperature"), priority: s(fd, "priority"), est_value: n(fd, "est_value"), expected_close: s(fd, "expected_close") || null,
      vertical: s(fd, "vertical") || null, solar_type: s(fd, "solar_type") || null, capacity_kw: n(fd, "capacity_kw"), owner_id: n(fd, "owner_id"),
    }, actor);
  }, "Lead updated");
}

export async function saveQualificationAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const q: Record<string, string> = {};
    ["requirement", "segment", "monthly_units", "monthly_bill", "roof_area", "existing_solar", "desired_capacity", "location", "timeline", "decision_maker", "budget", "reason", "site_visit", "solar_type"].forEach((k) => (q[k] = s(fd, k)));
    const r = leads.saveQualification(leadId, q, actor);
    return { message: `AI summary ready — recommendation: ${r.recommendation}` };
  });
}

export async function addTaskAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const due = s(fd, "due_at");
    leads.addTask(leadId, req(fd, "title"), due ? dateTimeSql(due) : null, n(fd, "assignee_id") ?? actor.id, "follow_up", actor);
  }, "Task added");
}
export async function completeTaskAction(taskId: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("crm"); leads.completeTask(taskId, actor); }, "Task completed");
}

export async function scheduleVisitAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const when = req(fd, "scheduled_at", "date & time");
    if (new Date(when).getTime() < Date.now() - 3600_000) throw new Error("Visit time is in the past");
    leads.scheduleVisit(leadId, { scheduled_at: dateTimeSql(when), location: s(fd, "location"), pm_id: n(fd, "pm_id"), designer_id: n(fd, "designer_id"), engineer_id: n(fd, "engineer_id"), contact: s(fd, "contact") }, actor);
  }, "Site visit scheduled");
}

/* ───────── AI inbox ───────── */
export async function ingestManualAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("ai");
    const src = s(fd, "source") as any;
    const r = ingest({ source: ["telegram", "google_chat", "email", "voice", "upload", "manual"].includes(src) ? src : "manual", sender: s(fd, "sender") || "Manual entry", body: req(fd, "body", "message") }, actor);
    return { message: r.status === "NOT_A_LEAD" ? "Stored — AI doesn't think this is a lead" : r.status === "REVIEW" ? "Stored — needs human review" : "Message understood — ready to create the lead" };
  });
}
export async function createFromMessageAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("ai");
    const existing = n(fd, "use_existing");
    const r = inbox.createFromMessage(id, {
      company: s(fd, "company"), contact: s(fd, "contact"), phone: s(fd, "phone"), email: s(fd, "email"), vertical: s(fd, "vertical"),
      location: s(fd, "location"), capacity_kw: n(fd, "capacity_kw"), solar_type: s(fd, "solar_type"),
    }, actor, existing ?? undefined);
    return { message: r.merged ? `Merged into ${r.code}` : `Lead ${r.code} created`, redirect: `/crm/leads/${r.lead_id}` };
  });
}
export async function ignoreMessageAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("ai"); inbox.ignoreMessage(id, actor); }, "Ignored");
}
export async function reprocessMessageAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("ai"); inbox.reprocess(id, actor); }, "Re-processed");
}
export async function toggleAutoCreateAction(on: boolean): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("system");
    const { setSetting } = await import("@/lib/db");
    setSetting("ai_auto_create", on);
    audit(actor, "changed setting", "settings", "ai_auto_create", String(!on), String(on));
  }, "Setting saved");
}
void getDb;
