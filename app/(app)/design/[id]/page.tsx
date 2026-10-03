import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { designTaskFull, SolarCalculationEngine } from "@/lib/services/design";
import { PageHeader, Card, StatusBadge, Field } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { BoqEditor } from "@/components/boq-editor";
import { saveDesignAction } from "@/app/actions/work";
import { handoffsForLead } from "@/lib/services/handoff";
import { fmtKw, fmtDateTime } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function DesignWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard("design");
  const id = Number((await params).id);
  const d = designTaskFull(id);
  if (!d) notFound();
  if (user.role === "designer" && d.task.designer_id !== user.id) notFound();
  const { task, design, boq, survey } = d;
  const w = can(user.role, "design", "w") && task.status !== "COMPLETED";
  const s = survey?.survey;
  const rec = s ? (() => { try { return SolarCalculationEngine.fromSettings().compute({ annual_kwh: s.annual_kwh ?? undefined, monthly_kwh: s.monthly_kwh ?? undefined, roof_area_sqm: s.available_area_sqm ?? undefined }); } catch { return null; } })() : null;
  const dv = (k: string, fb: any = "") => design?.[k] ?? fb;
  const hand = handoffsForLead(task.lead_id).filter((h: any) => h.designer_id === task.designer_id)[0];

  return (
    <div>
      <PageHeader crumbs={[{ label: "Design", href: "/design" }, { label: task.lead_code }]} title={`Design — ${task.customer_name}`} sub={`${task.city ?? ""} · customer asked for ${fmtKw(task.lead_kw)} · designer ${task.designer_name ?? "unassigned"}`}
        actions={<><StatusBadge status={task.status} tone={task.status === "COMPLETED" ? "green" : task.status === "IN_PROGRESS" ? "orange" : "gray"} /><Link href={`/crm/leads/${task.lead_id}`} className="btn btn-sm">Lead</Link></>} />

      {hand && (
        <Card title="Site information from sales" className="mb-5" actions={<span className="text-xs text-faint">sent {fmtDateTime(hand.sent_at)} by {hand.sender}</span>}>
          {hand.message && <p className="mb-3 rounded-lg bg-[var(--green-50)] p-3 text-[13.5px]">{hand.message}</p>}
          {hand.snapshot.site_notes.length > 0 && <div className="mb-3 space-y-1.5">{hand.snapshot.site_notes.map((n: any, i: number) => <div key={i} className="text-[13px]"><span className="text-xs text-faint">{n.by}:</span> {n.note}</div>)}</div>}
          {(hand.snapshot.survey || hand.snapshot.details?.obstacles?.length || hand.snapshot.measurements?.length) && (
            <div className="mb-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries({ ...(hand.snapshot.survey ?? {}), ...(hand.snapshot.details?.extras ?? {}) }).map(([k, v]) => <div key={k}><span className="text-xs text-faint">{k.replaceAll("_", " ")}:</span> <b>{String(v)}</b></div>)}
              {(hand.snapshot.details?.obstacles ?? []).map((o: any, i: number) => <div key={`o${i}`}><span className="text-xs text-faint">obstacle:</span> <b>{o.desc} {o.l || o.w || o.h ? `(${o.l || "–"}×${o.w || "–"}×${o.h || "–"} m)` : ""}</b>{o.note ? ` — ${o.note}` : ""}</div>)}
              {(hand.snapshot.measurements ?? []).map((m: any, i: number) => <div key={`m${i}`}><span className="text-xs text-faint">{m.label}:</span> <b>{m.value} {m.unit}</b></div>)}
            </div>)}
          {hand.attachments.length > 0 ? <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">{hand.attachments.map((f: any) => f.image
            ? /* eslint-disable-next-line @next/next/no-img-element */ <a key={`${f.kind}${f.id}`} href={`/api/files/${f.path}`} target="_blank" title={f.name}><img src={`/api/files/${f.path}`} alt={f.name} className="aspect-square w-full rounded object-cover" /></a>
            : <a key={`${f.kind}${f.id}`} href={`/api/files/${f.path}`} target="_blank" className="grid aspect-square place-items-center rounded bg-[var(--sunk)] p-1 text-center text-[10px] font-semibold">{f.name}</a>)}</div> : <p className="text-xs text-faint">No files attached.</p>}
          {can(user.role, "crm") && <Link href={`/crm/leads/${task.lead_id}?tab=sitefile`} className="lnk mt-3 inline-block text-xs">Open the full site file →</Link>}
        </Card>)}

      <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <Card title="Site survey inputs">
            {!s ? <p className="text-[13px] text-muted">No survey attached.</p> : (
              <dl className="space-y-2 text-[13px]">
                {([["Address", s.site_address], ["Site type", s.site_type], ["Roof", s.roof_type], ["Orientation", s.orientation], ["Roof area", s.roof_area_sqm && `${s.roof_area_sqm} sq m`], ["Available area", s.available_area_sqm && `${s.available_area_sqm} sq m`], ["Shading", s.shading], ["Obstacles", s.obstacles], ["Structure", s.structural],
                  ["EB connection", s.eb_connection], ["Sanctioned load", s.sanctioned_load_kw && `${s.sanctioned_load_kw} kW`], ["Monthly units", s.monthly_kwh && `${s.monthly_kwh} kWh`], ["Annual units", s.annual_kwh && `${s.annual_kwh} kWh`], ["Existing", s.existing_infra]] as [string, any][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>))}
              </dl>)}
            {survey?.measurements.length ? <div className="mt-3 border-t border-line pt-3 text-[13px]"><div className="eyebrow mb-1">Measurements</div>{survey.measurements.map((m: any) => <div key={m.id} className="flex justify-between"><span className="text-muted">{m.label}</span><span className="num font-semibold">{m.value} {m.unit}</span></div>)}</div> : null}
            {s && <Link href={`/survey/${s.id}`} className="lnk mt-3 inline-block text-xs">Open full survey →</Link>}
          </Card>
          {survey && survey.photos.length > 0 && (
            <Card title={`Photos (${survey.photos.length})`}>
              <div className="grid grid-cols-3 gap-1.5">{survey.photos.map((p: any) => (
                p.file_path ? /* eslint-disable-next-line @next/next/no-img-element */ <a key={p.id} href={`/api/files/${p.file_path}`} target="_blank"><img src={`/api/files/${p.file_path}`} alt={p.category} className="aspect-square w-full rounded object-cover" /></a>
                  : <div key={p.id} className="grid aspect-square place-items-center rounded bg-[var(--sunk)] px-1 text-center text-[10px] text-faint">{p.category}</div>))}</div>
            </Card>)}
          {rec && (
            <Card title="Capacity recommendation">
              <div className="text-3xl font-extrabold num">{rec.recommended_kw} kW</div>
              <div className="mt-1 text-xs text-muted">Limited by {rec.limiting_factor} · {rec.panel_count} × {rec.panel_wp} Wp panels · ≈ {new Intl.NumberFormat("en-IN").format(rec.annual_generation_kwh)} kWh/yr</div>
              {rec.supporting.notes.map((n) => <p key={n} className="mt-2 text-xs text-[var(--orange)]">{n}</p>)}
              <p className="hint mt-2">From the SolarCalculationEngine using the assumptions in Settings.</p>
            </Card>)}
        </div>

        <ActionForm action={saveDesignAction.bind(null, id)} resetOnSuccess={false} className="space-y-5">
          <Card title="System design">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Proposed capacity (kW) *"><input name="capacity_kw" type="number" step="any" defaultValue={dv("capacity_kw", rec?.recommended_kw ?? task.lead_kw ?? "")} className="input" disabled={!w} /></Field>
              <Field label="Estimated generation (kWh/yr)"><input name="est_annual_kwh" type="number" step="any" defaultValue={dv("est_annual_kwh", rec?.annual_generation_kwh ?? "")} className="input" disabled={!w} /></Field>
              <Field label="Structure"><input name="structure" defaultValue={dv("structure", "Hot-dip galvanised MMS")} className="input" disabled={!w} /></Field>
              <Field label="Panel brand *"><input name="panel_brand" defaultValue={dv("panel_brand")} className="input" disabled={!w} placeholder="Waaree / Adani / Vikram" /></Field>
              <Field label="Panel wattage (Wp)"><input name="panel_wp" type="number" defaultValue={dv("panel_wp", rec?.panel_wp ?? 540)} className="input" disabled={!w} /></Field>
              <Field label="Panel count *"><input name="panel_count" type="number" defaultValue={dv("panel_count", rec?.panel_count ?? "")} className="input" disabled={!w} /></Field>
              <Field label="Inverter brand *"><input name="inverter_brand" defaultValue={dv("inverter_brand")} className="input" disabled={!w} placeholder="Sungrow / Huawei" /></Field>
              <Field label="Inverter rating (kW)"><input name="inverter_kw" type="number" step="any" defaultValue={dv("inverter_kw", 100)} className="input" disabled={!w} /></Field>
              <Field label="Inverter count *"><input name="inverter_count" type="number" defaultValue={dv("inverter_count")} className="input" disabled={!w} /></Field>
              <Field label="Technical notes" className="sm:col-span-3"><textarea name="tech_notes" rows={3} defaultValue={dv("tech_notes")} className="input" disabled={!w} placeholder="String design, cable routing, earthing, approvals…" /></Field>
            </div>
          </Card>
          <Card title="Bill of quantities & cost inputs">
            <BoqEditor disabled={!w} initial={boq.map((b: any) => ({ category: b.category, description: b.description, spec: b.spec ?? "", qty: b.qty, unit: b.unit, unit_cost: b.unit_cost }))} />
          </Card>
          {w ? (
            <div className="flex justify-end gap-2">
              <button type="submit" className="btn">Save draft</button>
              <button type="submit" name="complete" value="1" className="btn btn-primary">Submit design & BOQ</button>
            </div>
          ) : task.status === "COMPLETED" ? <p className="text-right text-[13px] text-muted">Design submitted. Sales has been notified to generate the proposal.</p> : null}
        </ActionForm>
      </div>
    </div>
  );
}
