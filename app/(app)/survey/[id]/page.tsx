import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { surveyFull } from "@/lib/services/design";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, Field, EmptyState } from "@/components/ui";
import { ActionForm, ActionButton } from "@/components/client";
import { Select } from "@/components/forms";
import { saveSurveyAction, addMeasurementAction, uploadPhotoAction, submitSurveyAction } from "@/app/actions/work";
import { fmtDateTime } from "@/lib/util";

export const dynamic = "force-dynamic";
const PHOTO_CATS = ["Roof", "Electrical panel", "EB meter", "Site surroundings", "Obstacles", "Structural details", "Other"];

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard("survey");
  const id = Number((await params).id);
  const { survey: s, measurements, photos } = surveyFull(id);
  if (!s) notFound();
  const lead = getDb().prepare("SELECT l.*, c.name cname FROM leads l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.id = ?").get(s.lead_id) as any;
  const locked = s.status === "SUBMITTED";
  const w = can(user.role, "survey", "w") && !locked;
  const v = (k: string) => s[k] ?? "";
  const dis = !w;
  const missing = ["site_address", "roof_type", "available_area_sqm", "eb_connection"].filter((k) => s[k] == null || s[k] === "");

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader crumbs={[{ label: "Site Surveys", href: "/survey" }, { label: lead.code }]} title={`Site survey — ${lead.cname}`} sub={`${lead.city ?? ""} · PM ${s.pm_name ?? "—"} · ${locked ? `Submitted ${fmtDateTime(s.submitted_at)}` : "Draft"}`}
        actions={<><StatusBadge status={s.status} tone={locked ? "green" : "orange"} /><Link href={`/crm/leads/${lead.id}`} className="btn btn-sm">Lead</Link></>} />

      <ActionForm action={saveSurveyAction.bind(null, id)} resetOnSuccess={false} className="space-y-5">
        <Card title="Site information">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Site address *" className="sm:col-span-2"><input name="site_address" defaultValue={v("site_address")} className="input" disabled={dis} /></Field>
            <Field label="GPS / location" hint="lat, long"><input name="gps" defaultValue={v("gps")} className="input" disabled={dis} placeholder="13.0827, 80.2707" /></Field>
            <Field label="Site type"><Select name="site_type" defaultValue={s.site_type} placeholder="Select…" options={["Factory shed", "Warehouse", "Office / commercial", "Hospital", "School / campus", "Residence", "Open land"]} /></Field>
            <Field label="Roof type *"><Select name="roof_type" defaultValue={s.roof_type} placeholder="Select…" options={["Metal sheet (trapezoidal)", "RCC flat roof", "Asbestos sheet", "Tile roof", "Ground"]} /></Field>
            <Field label="Orientation"><Select name="orientation" defaultValue={s.orientation} placeholder="Select…" options={["South", "South-East", "South-West", "East", "West", "North"]} /></Field>
            <Field label="Roof area (sq m)"><input name="roof_area_sqm" type="number" step="any" defaultValue={v("roof_area_sqm")} className="input" disabled={dis} /></Field>
            <Field label="Available installation area (sq m) *"><input name="available_area_sqm" type="number" step="any" defaultValue={v("available_area_sqm")} className="input" disabled={dis} /></Field>
            <Field label="Shading"><input name="shading" defaultValue={v("shading")} className="input" disabled={dis} placeholder="None / partial (water tank)…" /></Field>
            <Field label="Obstacles"><input name="obstacles" defaultValue={v("obstacles")} className="input" disabled={dis} placeholder="HVAC, skylights, ducts…" /></Field>
            <Field label="Structural observations" className="sm:col-span-2"><textarea name="structural" rows={2} defaultValue={v("structural")} className="input" disabled={dis} /></Field>
            <Field label="Access conditions"><input name="access" defaultValue={v("access")} className="input" disabled={dis} /></Field>
            <Field label="Safety concerns"><input name="safety" defaultValue={v("safety")} className="input" disabled={dis} /></Field>
          </div>
        </Card>
        <Card title="Electrical information">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="EB connection details *" className="sm:col-span-2"><input name="eb_connection" defaultValue={v("eb_connection")} className="input" disabled={dis} placeholder="e.g. HT 11 kV, TANGEDCO, Service No. …" /></Field>
            <Field label="Sanctioned load (kW)"><input name="sanctioned_load_kw" type="number" step="any" defaultValue={v("sanctioned_load_kw")} className="input" disabled={dis} /></Field>
            <Field label="Monthly consumption (kWh)"><input name="monthly_kwh" type="number" step="any" defaultValue={v("monthly_kwh")} className="input" disabled={dis} /></Field>
            <Field label="Annual consumption (kWh)" hint="Left blank → monthly × 12"><input name="annual_kwh" type="number" step="any" defaultValue={v("annual_kwh")} className="input" disabled={dis} /></Field>
            <Field label="Existing electrical infrastructure"><input name="existing_infra" defaultValue={v("existing_infra")} className="input" disabled={dis} placeholder="DG set, APFC panel…" /></Field>
            <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} defaultValue={v("notes")} className="input" disabled={dis} /></Field>
          </div>
        </Card>
        {w && <div className="flex justify-end"><button type="submit" className="btn btn-primary">Save survey</button></div>}
      </ActionForm>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card title="Measurements" flush>
          {measurements.length === 0 ? <EmptyState icon="tool" title="No measurements yet" /> : <table className="tbl"><tbody>{measurements.map((m: any) => <tr key={m.id}><td>{m.label}</td><td className="r num font-semibold">{m.value} {m.unit}</td></tr>)}</tbody></table>}
          {w && <div className="border-t border-line p-3"><ActionForm action={addMeasurementAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
            <Field label="Label" className="min-w-[110px] flex-1"><input name="label" required className="input" placeholder="Roof length" /></Field>
            <Field label="Value" className="w-[84px]"><input name="value" type="number" step="any" required className="input" /></Field>
            <Field label="Unit" className="w-[72px]"><input name="unit" defaultValue="m" className="input" /></Field>
            <button className="btn btn-sm btn-primary" type="submit">Add</button></ActionForm></div>}
        </Card>
        <Card title="Photos" flush>
          {photos.length === 0 ? <EmptyState icon="camera" title="No photos yet" body="Roof, electrical panel, EB meter, surroundings, obstacles." /> : (
            <div className="grid grid-cols-3 gap-2 p-3">{photos.map((p: any) => (
              <a key={p.id} href={p.file_path ? `/api/files/${p.file_path}` : undefined} target="_blank" className="group block overflow-hidden rounded-md border border-line">
                {p.file_path ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/files/${p.file_path}`} alt={p.caption ?? p.category} className="aspect-square w-full object-cover" /> : <div className="grid aspect-square place-items-center bg-[var(--sunk)] text-faint"><span className="text-[11px]">no file</span></div>}
                <div className="truncate px-1.5 py-1 text-[11px] text-muted">{p.category}</div></a>))}</div>)}
          {w && <div className="border-t border-line p-3"><ActionForm action={uploadPhotoAction.bind(null, id)} className="space-y-2">
            <div className="flex flex-wrap gap-2"><Select name="category" options={PHOTO_CATS} className="!w-auto flex-1" /><input name="caption" className="input flex-1" placeholder="Caption (optional)" /></div>
            <input name="photo" type="file" accept="image/*" capture="environment" multiple required className="input !h-auto py-1.5 text-xs" />
            <button className="btn btn-sm btn-primary" type="submit"><span>Upload photos</span></button></ActionForm></div>}
        </Card>
      </div>

      {w && (
        <Card className="mt-5" title="Submit to design">
          <p className="mb-3 text-[13px] text-muted">Submitting locks the survey, creates a design task and notifies the designer with these inputs, photos and measurements.</p>
          {missing.length > 0 && <p className="mb-3 rounded-md bg-[var(--orange-50)] p-2.5 text-[13px] text-[var(--orange)]">Still needed: {missing.map((m) => m.replace(/_/g, " ")).join(", ")}. Save the survey first.</p>}
          <ActionButton action={submitSurveyAction.bind(null, id)} className="btn btn-primary" confirm="Submit this survey?" confirmLabel="Submit survey">Submit survey</ActionButton>
        </Card>)}
    </div>
  );
}
