"use server";
import { authorize } from "@/lib/auth";
import { act, s, n, req, type ActionResult } from "@/lib/action-utils";
import * as design from "@/lib/services/design";
import * as proposals from "@/lib/services/proposals";
import { storage } from "@/lib/providers";
import { getDb } from "@/lib/db";

/* ───────── site survey ───────── */
export async function startSurveyAction(leadId: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("survey");
    const id = design.getOrCreateSurvey(leadId, actor);
    return { redirect: `/survey/${id}` };
  });
}
export async function saveSurveyAction(surveyId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("survey");
    const st = (getDb().prepare("SELECT status FROM site_surveys WHERE id = ?").get(surveyId) as any)?.status;
    if (st === "SUBMITTED") throw new Error("Survey already submitted");
    const data: Record<string, string> = {};
    ["site_address", "gps", "site_type", "roof_type", "roof_area_sqm", "available_area_sqm", "orientation", "shading", "obstacles", "structural", "access", "safety", "eb_connection", "sanctioned_load_kw", "monthly_kwh", "annual_kwh", "existing_infra", "notes"].forEach((k) => {
      if (fd.has(k)) data[k] = s(fd, k);
    });
    for (const k of ["roof_area_sqm", "available_area_sqm", "sanctioned_load_kw", "monthly_kwh", "annual_kwh"]) if (data[k] && Number.isNaN(Number(data[k]))) throw new Error(`${k.replace(/_/g, " ")} must be a number`);
    design.saveSurvey(surveyId, data, actor);
  }, "Survey saved");
}
export async function addMeasurementAction(surveyId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await authorize("survey");
    const v = n(fd, "value");
    if (v == null) throw new Error("Value is required");
    design.addMeasurement(surveyId, req(fd, "label"), v, s(fd, "unit") || "m");
  }, "Measurement added");
}
export async function uploadPhotoAction(surveyId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("survey");
    const files = fd.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Choose at least one photo");
    for (const f of files) {
      if (!f.type.startsWith("image/")) throw new Error(`${f.name} is not an image`);
      if (f.size > 12 * 1024 * 1024) throw new Error(`${f.name} is larger than 12 MB`);
      const rel = await storage.put(`survey/${surveyId}`, f.name, Buffer.from(await f.arrayBuffer()));
      design.addPhoto(surveyId, s(fd, "category") || "Site", rel, s(fd, "caption") || null, actor);
    }
    return { message: `${files.length} photo${files.length > 1 ? "s" : ""} uploaded` };
  });
}
export async function submitSurveyAction(surveyId: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("survey");
    design.submitSurvey(surveyId, actor);
    return { message: "Survey submitted — design task created and designer notified", redirect: "/survey" };
  });
}

/* ───────── design ───────── */
export async function saveDesignAction(taskId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("design");
    const complete = s(fd, "complete") === "1";
    const cats = fd.getAll("boq_category").map(String), descs = fd.getAll("boq_description").map(String), specs = fd.getAll("boq_spec").map(String);
    const qtys = fd.getAll("boq_qty").map(Number), units = fd.getAll("boq_unit").map(String), costs = fd.getAll("boq_cost").map(Number);
    const boq = descs.map((d, i) => ({ category: cats[i] || "Other", description: d.trim(), spec: specs[i], qty: qtys[i] || 0, unit: units[i] || "nos", unit_cost: costs[i] || 0 }));
    const d = {
      capacity_kw: n(fd, "capacity_kw"), panel_brand: s(fd, "panel_brand"), panel_wp: n(fd, "panel_wp"), panel_count: n(fd, "panel_count"),
      inverter_brand: s(fd, "inverter_brand"), inverter_kw: n(fd, "inverter_kw"), inverter_count: n(fd, "inverter_count"), structure: s(fd, "structure"),
      est_annual_kwh: n(fd, "est_annual_kwh"), tech_notes: s(fd, "tech_notes"),
    };
    if (complete) {
      const missing = (["capacity_kw", "panel_brand", "panel_count", "inverter_brand", "inverter_count"] as const).filter((k) => !d[k]);
      if (missing.length) throw new Error(`Complete the design before submitting: ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}`);
      if (!boq.filter((b) => b.description && b.qty > 0).length) throw new Error("Add at least one BOQ line");
    }
    design.saveDesign(taskId, d, boq, actor, complete);
    return complete ? { message: "Design submitted — sales notified", redirect: "/design" } : { message: "Draft saved" };
  });
}

/* ───────── proposals ───────── */
export async function generateProposalAction(leadId: number, fd?: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    const id = proposals.generateProposal(leadId, actor, fd ? s(fd, "payment_template") || undefined : undefined);
    return { message: "Proposal generated from survey, design and BOQ", redirect: `/proposals/${id}` };
  });
}
export async function saveProposalAction(id: number, payload: string): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    let p: any;
    try { p = JSON.parse(payload); } catch { throw new Error("Invalid proposal data"); }
    const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    if (!Array.isArray(p.items) || !Array.isArray(p.taxes) || !Array.isArray(p.terms) || !p.doc?.sections) throw new Error("Invalid proposal data");
    proposals.saveDraft(id, {
      items: p.items.map((i: any) => ({ description: String(i.description ?? ""), spec: String(i.spec ?? ""), qty: num(i.qty), unit: String(i.unit || "nos"), rate: num(i.rate) })),
      discount: num(p.discount),
      taxes: p.taxes.map((t: any) => ({ name: String(t.name || "Tax"), pct: Math.max(0, Math.min(100, num(t.pct))) })),
      terms: p.terms.map((t: any) => ({ name: String(t.name || "Milestone"), pct: num(t.pct) })),
      doc: p.doc,
    }, actor);
  }, "Draft saved");
}
const sendMsg = (r: proposals.SendResult | null) =>
  !r ? "Proposal approved"
    : r.status === "SENT" ? "Proposal approved and emailed to the customer"
    : r.status === "NOT_CONFIGURED" ? "Approved. Email not sent — outgoing email (SMTP) isn't configured yet; send it from this page once it is"
    : r.status === "NO_RECIPIENT" ? "Approved. Not emailed — the customer contact has no email address"
    : `Approved, but the email failed: ${r.error}`;

/** Approving = the proposal is done. If auto-send is on (Settings), it is emailed to the customer immediately. */
export async function approveProposalAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("proposals"); return { message: sendMsg(await proposals.approveAndSend(id, actor)) }; });
}
export async function sendProposalNowAction(id: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    const r = await proposals.sendProposalEmail(id, actor, "manual");
    if (r.status !== "SENT") throw new Error(sendMsg(r));
    return { message: "Proposal emailed to the customer" };
  });
}
export async function markSentAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("proposals"); proposals.markSent(id, actor, "sent to customer (manually)"); }, "Marked as sent to customer");
}
export async function uploadPlanViewAction(proposalId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a plan view file");
    if (!/\.(png|jpe?g|pdf)$/i.test(f.name)) throw new Error("Plan view must be a PNG, JPG or PDF");
    const cur = proposals.getProposal(proposalId);
    if (!cur) throw new Error("Proposal not found");
    const { uploadDocument } = await import("@/lib/services/misc");
    await uploadDocument({ lead_id: cur.proposal.lead_id, doc_type: "Plan view", module: "proposal", file: f, customer_visible: true }, actor);
  }, "Plan view uploaded");
}
export async function removePlanViewAction(docId: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    getDb().prepare("DELETE FROM documents WHERE id = ? AND doc_type = 'Plan view'").run(docId);
    (await import("@/lib/services/core")).audit(actor, "removed plan view", "document", docId);
  }, "Plan view removed");
}
export async function reviseProposalAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("proposals"); const v = proposals.revise(id, s(fd, "note"), actor); return { message: `Revision V${v} created` }; });
}
export async function logNegotiationAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("proposals"); proposals.logNegotiation(id, s(fd, "kind") || "Customer request", req(fd, "note"), actor); }, "Negotiation note logged");
}
export async function acceptProposalAction(id: number, fd?: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    const pm = fd ? Number(fd.get("pm_id")) || null : null;
    const r = proposals.accept(id, actor, pm);
    return { message: r.project_code ? `Won! Project ${r.project_code} created — payment schedule and advance invoice drafted` : "Marked won", redirect: r.project_id ? `/projects/${r.project_id}` : undefined };
  });
}
export async function rejectProposalAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("proposals"); proposals.reject(id, s(fd, "reason"), actor); }, "Marked lost");
}
export async function saveTemplateAction(id: number, payload: string): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("system");
    let doc: any;
    try { doc = JSON.parse(payload); } catch { throw new Error("Invalid template"); }
    if (!Array.isArray(doc.sections) || !doc.brand) throw new Error("Invalid template");
    if (!doc.sections.every((x: any) => x.key && x.title != null && typeof x.body === "string")) throw new Error("Every section needs a title and body");
    proposals.saveTemplate(id, doc, actor);
  }, "Template saved");
}
export async function uploadLogoAction(fd: FormData): Promise<ActionResult & { path?: string }> {
  try {
    await authorize("system");
    const f = fd.get("logo");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose an image");
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(f.type)) throw new Error("Logo must be PNG, JPG, SVG or WebP");
    if (f.size > 2 * 1024 * 1024) throw new Error("Logo must be under 2 MB");
    const rel = await storage.put("brand", f.name, Buffer.from(await f.arrayBuffer()));
    return { ok: true, path: `/api/files/${rel}`, message: "Logo uploaded — save the template to apply it" };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function createProjectForLeadAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    const r = proposals.createProjectForLead(leadId, Number(fd.get("pm_id")) || null, actor);
    return { message: `Project ${r.project_code} created and the project manager has been notified`, redirect: `/projects/${r.project_id}` };
  });
}
export async function assignProjectManagerAction(projectId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("proposals");
    const pm = Number(fd.get("pm_id"));
    if (!pm) throw new Error("Choose a project manager");
    (await import("@/lib/services/projects")).assignPM(projectId, pm, actor);
  }, "Project manager assigned and notified");
}

export async function addPlanTaskAction(projectId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("projects");
    (await import("@/lib/services/projects")).addPlanTask(projectId, { stage: String(fd.get("stage")), title: String(fd.get("title") ?? ""), due: String(fd.get("due") ?? "") || null, assignee_id: Number(fd.get("assignee_id")) || null }, actor);
  }, "Task added to the plan");
}
export async function removePlanTaskAction(taskId: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("projects"); (await import("@/lib/services/projects")).removePlanTask(taskId, actor); }, "Task removed");
}
export async function setMilestoneDueAction(milestoneId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("projects"); (await import("@/lib/services/projects")).setMilestoneDue(milestoneId, String(fd.get("due") ?? ""), actor); }, "Due date updated");
}

export async function addSiteNoteAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("crm"); (await import("@/lib/services/handoff")).addSiteNote(leadId, String(fd.get("note") ?? ""), actor); }, "Note added to the site file");
}
export async function uploadSiteFilesAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Choose at least one photo or file");
    const { uploadDocument } = await import("@/lib/services/misc");
    const kind = String(fd.get("doc_type") || "Site Photo");
    for (const f of files) await uploadDocument({ lead_id: leadId, doc_type: kind, module: "site", file: f, customer_visible: false }, actor);
    return { message: `${files.length} file${files.length > 1 ? "s" : ""} added to the site file` };
  });
}
export async function sendToDesignerAction(leadId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    const r = (await import("@/lib/services/handoff")).sendToDesigner(leadId, Number(fd.get("designer_id")), String(fd.get("message") ?? ""), fd.getAll("pick").map(String), actor);
    return { message: `Sent to the designer with ${r.files} file${r.files === 1 ? "" : "s"} — they've been notified` };
  });
}

export async function saveSiteInputsAction(leadId: number, payload: string): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("crm");
    let p: any; try { p = JSON.parse(payload); } catch { throw new Error("Invalid data"); }
    const str = (o: any) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, String(v ?? "")]));
    (await import("@/lib/services/handoff")).saveSiteInputs(leadId, {
      fields: str(p.fields), extras: str(p.extras),
      obstacles: (p.obstacles ?? []).map((o: any) => ({ desc: String(o.desc ?? ""), l: String(o.l ?? ""), w: String(o.w ?? ""), h: String(o.h ?? ""), note: String(o.note ?? "") })),
      measurements: (p.measurements ?? []).map((m: any) => ({ label: String(m.label ?? ""), value: Number(m.value), unit: String(m.unit || "m") })),
    }, actor);
  }, "Site details saved");
}

export async function createLayoutAction(leadId: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("design");
    const r = (await import("@/lib/services/layouts")).createLayout(leadId, actor);
    return { message: `Layout ${r.code} created`, redirect: `/design/layouts/${r.id}` };
  });
}
export async function createLayoutForProjectAction(projectId: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("design");
    const r = (await import("@/lib/services/layouts")).createLayoutForProject(projectId, actor);
    return { message: `Layout ${r.code} ready`, redirect: `/design/layouts/${r.id}` };
  });
}
export async function saveLayoutAction(id: number, payload: string): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("design");
    let p: any; try { p = JSON.parse(payload); } catch { throw new Error("Invalid data"); }
    const rev = (await import("@/lib/services/layouts")).saveLayout(id, p.sheet, p.drawing, actor);
    return { message: `Saved · Rev ${rev}` };
  });
}
export async function issueLayoutAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("design"); (await import("@/lib/services/layouts")).issueLayout(id, actor); }, "Revision issued");
}
export async function setLayoutAerialAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("design");
    const f = fd.get("file");
    await (await import("@/lib/services/layouts")).setAerial(id, { file: f instanceof File && f.size > 0 ? f : undefined, path: String(fd.get("path") || "") || undefined }, actor);
  }, "Aerial image updated");
}
export async function attachLayoutToProposalAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("design");
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Nothing to attach");
    const code = await (await import("@/lib/services/layouts")).attachToProposal(id, f, actor);
    return { message: `Attached to proposal ${code} as its plan view` };
  });
}
