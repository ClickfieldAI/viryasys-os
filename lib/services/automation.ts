// AutomationService — TRIGGER → CONDITION → ACTION.
// Business services call fire(trigger, ctx); enabled rules in `automation_rules` decide what happens.
import { getDb } from "../db";
import { sqlTime } from "../util";
import { notify, usersByRole, SYSTEM } from "./core";

export type Ctx = Record<string, any>;
interface Cond { field: string; op: "eq" | "neq" | "gte" | "lte" | "contains"; value: any }
interface Action { type: string; [k: string]: any }

export const TRIGGERS: Record<string, string> = {
  "lead.created": "New lead received",
  "lead.sla_breached": "Lead response SLA breached",
  "proposal.stale": "Proposal waiting too long for a customer response",
  "survey.submitted": "Site survey submitted",
  "design.completed": "Design completed",
  "proposal.accepted": "Proposal accepted by customer",
  "payment.advance_received": "Customer advance requirement satisfied",
  "po.approved": "Purchase order approved",
  "vendor.confirmed": "Vendor confirmed a PO",
  "delivery.overdue": "Expected delivery date passed, material not received",
  "material.received": "Material received at site",
  "inspection.completed": "Delivery inspection completed",
  "delivery.acknowledged": "Customer acknowledged a delivery",
  "project.completed": "Project completed",
};
export const ACTION_LABELS: Record<string, string> = {
  assign_salesperson: "Assign salesperson (least loaded)",
  start_sla: "Start response SLA timer",
  notify: "Send notification",
  create_design_task: "Create design task",
  create_project: "Create project",
  generate_payment_schedule: "Generate payment schedule",
  enable_procurement: "Enable procurement (create plan from BOQ)",
  send_po: "Send PO to vendor",
  create_expected_delivery: "Create expected deliveries from vendor promise",
  create_inspection_task: "Create inspection task (notify PM, site engineer, store)",
  generate_grn: "Generate GRN + delivery note",
  close_delivery: "Close delivery",
  request_material_return: "Request return of unused material",
  escalate_manager: "Escalate to manager",
  add_followup: "Add to Follow-ups (assigned to the lead owner)",
};

function test(c: Cond, ctx: Ctx) {
  const v = ctx[c.field];
  switch (c.op) {
    case "eq": return v == c.value;
    case "neq": return v != c.value;
    case "gte": return Number(v) >= Number(c.value);
    case "lte": return Number(v) <= Number(c.value);
    case "contains": return String(v ?? "").toLowerCase().includes(String(c.value).toLowerCase());
  }
}

export function fire(trigger: string, ctx: Ctx): string[] {
  const db = getDb();
  const rules = db.prepare("SELECT * FROM automation_rules WHERE trigger = ? AND enabled = 1 ORDER BY id").all(trigger) as any[];
  const log: string[] = [];
  for (const r of rules) {
    const conds: Cond[] = JSON.parse(r.conditions || "[]");
    if (!conds.every((c) => test(c, ctx))) continue;
    const actions: Action[] = JSON.parse(r.actions);
    const results: string[] = [];
    for (const a of actions) {
      try {
        results.push(`${a.type}: ${runAction(a, ctx)}`);
      } catch (e: any) {
        results.push(`${a.type}: FAILED ${e?.message ?? e}`);
      }
    }
    db.prepare("UPDATE automation_rules SET runs = runs + 1, last_run_at = ? WHERE id = ?").run(sqlTime(), r.id);
    db.prepare("INSERT INTO automation_runs (rule_id, trigger, context, result) VALUES (?,?,?,?)").run(r.id, trigger, JSON.stringify(ctx), results.join(" | "));
    log.push(`${r.name}: ${results.join(", ")}`);
  }
  return log;
}

// Lazy requires avoid import cycles (services → automation → services).
/* eslint-disable @typescript-eslint/no-require-imports */
function runAction(a: Action, ctx: Ctx): string {
  switch (a.type) {
    case "assign_salesperson": {
      const owner = require("./leads").assignOwner(ctx.lead_id);
      ctx.owner_id = owner?.id;
      return owner ? `assigned to ${owner.name}` : "no salesperson available";
    }
    case "start_sla":
      return require("./leads").startSla(ctx.lead_id);
    case "notify": {
      if (a.when && !ctx[a.when]) return "skipped";
      const title = String(a.title ?? "Notification").replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? "");
      const body = a.body ? String(a.body).replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? "") : undefined;
      const link = a.link ? String(a.link).replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? "") : undefined;
      const target = a.to === "owner" ? ctx.owner_id : a.to === "pm" ? ctx.pm_id : a.to === "designer" ? ctx.designer_id : null;
      if (target) notify({ userId: target, type: a.notif ?? "info", title, body, link });
      else notify({ role: a.role ?? "md", type: a.notif ?? "info", title, body, link });
      return "sent";
    }
    case "create_design_task": {
      const id = require("./design").createDesignTask(ctx.lead_id, ctx.survey_id);
      ctx.design_task_id = id;
      return `design task #${id}`;
    }
    case "create_project": {
      const p = require("./projects").createFromProposal(ctx.proposal_id, SYSTEM, ctx.pm_choice ?? null);
      ctx.project_id = p.id; ctx.project_code = p.code; ctx.pm_id = p.pm_id;
      return `created ${p.code}`;
    }
    case "generate_payment_schedule":
      return `${require("./finance").generateSchedule(ctx.project_id, ctx.proposal_id)} milestones`;
    case "enable_procurement": {
      const pr = require("./proc/core") as typeof import("./proc/core");
      pr.authorizeProcurement(ctx.project_id, SYSTEM);
      return "procurement plan created";
    }
    case "send_po": {
      void (require("./proc/orders") as typeof import("./proc/orders")).releasePO(ctx.po_id, SYSTEM).catch((e: Error) => console.error("send_po failed", e.message));
      return "PO released to vendor";
    }
    case "create_expected_delivery":
      return `${(require("./proc/logistics") as typeof import("./proc/logistics")).ensurePlannedDeliveries(ctx.po_id, SYSTEM)} expected delivery(ies)`;
    case "create_inspection_task": {
      const pmId = ctx.pm_id;
      const title = `Inspect delivery ${ctx.delivery_code}`;
      if (pmId) notify({ userId: pmId, type: "task_assigned", title, body: "Check specification, quantity and damage; upload photos.", link: ctx.link });
      notify({ role: "site_engineer", type: "task_assigned", title, link: ctx.link });
      notify({ role: "warehouse", type: "task_assigned", title, link: ctx.link });
      return "inspection task created";
    }
    case "generate_grn":
      (require("./proc/logistics") as typeof import("./proc/logistics")).finalizeReceipt(ctx.delivery_id, SYSTEM);
      return "GRN generated";
    case "close_delivery":
      (require("./proc/logistics") as typeof import("./proc/logistics")).closeDelivery(ctx.delivery_id, SYSTEM);
      return "delivery closed";
    case "request_material_return": {
      const n = (getDb().prepare(`SELECT COUNT(*) c FROM (SELECT requirement_id, SUM(store_delta + site_delta) b FROM inventory_transactions WHERE project_id = ? GROUP BY requirement_id HAVING b > 0)`).get(ctx.project_id) as { c: number }).c;
      if (!n) return "no unused material";
      notify({ role: "procurement", type: "task_assigned", title: `Project ${ctx.project_code} completed — ${n} material(s) with balance to return`, link: `/procurement/inventory/${ctx.project_id}` });
      notify({ role: "warehouse", type: "task_assigned", title: `Return unused material from ${ctx.project_code}`, link: `/procurement/returns` });
      return `${n} material(s) flagged for return`;
    }
    case "add_followup": {
      require("./leads").addTask(ctx.lead_id, (a.title ? String(a.title).replace(/\{(\w+)\}/g, (_: string, k: string) => ctx[k] ?? "") : `Follow up: ${ctx.title}`), sqlTime(), ctx.owner_id ?? null, a.kind ?? "proposal_idle");
      return "added to follow-ups";
    }
    case "escalate_manager": {
      const mds = usersByRole("md");
      mds.forEach((m) => notify({ userId: m.id, type: "sla_breach", title: a.title ?? "Escalation", body: ctx.summary, link: ctx.link }));
      return `escalated to ${mds.length}`;
    }
  }
  return "unknown action";
}

export const rules = () => getDb().prepare("SELECT * FROM automation_rules ORDER BY id").all() as any[];
export const recentRuns = (n = 20) =>
  getDb().prepare("SELECT r.*, ar.name rule_name FROM automation_runs r LEFT JOIN automation_rules ar ON ar.id = r.rule_id ORDER BY r.id DESC LIMIT ?").all(n) as any[];
