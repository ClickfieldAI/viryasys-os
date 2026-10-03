import Link from "next/link";
import { guard } from "@/lib/auth";
import { settings } from "@/lib/db";
import { analyse, inputFromParams } from "@/lib/services/solar-analysis";
import { PageHeader, Card, Icon, AreaChart, MiniBars } from "@/components/ui";
import { inr, inrShort } from "@/lib/util";

export const metadata = { title: "Solar Calculator" };
export const dynamic = "force-dynamic";

const IN = new Intl.NumberFormat("en-IN");
const PRESETS: [string, string, string, Record<string, string>][] = [
  ["Home", "3–10 kW rooftop", "home", { customer: "Residential customer", monthly_bill: "6000", roof_area_sqm: "60", roof_unit: "sqm" }],
  ["Small commercial", "Shop / office", "grid", { customer: "Commercial customer", monthly_kwh: "3000", roof_area_sqm: "400", roof_unit: "sqm" }],
  ["Industrial", "Factory rooftop", "panel", { customer: "Industrial customer", annual_kwh: "900000", roof_area_sqm: "6000", roof_unit: "sqm" }],
];

function Num({ name, label, sp, hint, ph, step = "any" }: { name: string; label: string; sp: Record<string, string>; hint?: string; ph?: string; step?: string }) {
  return <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} type="number" step={step} min="0" defaultValue={sp[name]} placeholder={ph} className="input" />{hint && <p className="hint">{hint}</p>}</div>;
}

export default async function Calculator({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard("design");
  const sp = await searchParams;
  const cfg = settings().calc;
  const input = inputFromParams(sp);
  const has = !!(input.annual_kwh || input.monthly_kwh || input.monthly_bill || input.roof_area_sqm || input.capacity_kw);
  let a = null as ReturnType<typeof analyse> | null, err = "";
  if (has) { try { a = analyse(input); } catch (e: any) { err = e.message; } }
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== "")).toString();

  return (
    <div>
      <PageHeader crumbs={[{ label: "Design", href: "/design" }, { label: "Solar calculator" }]} title="Solar sizing & savings estimator"
        sub="Size a rooftop system from consumption, bill or roof area — with generation, payback and 25-year returns. Every default comes from Settings; override any assumption for this estimate."
        actions={a ? <a className="btn btn-primary" href={`/calc-print?${qs}`} target="_blank"><Icon name="file" size={14} /> Download PDF report</a> : undefined} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {PRESETS.map(([t, s, ic, q]) => (
          <Link key={t} href={`/design/calculator?${new URLSearchParams(q).toString()}`} className="card kpi flex items-center gap-3">
            <span className="ic-tile tile-green"><Icon name={ic} size={20} /></span>
            <span><b className="block text-[14px]">{t}</b><span className="text-xs text-muted">{s} · load example</span></span>
          </Link>))}
      </div>

      <form method="get" className="card mb-5">
        <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
          <div className="space-y-3 p-5">
            <h4 className="text-[13.5px] font-extrabold">1 · Customer &amp; site</h4>
            <div><label className="label" htmlFor="customer">Customer / project name</label><input id="customer" name="customer" defaultValue={sp.customer} className="input" placeholder="e.g. Meenakshi Hotels" /></div>
            <div><label className="label" htmlFor="site">Site location</label><input id="site" name="site" defaultValue={sp.site} className="input" placeholder="e.g. Vellore industrial estate" /></div>
          </div>
          <div className="space-y-3 p-5">
            <div className="flex items-baseline justify-between"><h4 className="text-[13.5px] font-extrabold">2 · Energy demand</h4><span className="text-xs text-faint">fill any one</span></div>
            <Num name="monthly_bill" label="Monthly electricity bill (₹)" sp={sp} ph="e.g. 45000" />
            <Num name="monthly_kwh" label="Monthly consumption (kWh)" sp={sp} ph="e.g. 6000" />
            <Num name="annual_kwh" label="Annual consumption (kWh)" sp={sp} ph="e.g. 72000" />
          </div>
          <div className="space-y-3 p-5">
            <h4 className="text-[13.5px] font-extrabold">3 · Site &amp; system</h4>
            <div className="grid grid-cols-[minmax(0,1fr)_92px] items-end gap-2">
              <Num name="roof_area_sqm" label="Available roof area" sp={sp} ph="e.g. 500" />
              <div><label className="label" htmlFor="roof_unit">Unit</label><select id="roof_unit" name="roof_unit" defaultValue={sp.roof_unit ?? "sqm"} className="input"><option value="sqm">sq m</option><option value="sqft">sq ft</option></select></div>
            </div>
            <Num name="capacity_kw" label="Target capacity (kW)" sp={sp} ph="Optional — overrides sizing" />
            <div className="grid grid-cols-2 gap-2">
              <Num name="panel_wp" label="Panel (Wp)" sp={{ ...sp, panel_wp: sp.panel_wp ?? String(cfg.panel_wp) }} step="1" />
              <Num name="subsidy" label="Subsidy (₹)" sp={sp} ph="Optional" />
            </div>
          </div>
          <div className="space-y-3 p-5">
            <div className="flex items-baseline justify-between"><h4 className="text-[13.5px] font-extrabold">4 · Assumptions</h4><span className="text-xs text-faint">defaults from Settings</span></div>
            <div className="grid grid-cols-2 gap-2">
              <Num name="tariff" label="Tariff (₹/kWh)" sp={sp} ph={String(cfg.tariff_per_kwh)} />
              <Num name="cost_per_kwp" label="Cost (₹/kWp)" sp={sp} ph={String(cfg.cost_per_kwp)} />
              <Num name="irradiation" label="Irradiation" sp={sp} ph={String(cfg.irradiation_kwh_m2_year)} />
              <Num name="pr" label="Perf. ratio" sp={sp} ph={String(cfg.performance_ratio)} />
              <Num name="escalation" label="Tariff rise %/yr" sp={sp} ph={String(cfg.tariff_escalation_pct ?? 3)} />
              <Num name="om_pct" label="O&M % /yr" sp={sp} ph={String(cfg.om_pct ?? 1)} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-[var(--sunk)] px-5 py-3 rounded-b-2xl">
          <p className="text-xs text-muted">Only one demand field is needed. Leave assumptions blank to use the company defaults.</p>
          <div className="flex gap-2"><Link className="btn" href="/design/calculator">Reset</Link><button className="btn btn-primary min-w-[160px]" type="submit">Calculate</button></div>
        </div>
      </form>

      <div className="space-y-5">
        {err && <div className="rounded-xl bg-[var(--red-50)] p-3 text-[13px] text-[var(--red)]">{err}</div>}
        {!a && !err && (
          <Card><div className="grid gap-4 p-2 sm:grid-cols-3">
            {[["1", "Enter demand", "Bill, monthly or annual units — any one is enough."], ["2", "Add site limits", "Roof area caps the size; a target kW overrides it."], ["3", "Get the estimate", "Size, panels, inverter, generation, payback and 25-year returns."]].map(([n, t, d]) => (
              <div key={n} className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--green-50)] font-extrabold text-[var(--green-700)]">{n}</span><div><b className="block text-[14px]">{t}</b><p className="text-[12.5px] text-muted">{d}</p></div></div>))}
          </div></Card>)}
        {a && <Results a={a} />}
      </div>
    </div>
  );
}

function Results({ a }: { a: NonNullable<ReturnType<typeof analyse>> }) {
  const o = a.out;
  const tiles: [string, string, string, string, string][] = [
    ["Recommended system", `${o.recommended_kw} kW`, `limited by ${o.limiting_factor}`, "sun", "tile-green"],
    ["Solar panels", `${o.panel_count}`, `× ${o.panel_wp} Wp`, "grid", "tile-blue"],
    ["Annual generation", `${IN.format(o.annual_generation_kwh)} kWh`, `${o.specific_yield_kwh_per_kwp} kWh per kWp`, "bolt", "tile-amber"],
    ["Year-1 saving", inr(o.est_annual_saving), `at ₹${a.cfg.tariff_per_kwh}/kWh`, "wallet", "tile-purple"],
    ["Payback", a.payback ? `${a.payback} yrs` : "—", `net investment ${inrShort(a.net)}`, "trend", "tile-teal"],
    ["25-year net gain", inrShort(a.total25), a.roi25 != null ? `${a.roi25}% return · IRR ${a.irr ?? "—"}%` : "", "chart", "tile-green"],
  ];
  return (
    <>
      {o.supporting.notes.map((n) => <div key={n} className="rounded-xl border border-[#f0d9a8] bg-[var(--solar-50)] p-3 text-[13px]">{n}</div>)}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {tiles.map(([l, v, s, ic, tl]) => (
          <div key={l} className="card flex items-start gap-3 p-4"><span className={`ic-tile ${tl}`}><Icon name={ic} size={20} /></span><div className="min-w-0"><div className="text-[12px] font-semibold text-muted">{l}</div><div className="num text-[21px] font-extrabold leading-tight">{v}</div><div className="text-[11.5px] text-faint">{s}</div></div></div>))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Energy offset" actions={<span className="text-xs text-faint">generation vs demand</span>}>
          {a.demand ? (<>
            <div className="flex items-end justify-between"><span className="num text-[30px] font-extrabold text-[var(--green-700)]">{a.offsetPct}%</span><span className="text-xs text-muted">{IN.format(o.annual_generation_kwh)} of {IN.format(Math.round(a.demand))} kWh / yr</span></div>
            <div className="progress mt-2 !h-2.5"><div style={{ width: `${a.offsetPct}%` }} /></div>
          </>) : <p className="text-[13px] text-muted">Add consumption or a bill to see how much of the demand this system covers.</p>}
          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-xl bg-[var(--green-50)] p-3"><div className="text-xs text-muted">CO₂ avoided</div><b className="num text-[17px]">{a.co2_tonnes} t / yr</b></div>
            <div className="rounded-xl bg-[var(--sunk)] p-3"><div className="text-xs text-muted">Roof area needed</div><b className="num text-[17px]">{IN.format(o.required_area_sqm)} sq m</b></div>
          </div>
        </Card>
        <Card title="Equipment summary">
          <table className="tbl"><tbody>
            {([["Solar modules", `${o.panel_count} × ${o.panel_wp} Wp = ${(o.panel_count * o.panel_wp / 1000).toFixed(1)} kWp DC`], ["Inverter (indicative)", a.inverter.size ? `${a.inverter.count} × ${a.inverter.size} kW string inverter` : "—"], ["DC : AC ratio", a.dcac ? String(a.dcac) : "—"], ["Structure", `${o.recommended_kw} kWp mounting structure`], ["Gross system cost", `${inr(a.gross)} (₹${IN.format(a.cfg.cost_per_kwp)}/kWp)`], ...(a.subsidy ? [["Subsidy", `− ${inr(a.subsidy)}`]] : []), ["Net investment", inr(a.net)]] as [string, string][]).map(([k, v]) => <tr key={k}><td className="text-muted">{k}</td><td className="r font-semibold">{v}</td></tr>)}
          </tbody></table>
        </Card>
      </div>

      <Card title="Cumulative cash position — 25 years" actions={<span className="text-xs text-faint">below zero until payback{a.payback ? ` (${a.payback} yrs)` : ""}</span>}>
        <AreaChart rows={a.cumulative.filter((_, i) => i % 5 === 0 || i === a.cumulative.length - 1)} fmt={inrShort} color="#1b8a49" />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Monthly generation" actions={<span className="text-xs text-faint">kWh · indicative seasonal shape</span>}><MiniBars rows={a.monthly} fmt={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))} /></Card>
        <Card title="Assumptions used">
          <table className="tbl"><tbody>
            {([["Irradiation", `${a.cfg.irradiation_kwh_m2_year} kWh/m²/yr`], ["Performance ratio", String(a.cfg.performance_ratio)], ["Tariff / escalation", `₹${a.cfg.tariff_per_kwh}/kWh · ${a.cfg.escalation_pct}% per yr`], ["Module degradation", `${a.cfg.degradation_pct}% per yr`], ["O&M", `${a.cfg.om_pct}% of cost per yr`], ["Area per kWp", `${a.cfg.area_sqm_per_kwp} sq m`], ["Year-25 generation", `${IN.format(o.supporting.year_25_generation_kwh)} kWh`]] as [string, string][]).map(([k, v]) => <tr key={k}><td className="text-muted">{k}</td><td className="r num font-semibold">{v}</td></tr>)}
          </tbody></table>
          <p className="hint mt-2">Defaults live in <Link className="lnk" href="/system/settings">Settings</Link>. This is a pre-sales estimate, not a guaranteed yield — final numbers come from the site survey and design.</p>
        </Card>
      </div>
    </>
  );
}
