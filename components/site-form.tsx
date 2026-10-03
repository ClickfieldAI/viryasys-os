"use client";
import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import { useToast, type ActionResult } from "./client";

type Obs = { desc: string; l: string; w: string; h: string; note: string };
type Meas = { label: string; value: string; unit: string };
export interface SiteInit { fields: Record<string, any>; extras: Record<string, string>; obstacles: Obs[]; measurements: { label: string; value: number; unit: string }[] }

const SITE_TYPES = ["Rooftop", "Ground mount", "Carport / shed", "Floating", "Other"];
const ROOF_TYPES = ["RCC flat", "Metal sheet (GI / colour-coated)", "Asbestos", "Clay / Mangalore tile", "Fibre cement", "Ground / open land", "Other"];
const DIRS = ["South", "South-East", "South-West", "East", "West", "North-East", "North-West", "North", "Flat / multiple"];
const SHADING = ["None", "Light (a few hours)", "Moderate", "Heavy"];

type Cx = { f: Record<string, string>; x: Record<string, string>; setField: (k: string, v: string) => void; setExtra: (k: string, v: string) => void; canEdit: boolean };
const Ctx = createContext<Cx>(null as unknown as Cx);
const val = (c: Cx, k: string, extra?: boolean) => (extra ? c.x[k] : c.f[k]) ?? "";
const put = (c: Cx, k: string, v: string, extra?: boolean) => (extra ? c.setExtra(k, v) : c.setField(k, v));

function T({ k, label, ph, extra, type = "text", unit, span }: { k: string; label: string; ph?: string; extra?: boolean; type?: string; unit?: string; span?: boolean }) {
  const c = useContext(Ctx);
  return (
    <div className={span ? "sm:col-span-2" : ""}>
      <label className="label">{label}{unit && <span className="ml-1 font-normal text-faint">({unit})</span>}</label>
      <input className="input" type={type} step="any" min={type === "number" ? 0 : undefined} disabled={!c.canEdit} placeholder={ph} value={val(c, k, extra)} onChange={(e) => put(c, k, e.target.value, extra)} />
    </div>);
}
function S({ k, label, opts, extra }: { k: string; label: string; opts: string[]; extra?: boolean }) {
  const c = useContext(Ctx);
  return (
    <div><label className="label">{label}</label>
      <select className="input" disabled={!c.canEdit} value={val(c, k, extra)} onChange={(e) => put(c, k, e.target.value, extra)}><option value="">Select…</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></div>);
}
function A({ k, label, ph, extra }: { k: string; label: string; ph?: string; extra?: boolean }) {
  const c = useContext(Ctx);
  return <div className="sm:col-span-2"><label className="label">{label}</label><textarea rows={2} className="input" disabled={!c.canEdit} placeholder={ph} value={val(c, k, extra)} onChange={(e) => put(c, k, e.target.value, extra)} /></div>;
}
function Sec({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="border-b border-line px-5 py-4 last:border-0"><div className="mb-3"><h4 className="text-[13.5px] font-extrabold">{title}</h4>{hint && <p className="text-xs text-faint">{hint}</p>}</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div></div>;
}

export function SiteInputsForm({ init, save, canEdit }: { init: SiteInit; save: (payload: string) => Promise<ActionResult>; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(Object.entries(init.fields).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [x, setX] = useState<Record<string, string>>(init.extras);
  const [obs, setObs] = useState<Obs[]>(init.obstacles.length ? init.obstacles : []);
  const [meas, setMeas] = useState<Meas[]>(init.measurements.map((m) => ({ label: m.label, value: String(m.value), unit: m.unit })));
  const [busy, setBusy] = useState(false);
  const setField = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const setExtra = (k: string, v: string) => setX((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await save(JSON.stringify({ fields: f, extras: x, obstacles: obs, measurements: meas.map((m) => ({ ...m, value: Number(m.value) })).filter((m) => m.label.trim() && m.value !== undefined && m.value.toString() !== "NaN") }));
      if (r.ok) { toast(r.message ?? "Saved"); router.refresh(); } else toast(r.error ?? "Could not save", "error");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  return (
    <Ctx.Provider value={{ f, x, setField, setExtra, canEdit }}>
    <div className="card">
      <div className="card-h"><h3>Site inputs — enter everything measured or observed</h3><span className="text-xs text-faint">saved to the site survey · shared with the designer</span></div>

      <Sec title="1 · Location & site type">
        <T k="site_address" label="Site address" span /><T k="gps" label="GPS / map link" ph="e.g. 12.9716, 79.1587" />
        <S k="site_type" label="Installation type" opts={SITE_TYPES} /><T k="contact_on_site" label="Contact on site" extra ph="Name · phone" />
      </Sec>

      <Sec title="2 · Space available" hint="Measure the plain usable roof / land, not the total built-up area.">
        <T k="roof_area_sqm" label="Total roof / land area" type="number" unit="sq m" /><T k="available_area_sqm" label="Usable area for panels" type="number" unit="sq m" /><T k="shadow_free_area_sqm" label="Shadow-free area" extra type="number" unit="sq m" />
        <T k="roof_length_m" label="Length" extra type="number" unit="m" /><T k="roof_width_m" label="Width" extra type="number" unit="m" /><T k="parapet_height_m" label="Parapet height" extra type="number" unit="m" />
        <S k="roof_type" label="Roof type / surface" opts={ROOF_TYPES} /><T k="roof_age_yrs" label="Roof age" extra type="number" unit="years" /><T k="roof_height_m" label="Roof height from ground" extra type="number" unit="m" />
      </Sec>

      <Sec title="3 · Angle & orientation">
        <T k="tilt_deg" label="Roof tilt / slope angle" extra type="number" unit="°" /><T k="azimuth_deg" label="Azimuth (0° = North, 180° = South)" extra type="number" unit="°" /><S k="orientation" label="Facing direction" opts={DIRS} />
        <T k="planned_tilt_deg" label="Planned panel tilt" extra type="number" unit="°" ph="e.g. 10–15 for TN" /><T k="row_spacing_m" label="Row spacing available" extra type="number" unit="m" />
      </Sec>

      <Sec title="4 · Shading" hint="Trees, buildings, water tanks, towers, chimneys.">
        <S k="shading" label="Shading level" opts={SHADING} /><T k="shading_source" label="Shading source" extra ph="e.g. neighbouring tower, coconut trees" /><T k="shading_hours" label="Hours shaded (worst day)" extra type="number" unit="hrs" />
      </Sec>

      <div className="border-b border-line px-5 py-4">
        <div className="mb-2 flex items-center justify-between"><div><h4 className="text-[13.5px] font-extrabold">5 · Obstacles & dimensions</h4><p className="text-xs text-faint">Water tanks, staircase headroom, AC units, skylights, poles — with their sizes.</p></div>
          {canEdit && <button type="button" className="btn btn-sm" onClick={() => setObs([...obs, { desc: "", l: "", w: "", h: "", note: "" }])}><Icon name="plus" size={14} /> Add obstacle</button>}</div>
        {obs.length === 0 ? <p className="text-[13px] text-muted">No obstacles recorded.</p> : (
          <div className="space-y-2">{obs.map((o, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_90px_90px_90px_minmax(0,1.5fr)_32px]">
              <input className="input" placeholder="Obstacle (e.g. Water tank)" value={o.desc} disabled={!canEdit} onChange={(e) => setObs(obs.map((y, j) => (j === i ? { ...y, desc: e.target.value } : y)))} />
              {(["l", "w", "h"] as const).map((k) => <input key={k} className="input" type="number" step="any" min="0" placeholder={k === "l" ? "L (m)" : k === "w" ? "W (m)" : "H (m)"} value={o[k]} disabled={!canEdit} onChange={(e) => setObs(obs.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} />)}
              <input className="input" placeholder="Location / note" value={o.note} disabled={!canEdit} onChange={(e) => setObs(obs.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
              {canEdit && <button type="button" aria-label="Remove obstacle" className="text-faint hover:text-[var(--red)]" onClick={() => setObs(obs.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>}
            </div>))}</div>)}
        <div className="mt-3"><label className="label">Other obstacles / notes</label><textarea rows={2} className="input" disabled={!canEdit} value={f.obstacles ?? ""} onChange={(e) => setField("obstacles", e.target.value)} /></div>
      </div>

      <Sec title="6 · Structure, access & safety">
        <A k="structural" label="Structural condition / load-bearing" ph="Cracks, waterproofing, beam layout, capacity" /><A k="access" label="Access to roof / site" ph="Staircase, ladder, crane access, material lifting" />
        <A k="safety" label="Safety considerations" ph="Fall protection, HT lines nearby, fragile roof" /><S k="roof_access" label="Roof access" extra opts={["Permanent staircase", "Ladder only", "Lift", "Crane needed", "Difficult"]} />
        <S k="water_available" label="Water for cleaning" extra opts={["Available at roof", "Available at ground", "Not available"]} />
      </Sec>

      <Sec title="7 · Electrical & power">
        <T k="eb_connection" label="EB connection / service no." /><T k="sanctioned_load_kw" label="Sanctioned load" type="number" unit="kW" /><T k="tariff_category" label="Tariff category" extra ph="e.g. HT-1A, LT-3A" />
        <T k="monthly_kwh" label="Average monthly consumption" type="number" unit="kWh" /><T k="annual_kwh" label="Annual consumption" type="number" unit="kWh" /><T k="max_demand_kva" label="Maximum demand" extra type="number" unit="kVA" />
        <T k="transformer_kva" label="Transformer capacity" extra type="number" unit="kVA" /><T k="lt_panel_distance_m" label="Distance roof → LT panel" extra type="number" unit="m" /><T k="inverter_location" label="Proposed inverter location" extra />
        <S k="earthing" label="Earthing available" extra opts={["Yes — tested", "Yes — not tested", "No"]} /><S k="dg_present" label="Diesel generator" extra opts={["No", "Yes — synchronisable", "Yes — standalone"]} /><T k="existing_infra" label="Existing infrastructure" ph="Existing solar, panels, cabling" />
      </Sec>

      <div className="border-b border-line px-5 py-4">
        <div className="mb-2 flex items-center justify-between"><div><h4 className="text-[13.5px] font-extrabold">8 · Other measurements</h4><p className="text-xs text-faint">Anything else the designer needs — cable route length, distance to boundary, headroom…</p></div>
          {canEdit && <button type="button" className="btn btn-sm" onClick={() => setMeas([...meas, { label: "", value: "", unit: "m" }])}><Icon name="plus" size={14} /> Add measurement</button>}</div>
        {meas.length === 0 ? <p className="text-[13px] text-muted">No extra measurements.</p> : <div className="space-y-2">{meas.map((m, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_120px_90px_32px]">
            <input className="input" placeholder="What was measured" value={m.label} disabled={!canEdit} onChange={(e) => setMeas(meas.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
            <input className="input" type="number" step="any" placeholder="Value" value={m.value} disabled={!canEdit} onChange={(e) => setMeas(meas.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
            <input className="input" placeholder="Unit" value={m.unit} disabled={!canEdit} onChange={(e) => setMeas(meas.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)))} />
            {canEdit && <button type="button" aria-label="Remove measurement" className="text-faint hover:text-[var(--red)]" onClick={() => setMeas(meas.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>}
          </div>))}</div>}
      </div>

      <Sec title="9 · Customer requirements & remarks"><A k="customer_requirements" label="What does the customer want?" extra ph="Budget, preferred brands, expansion plans, timeline" /><A k="notes" label="Surveyor remarks" /></Sec>

      {canEdit && <div className="p-5"><button type="button" className="btn btn-primary w-full" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save site inputs"}</button></div>}
    </div>
    </Ctx.Provider>
  );
}
