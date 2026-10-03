import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { analyse, inputFromParams } from "@/lib/services/solar-analysis";
import { PrintButton } from "@/components/print-button";
import { PRINT_CSS } from "@/lib/print-css";
import { getDb } from "@/lib/db";
import { inr, inrShort } from "@/lib/util";

export const dynamic = "force-dynamic";
export const metadata = { title: "Solar Estimate" };
const IN = new Intl.NumberFormat("en-IN");

export default async function CalcPrint({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!can(u.role, "design")) redirect("/forbidden");
  const sp = await searchParams;
  let a; try { a = analyse(inputFromParams(sp)); } catch { redirect("/design/calculator"); }
  const org = getDb().prepare("SELECT * FROM organizations LIMIT 1").get() as any;
  const o = a.out;
  const max = Math.max(1, ...a.monthly.map((m) => m.value));
  const cum = a.cumulative, lo = Math.min(...cum.map((c) => c.value)), hi = Math.max(...cum.map((c) => c.value));
  const pts = cum.map((c, i) => `${(i / (cum.length - 1)) * 600},${120 - ((c.value - lo) / Math.max(1, hi - lo)) * 110}`).join(" ");
  const zeroY = 120 - ((0 - lo) / Math.max(1, hi - lo)) * 110;
  return (
    <div className="min-h-screen bg-white">
      <style>{PRINT_CSS + ".pdoc .g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}.pdoc .t{border:1px solid #E3E8ED;border-radius:8px;padding:10px 12px}.pdoc .t b{display:block;font-size:19px}.pdoc .t span{font-size:11px;color:#6B7A87}.pdoc h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#1F9A50;margin:18px 0 4px}.pdoc .foot{margin-top:26px;padding-top:8px;border-top:3px solid #32C36C;font-size:10.5px;color:#6B7A87}@media print{@page{size:A4;margin:14mm}}"}</style>
      <div className="no-print sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-2.5"><span className="text-[13px]">Solar estimate · choose “Save as PDF” in the print dialog</span><PrintButton /></div>
      <div className="pdoc mx-auto max-w-[820px] px-8 py-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="head"><div><img src="/brand/logo.png" alt="ViryaSys Technologies" style={{ height: 46 }} /><div className="sm" style={{ marginTop: 6 }}>{org?.name} · {org?.address}<br />{org?.phone} · {org?.email}</div></div><div className="right"><div className="kicker">Solar estimate</div><h1>{o.recommended_kw} kW</h1><div className="sm">{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div></div></div>
        <table className="kv"><tbody><tr><th>Prepared for</th><td>{sp.customer || "—"}</td><th>Site</th><td>{sp.site || "—"}</td></tr></tbody></table>
        <div className="g">
          {[["Recommended system", `${o.recommended_kw} kW`, `limited by ${o.limiting_factor}`], ["Solar panels", `${o.panel_count} × ${o.panel_wp} Wp`, `${(o.panel_count * o.panel_wp / 1000).toFixed(1)} kWp DC`], ["Annual generation", `${IN.format(o.annual_generation_kwh)} kWh`, `${o.specific_yield_kwh_per_kwp} kWh per kWp`], ["Year-1 saving", inr(o.est_annual_saving), `at ₹${a.cfg.tariff_per_kwh}/kWh`], ["Payback", a.payback ? `${a.payback} years` : "—", `net investment ${inrShort(a.net)}`], ["25-year net gain", inrShort(a.total25), a.irr != null ? `IRR ${a.irr}%` : ""]].map(([l, v, s]) => <div key={l} className="t"><span>{l}</span><b>{v}</b><span>{s}</span></div>)}
        </div>
        <h2>Investment & equipment</h2>
        <table className="pt"><tbody>
          <tr><td>Solar modules</td><td className="r">{o.panel_count} × {o.panel_wp} Wp</td></tr>
          <tr><td>Inverter (indicative)</td><td className="r">{a.inverter.size ? `${a.inverter.count} × ${a.inverter.size} kW` : "—"}</td></tr>
          <tr><td>Roof area required</td><td className="r">{IN.format(o.required_area_sqm)} sq m</td></tr>
          <tr><td>Gross system cost</td><td className="r">{inr(a.gross)}</td></tr>
          {a.subsidy > 0 && <tr><td>Subsidy / incentive</td><td className="r">− {inr(a.subsidy)}</td></tr>}
          <tr><td><b>Net investment</b></td><td className="r"><b>{inr(a.net)}</b></td></tr>
        </tbody></table>
        <h2>Monthly generation (kWh, indicative)</h2>
        <svg viewBox="0 0 600 110" width="100%">{a.monthly.map((m, i) => <g key={i}><rect x={i * 50 + 8} y={90 - (m.value / max) * 80} width="34" height={(m.value / max) * 80} fill="#32C36C" rx="3" /><text x={i * 50 + 25} y="104" fontSize="10" textAnchor="middle" fill="#6B7A87">{m.label}</text></g>)}</svg>
        <h2>Cumulative cash position over 25 years</h2>
        <svg viewBox="0 0 600 130" width="100%"><line x1="0" x2="600" y1={zeroY} y2={zeroY} stroke="#cfd7de" strokeDasharray="4 4" /><polyline points={pts} fill="none" stroke="#1F9A50" strokeWidth="2.5" /></svg>
        <p className="sm">Assumptions: irradiation {a.cfg.irradiation_kwh_m2_year} kWh/m²/yr · performance ratio {a.cfg.performance_ratio} · tariff ₹{a.cfg.tariff_per_kwh}/kWh escalating {a.cfg.escalation_pct}%/yr · degradation {a.cfg.degradation_pct}%/yr · O&M {a.cfg.om_pct}% of cost/yr. Cash flows are before tax and financing. This is a pre-sales estimate, not a performance guarantee; final figures follow the site survey and detailed design.</p>
        <div className="foot">ViryaSys Technologies · Accelerating Green</div>
      </div>
    </div>
  );
}
