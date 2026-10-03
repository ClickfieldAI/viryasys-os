"use server";
import { authorize, getUser } from "@/lib/auth";
import { act, s, n, req, type ActionResult } from "@/lib/action-utils";
import { getDb } from "@/lib/db";
import { storage } from "@/lib/providers";
import * as P from "@/lib/services/procurement";
import { canSeeProject } from "@/lib/services/proc/core";
import { forceProcurementTick } from "@/lib/services/proc/tick";

const forbid = () => { throw new Error("You don't have access to that project."); };
async function receiver(projectId: number) {
  const a = await authorize("receiving");
  if (!canSeeProject({ id: a.user.id, role: a.user.role }, projectId)) forbid();
  return a;
}
const projectOfDelivery = (id: number) => (getDb().prepare("SELECT project_id FROM deliveries WHERE id = ?").get(id) as any)?.project_id as number;

/* ───────── plan + requests ───────── */
export async function authorizeProcurementAction(projectId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.authorizeProcurement(projectId, actor, s(fd, "template") || "3-stage"); return { redirect: `/procurement/plans/${projectId}` }; }, "Procurement authorized — plan created from the approved BOQ");
}
export async function addStageAction(planId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.addStage(planId, req(fd, "name", "stage name"), s(fd, "required_date"), actor); }, "Stage added");
}
export async function moveRequirementAction(reqId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.moveRequirement(reqId, Number(req(fd, "stage_id", "stage")), actor); }, "Moved");
}
export async function createRequestAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const code = P.createPurchaseRequest({ project_id: Number(req(fd, "project_id")), requirement_id: Number(req(fd, "requirement_id", "material")), qty: n(fd, "qty") ?? 0, required_by: s(fd, "required_by"), priority: s(fd, "priority"), preferred_vendor_id: n(fd, "preferred_vendor_id"), notes: s(fd, "notes") }, actor);
    return { message: `Purchase request ${code} created` };
  });
}
export async function createStageRequestsAction(stageId: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); const c = P.createRequestsForStage(stageId, actor); if (!c) throw new Error("Everything in this stage is already requested or ordered"); return { message: `${c} purchase request${c > 1 ? "s" : ""} created` }; });
}
export async function cancelRequestAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.cancelRequest(id, actor); }, "Request cancelled");
}

/* ───────── purchase orders ───────── */
function poInput(payload: string): P.PoInput {
  let p: any;
  try { p = JSON.parse(payload); } catch { throw new Error("Invalid PO data"); }
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { project_id: num(p.project_id), vendor_id: num(p.vendor_id), stage_id: p.stage_id ? num(p.stage_id) : null, required_date: p.required_date || undefined, billing_address: p.billing_address, delivery_address: p.delivery_address, payment_terms: p.payment_terms, delivery_terms: p.delivery_terms, notes: p.notes,
    lines: (p.lines ?? []).map((l: any) => ({ requirement_id: num(l.requirement_id), qty: num(l.qty), rate: num(l.rate), tax_pct: l.tax_pct === "" || l.tax_pct == null ? 18 : num(l.tax_pct), request_id: l.request_id ? num(l.request_id) : null, description: l.description ? String(l.description).slice(0, 300) : undefined, spec: l.spec != null ? String(l.spec).slice(0, 500) : undefined, required_date: l.required_date || undefined, extra: l.extra && !num(l.requirement_id) ? { category: String(l.extra.category || "Other"), name: String(l.extra.name || ""), spec: l.extra.spec ? String(l.extra.spec) : undefined, unit: String(l.extra.unit || "nos") } : undefined })) };
}
export async function createPOAction(payload: string, submit: boolean): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const r = P.createPO(poInput(payload), actor);
    if (submit) P.submitPO(r.id, actor);
    return { message: submit ? `PO ${r.code} submitted for approval` : `PO ${r.code} saved as draft`, redirect: `/procurement/${r.id}` };
  });
}
export async function createMultiPOAction(payload: string, submit: boolean): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const base = poInput(payload);
    let raw: any; try { raw = JSON.parse(payload); } catch { throw new Error("Invalid PO data"); }
    const byProject = new Map<number, P.PoLineInput[]>();
    (raw.lines ?? []).forEach((l: any, i: number) => { const pid = Number(l.project_id); byProject.set(pid, [...(byProject.get(pid) ?? []), base.lines[i]]); });
    if (byProject.size === 0) throw new Error("Tick at least one material");
    // All-or-nothing: if any project fails validation, no PO is created.
    const made: { id: number; code: string }[] = [];
    getDb().transaction(() => {
      for (const [pid, lines] of byProject) {
        const r = P.createPO({ ...base, project_id: pid, stage_id: null, delivery_address: undefined, billing_address: undefined, lines }, actor);
        if (submit) P.submitPO(r.id, actor);
        made.push(r);
      }
    })();
    return { message: `${made.length} PO${made.length > 1 ? "s" : ""} created${submit ? " and submitted for approval" : " as drafts"}: ${made.map((m) => m.code).join(", ")}`, redirect: `/procurement/orders?status=${submit ? "PENDING_APPROVAL" : "DRAFT"}` };
  });
}
export async function savePOAction(poId: number, payload: string, submit: boolean): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    P.savePO(poId, poInput(payload), actor);
    if (submit) P.submitPO(poId, actor);
    return { message: submit ? "PO submitted for approval" : "PO saved", redirect: `/procurement/${poId}` };
  });
}
export async function submitPOAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.submitPO(id, actor); }, "Submitted for approval");
}
export async function approvePOAction(id: number): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement", "r");
    P.approvePO(id, actor);
    const st = (getDb().prepare("SELECT status FROM purchase_orders WHERE id = ?").get(id) as any).status;
    return { message: st === "SENT" ? "PO approved and released to the vendor" : "PO approved — release it to the vendor" };
  });
}
export async function rejectPOAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement", "r"); P.rejectPO(id, s(fd, "reason"), actor); }, "PO rejected");
}
export async function releasePOAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); await P.releasePO(id, actor); }, "PO released to the vendor");
}
export async function cancelPOAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.cancelPO(id, s(fd, "reason"), actor); }, "PO cancelled");
}
export async function confirmPOAction(poId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const items = getDb().prepare("SELECT id FROM purchase_order_items WHERE po_id = ?").all(poId) as { id: number }[];
    const lines: P.ConfLine[] = items.map((i) => ({ po_item_id: i.id, status: (s(fd, `status_${i.id}`) || "ACCEPTED") as any, confirmed_qty: n(fd, `qty_${i.id}`) ?? 0, expected_date: s(fd, `date_${i.id}`), expected_time: s(fd, `time_${i.id}`), remarks: s(fd, `remarks_${i.id}`) }));
    P.recordConfirmation(poId, lines, actor);
  }, "Vendor confirmation recorded");
}
export async function updatePromiseAction(itemId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.updatePromise(itemId, req(fd, "date", "new promised date"), s(fd, "time") || undefined, s(fd, "reason"), actor); }, "New promise recorded — the original date is kept");
}
export async function vendorPaymentAction(poId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement", "r"); P.recordVendorPayment(poId, n(fd, "amount") ?? 0, s(fd, "mode") || "NEFT", s(fd, "reference"), s(fd, "note"), actor); }, "Vendor payment recorded");
}

/* ───────── deliveries ───────── */
export async function createDeliveryAction(poId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const items = (getDb().prepare("SELECT id FROM purchase_order_items WHERE po_id = ?").all(poId) as any[]).map((i) => ({ po_item_id: i.id, qty: n(fd, `qty_${i.id}`) ?? 0 }));
    const d = P.createDelivery(poId, items, s(fd, "expected") || null, actor);
    return { message: `Delivery ${d.code} planned`, redirect: `/procurement/deliveries/${d.id}` };
  });
}
export async function splitItemAction(diId: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); const d = P.splitDeliveryItem(diId, n(fd, "qty") ?? 0, req(fd, "expected", "expected date"), actor); return { message: `Split into ${d.code}` }; });
}
export async function markReadyAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.markReady(id, actor); }, "Marked ready for dispatch");
}
export async function dispatchAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.dispatch(id, s(fd, "vehicle"), s(fd, "driver"), actor); }, "Dispatched — in transit");
}

async function savePhotos(fd: FormData, field: string, deliveryId: number, docType: string, actor: any) {
  const del = getDb().prepare("SELECT po_id, project_id FROM deliveries WHERE id = ?").get(deliveryId) as any;
  let c = 0;
  for (const f of fd.getAll(field)) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (!f.type.startsWith("image/")) throw new Error(`${f.name} is not an image`);
    if (f.size > 12 * 1024 * 1024) throw new Error(`${f.name} is larger than 12 MB`);
    const rel = await storage.put(`proc/d${deliveryId}`, f.name, Buffer.from(await f.arrayBuffer()));
    P.addProcDoc({ project_id: del.project_id, po_id: del.po_id, delivery_id: deliveryId, doc_type: docType, name: f.name, file_path: rel }, actor);
    c++;
  }
  return c;
}

export async function receiveDeliveryAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await receiver(projectOfDelivery(id));
    const items = (getDb().prepare("SELECT id FROM delivery_items WHERE delivery_id = ?").all(id) as any[]).map((i) => ({ delivery_item_id: i.id, qty_received: n(fd, `recv_${i.id}`) ?? -1 }));
    P.receiveDelivery(id, { received_by: req(fd, "received_by", "receiver name"), vehicle: s(fd, "vehicle"), driver: s(fd, "driver"), notes: s(fd, "notes"), items }, actor);
    await savePhotos(fd, "photos", id, "Delivery Photos", actor);
  }, "Material received at site");
}
export async function inspectDeliveryAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await receiver(projectOfDelivery(id));
    const rows = getDb().prepare("SELECT id FROM delivery_items WHERE delivery_id = ?").all(id) as any[];
    const items: P.InspectItem[] = rows.map((r) => ({ delivery_item_id: r.id, spec_match: s(fd, `spec_${r.id}`) !== "no", condition: s(fd, `cond_${r.id}`) || "Good", packaging: s(fd, `pack_${r.id}`) || "Intact", serials: s(fd, `serials_${r.id}`), remarks: s(fd, `remarks_${r.id}`), qty_accepted: n(fd, `acc_${r.id}`) ?? 0, qty_damaged: n(fd, `dmg_${r.id}`) ?? 0, qty_rejected: n(fd, `rej_${r.id}`) ?? 0 }));
    const res = P.inspectDelivery(id, { remarks: s(fd, "remarks"), items }, actor);
    await savePhotos(fd, "photos", id, "Inspection Photos", actor);
    return { message: `Inspection recorded — ${res.replace("_", " ").toLowerCase()}. GRN generated.` };
  });
}
export async function acknowledgeDeliveryAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await receiver(projectOfDelivery(id));
    let photo: string | null = null;
    const f = fd.get("photo");
    if (f instanceof File && f.size > 0) { photo = await storage.put(`proc/d${id}`, f.name, Buffer.from(await f.arrayBuffer())); }
    P.acknowledgeDelivery(id, { customer_name: req(fd, "customer_name", "customer name"), signature: s(fd, "signature") || undefined, remarks: s(fd, "remarks"), photo_path: photo, via: "site" }, actor);
  }, "Delivery acknowledged — delivery note signed");
}
/** Customer portal: the customer acknowledges deliveries on their own projects. */
export async function portalAcknowledgeAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const u = await getUser();
    if (!u || u.role !== "customer" || !u.customer_id) throw new Error("Not allowed");
    const own = getDb().prepare("SELECT 1 FROM deliveries d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.customer_id = ?").get(id, u.customer_id);
    if (!own) throw new Error("Not allowed");
    P.acknowledgeDelivery(id, { customer_name: req(fd, "customer_name", "your name"), signature: s(fd, "signature") || undefined, remarks: s(fd, "remarks"), via: "portal" }, { id: u.id, name: u.name, role: u.role });
  }, "Thank you — delivery acknowledged");
}
export async function generateGrnAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await receiver(projectOfDelivery(id)); P.finalizeReceipt(id, actor); }, "GRN generated");
}

/* ───────── material control ───────── */
export async function issueMaterialAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const pid = Number(req(fd, "project_id", "project"));
    const { actor } = await receiver(pid);
    const code = P.issueMaterial({ project_id: pid, requirement_id: Number(req(fd, "requirement_id", "material")), qty: n(fd, "qty") ?? 0, issued_by: req(fd, "issued_by", "issuer"), received_by: req(fd, "received_by", "receiver"), purpose: s(fd, "purpose"), install_stage: s(fd, "install_stage") }, actor);
    return { message: `${code} issued` };
  });
}
export async function consumeMaterialAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const pid = Number(req(fd, "project_id", "project"));
    const { actor } = await receiver(pid);
    P.consumeMaterial({ project_id: pid, requirement_id: Number(req(fd, "requirement_id", "material")), qty: n(fd, "qty") ?? 0, note: s(fd, "note") }, actor);
  }, "Consumption recorded");
}
export async function returnMaterialAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const pid = Number(req(fd, "project_id", "project"));
    const { actor } = await receiver(pid);
    const code = P.returnMaterial({ project_id: pid, requirement_id: Number(req(fd, "requirement_id", "material")), qty: n(fd, "qty") ?? 0, condition: s(fd, "condition"), returned_by: req(fd, "returned_by", "returned by"), received_by: req(fd, "received_by", "received by"), reason: s(fd, "reason") }, actor);
    return { message: `${code} recorded` };
  });
}
export async function reconcileAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const pid = Number(req(fd, "project_id", "project"));
    const { actor } = await receiver(pid);
    const r = P.reconcile(pid, Number(req(fd, "requirement_id", "material")), n(fd, "physical") ?? -1, s(fd, "note"), actor);
    return { message: r.diff === 0 ? "Stock count matches the ledger" : r.diff > 0 ? `${r.diff} unaccounted — variance exception raised` : `${-r.diff} surplus recorded` };
  });
}

/* ───────── exceptions, documents, vendors, Zoho ───────── */
export async function resolveExceptionAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement"); P.resolveException(id, s(fd, "resolution"), actor); }, "Exception resolved");
}
export async function refreshProcurementAction(): Promise<ActionResult> {
  return act(async () => { await authorize("procurement", "r"); forceProcurementTick(); }, "Checked — alerts and exceptions are up to date");
}
export async function uploadProcDocAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file");
    if (f.size > 15 * 1024 * 1024) throw new Error("File too large (max 15 MB)");
    const poId = n(fd, "po_id"), delId = n(fd, "delivery_id");
    const proj = poId ? (getDb().prepare("SELECT project_id FROM purchase_orders WHERE id = ?").get(poId) as any)?.project_id : delId ? projectOfDelivery(delId) : n(fd, "project_id");
    const rel = await storage.put(`proc/${poId ? "po" + poId : delId ? "d" + delId : "p" + proj}`, f.name, Buffer.from(await f.arrayBuffer()));
    P.addProcDoc({ project_id: proj, po_id: poId, delivery_id: delId, doc_type: req(fd, "doc_type", "document type"), name: f.name, file_path: rel }, actor);
  }, "Document attached");
}
export async function saveVendorAction(id: number | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("procurement");
    const vid = P.saveVendor(id, { name: req(fd, "name", "vendor name"), contact: s(fd, "contact"), phone: s(fd, "phone"), email: s(fd, "email"), address: s(fd, "address"), city: s(fd, "city"), gstin: s(fd, "gstin"), categories: fd.getAll("categories").map(String), products: s(fd, "products"), payment_terms: s(fd, "payment_terms"), active: s(fd, "active") !== "no" }, actor);
    return { message: id ? "Vendor updated" : "Vendor created", redirect: `/procurement/vendors/${vid}` };
  });
}
const zohoRoles = ["md", "finance", "admin"];
export async function zohoRetryAction(id: number): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement", "r"); if (!zohoRoles.includes(actor.role!)) throw new Error("Only Finance or the MD can retry accounting syncs."); const r = await P.retryEvent(id, actor); if (r === "FAILED") throw new Error("Sync failed again — see the reason on the event"); }, "Synced to Zoho Books");
}
export async function zohoRetryAllAction(): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement", "r"); if (!zohoRoles.includes(actor.role!)) throw new Error("Only Finance or the MD can retry accounting syncs."); const ok = await P.retryAllFailed(actor); return { message: `${ok} event(s) synced` }; });
}
export async function zohoMappingAction(type: string, enabled: boolean): Promise<ActionResult> {
  return act(async () => { const { actor } = await authorize("procurement", "r"); if (!["md", "finance"].includes(actor.role!)) throw new Error("Only Finance or the MD can approve an accounting mapping."); P.setMapping(type, enabled, actor); }, enabled ? "Mapping approved — new events will sync" : "Mapping disabled");
}
