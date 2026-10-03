import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { poGate, requirementRows, readyToAuthorize, lockedProjects, canSeeProject } from "@/lib/services/procurement";
import { PageHeader, Card, Icon, EmptyState } from "@/components/ui";
import { POBuilder, ProjectMultiSelect } from "@/components/proc-client";
import { LockedPanel } from "@/components/proc";
import { ActionForm } from "@/components/client";
import { createPOAction, savePOAction, createMultiPOAction, authorizeProcurementAction } from "@/app/actions/procurement";
import { Select } from "@/components/forms";
import { fmtKw } from "@/lib/util";

export const metadata = { title: "New purchase order" };
export const dynamic = "force-dynamic";

export default async function NewPO({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement", "w");
  const sp = await searchParams;
  const db = getDb();
  const viewer = { id: user.id, role: user.role };
  const editId = Number(sp.edit) || 0;
  let projectId = Number(sp.project) || 0;
  let edit: any = null;
  if (editId) {
    edit = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(editId);
    if (!edit || !["DRAFT", "REJECTED"].includes(edit.status)) notFound();
    projectId = edit.project_id;
  }

  const wantsMulti = (sp.projects ?? "").split(",").filter(Boolean).length > 1;
  if (!projectId && !wantsMulti) {
    const authorized = (db.prepare(`SELECT p.id, p.code, p.name, p.capacity_kw,
        (SELECT COUNT(*) FROM material_requirements r WHERE r.project_id = p.id AND r.qty - COALESCE((SELECT SUM(i.qty) FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id WHERE i.requirement_id = r.id AND o.status NOT IN ('CANCELLED','REJECTED')),0) > 0.0001) nreq
      FROM projects p JOIN procurement_plans pl ON pl.project_id = p.id WHERE p.stage != 'COMPLETED' ORDER BY p.id DESC`).all() as any[]).filter((p) => p.nreq > 0);
    const ready = readyToAuthorize(viewer);
    const locked = lockedProjects(viewer, 6);
    return (
      <div>
        <PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }]} title="New procurement" sub="Purchasing is only possible for projects with an approved customer order and the required advance." />
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Authorized projects — tick one or more" flush>
            {authorized.length === 0 ? <EmptyState icon="lock" title="Nothing left to order" body="Every authorized project is fully ordered. Authorize another project on the right once its advance has been received." /> : (
              <ProjectMultiSelect projects={authorized.map((p) => ({ id: p.id, name: p.name, code: p.code, kw: fmtKw(p.capacity_kw), nreq: p.nreq }))} />)}
          </Card>
          <div className="space-y-5">
            <Card title="Ready to authorize" flush>
              {ready.length === 0 ? <EmptyState icon="check" title="Nothing waiting" /> : (
                <ul>{ready.slice(0, 8).map((p: any) => <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 last:border-0"><span className="text-[13px]"><b>{p.customer}</b> <span className="text-xs text-muted num">{p.code}</span></span>
                  <ActionForm action={authorizeProcurementAction.bind(null, p.id)} className="flex gap-1.5" resetOnSuccess={false}><Select name="template" className="!h-7 !w-[110px] text-xs" options={[["3-stage", "3 stages"], ["2-stage", "2 stages"], ["single", "Single"]]} /><button className="btn btn-sm btn-primary" type="submit">Authorize</button></ActionForm></li>)}</ul>)}
            </Card>
            <Card title={<span className="flex items-center gap-2"><Icon name="lock" size={14} className="text-[var(--orange)]" /> Locked</span>} flush>
              {locked.length === 0 ? <EmptyState icon="check" title="No locked projects" /> : (
                <ul>{locked.map((p: any) => <li key={p.id} className="border-b border-line px-4 py-2.5 text-[13px] last:border-0"><b>{p.customer}</b> <span className="text-xs text-muted num">{p.code}</span><div className="text-xs text-[var(--orange)]">{p.gate.reasons[0].message}{p.gate.reasons[0].required ? ` Required ${p.gate.reasons[0].required}, received ${p.gate.reasons[0].received}.` : ""}</div></li>)}</ul>)}
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const multiIds = (sp.projects ?? "").split(",").map(Number).filter(Boolean);
  if (multiIds.length > 1) {
    const ok: any[] = [], bad: { code: string; why: string }[] = [];
    for (const id of multiIds) {
      const g = poGate(id);
      if (g.ok && canSeeProject(viewer, id)) ok.push(g.project); else bad.push({ code: g.project?.code ?? `#${id}`, why: g.reasons[0]?.message ?? "No access" });
    }
    if (ok.length < 2) return (<div><PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }, { label: "New procurement", href: "/procurement/new" }]} title="New purchase order" /><div className="card mx-auto max-w-[560px] p-6 text-[13.5px]">Fewer than two of the selected projects are unlocked for procurement.{bad.map((b) => <div key={b.code} className="mt-1 text-[var(--red)]">{b.code}: {b.why}</div>)}</div></div>);
    const reqs = ok.flatMap((p: any) => {
      const open = db.prepare("SELECT requirement_id, id, qty FROM purchase_requests WHERE project_id = ? AND status = 'OPEN'").all(p.id) as any[];
      return requirementRows(p.id).map((r) => { const q = open.find((x) => x.requirement_id === r.id); return { project_id: p.id, project_label: p.code, id: r.id, name: r.name, spec: r.spec, unit: r.unit, category: r.category, stage_id: r.stage_id, stage_name: r.stage_name, free: Math.round((r.qty - r.ordered) * 100) / 100, est: r.est_unit_cost, required_date: r.required_date, request_id: q?.id ?? null, request_qty: q?.qty ?? null }; });
    });
    const vendors = db.prepare("SELECT id, name, categories, payment_terms FROM vendors WHERE active = 1 ORDER BY name").all() as any[];
    return (
      <div>
        <PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }, { label: "New procurement", href: "/procurement/new" }]} title={`New purchase orders — ${ok.length} projects`} sub="Pick one vendor and the materials from any of the selected projects. One PO is created per project." />
        {bad.length > 0 && <div className="mb-4 rounded-lg border border-[#f0d9a8] bg-[var(--solar-50)] p-3 text-[13px]"><b>Skipped (locked):</b> {bad.map((b) => `${b.code} — ${b.why}`).join(" · ")}</div>}
        <POBuilder key={multiIds.join("-")} project={{ id: ok[0].id, code: ok[0].code, label: ok[0].code, site: "" }} projects={ok.map((p: any) => ({ id: p.id, label: `${p.customer_name} · ${p.code}` }))} vendors={vendors} stages={[]} reqs={reqs} save={createMultiPOAction} />
      </div>
    );
  }

  if (!canSeeProject(viewer, projectId)) notFound();
  const gate = poGate(projectId);
  if (!gate.ok) return (<div><PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }, { label: "New procurement", href: "/procurement/new" }]} title="New purchase order" /><LockedPanel gate={gate} /></div>);

  const p = gate.project;
  const own = new Map<number, number>();
  if (edit) for (const i of db.prepare("SELECT requirement_id, qty FROM purchase_order_items WHERE po_id = ?").all(edit.id) as any[]) own.set(i.requirement_id, i.qty);
  const reqRows = requirementRows(projectId);
  const openReqs = db.prepare("SELECT requirement_id, id, qty FROM purchase_requests WHERE project_id = ? AND status = 'OPEN'").all(projectId) as any[];
  const reqs = reqRows.map((r) => {
    const q = openReqs.find((x) => x.requirement_id === r.id);
    return { id: r.id, name: r.name, spec: r.spec, unit: r.unit, category: r.category, stage_id: r.stage_id, stage_name: r.stage_name, free: Math.round((r.qty - r.ordered + (own.get(r.id) ?? 0)) * 100) / 100, est: r.est_unit_cost, required_date: r.required_date, request_id: q?.id ?? null, request_qty: q?.qty ?? null };
  });
  const stages = db.prepare("SELECT s.id, s.name FROM procurement_stages s JOIN procurement_plans pl ON pl.id = s.plan_id WHERE pl.project_id = ? ORDER BY s.sort").all(projectId) as any[];
  const vendors = db.prepare("SELECT id, name, categories, payment_terms FROM vendors WHERE active = 1 ORDER BY name").all() as any[];
  const catalog = db.prepare("SELECT id, category, name, spec, unit, rate, tax_pct FROM material_catalog WHERE active = 1 ORDER BY category, name, id").all() as any[];
  const initLines: Record<number, { qty: number; rate: number; tax_pct: number; description?: string; spec?: string; required_date?: string }> = {};
  if (edit) for (const i of db.prepare("SELECT requirement_id, qty, rate, tax_pct, description, spec, required_date FROM purchase_order_items WHERE po_id = ?").all(edit.id) as any[]) initLines[i.requirement_id] = { qty: i.qty, rate: i.rate, tax_pct: i.tax_pct, description: i.description, spec: i.spec ?? "", required_date: i.required_date ?? "" };

  return (
    <div>
      <PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Purchase orders", href: "/procurement/orders" }]} title={edit ? `Edit ${edit.code}` : "New purchase order"} sub={`${p.name} · ${p.code} — authorization checked: customer order approved, advance ${gate.receivedPct}% of ${gate.requiredPct}% required.`} />
      <POBuilder key={`${projectId}-${editId}`} project={{ id: projectId, code: p.code, label: `${p.customer_name} · ${p.code}`, site: `${p.name} — ${p.site ?? p.city ?? ""}` }} vendors={vendors} stages={stages} reqs={reqs} catalog={catalog}
        initial={edit ? { vendor_id: edit.vendor_id, stage_id: edit.stage_id, required_date: edit.required_date ?? "", payment_terms: edit.payment_terms ?? "", delivery_terms: edit.delivery_terms ?? "", notes: edit.notes ?? "", billing_address: edit.billing_address ?? "", delivery_address: edit.delivery_address ?? "", lines: initLines } : undefined}
        poId={edit?.id} save={edit ? savePOAction.bind(null, edit.id) : createPOAction} />
    </div>
  );
}
