// Financial + energy analysis layered on SolarCalculationEngine. Pure: same inputs → same report (used by the page and the print report).
import { SolarCalculationEngine, type CalcInput } from "./design";
import { settings } from "../db";

export interface AnalysisInput extends CalcInput {
  customer?: string; site?: string; monthly_bill?: number; roof_unit?: "sqm" | "sqft";
  tariff?: number; cost_per_kwp?: number; irradiation?: number; pr?: number; escalation?: number; om_pct?: number; subsidy?: number;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Indicative seasonal shape for a Tamil Nadu site (monsoon dip Jun–Sep, Nov–Dec). Normalised; replace with PVGIS/site data when available.
const SHAPE = [0.088, 0.09, 0.099, 0.097, 0.092, 0.076, 0.074, 0.077, 0.078, 0.073, 0.072, 0.084];
const INVERTERS = [3, 5, 10, 15, 20, 25, 30, 50, 60, 100, 110, 125];

function irr(flows: number[]): number | null {
  const npv = (r: number) => flows.reduce((a, f, i) => a + f / Math.pow(1 + r, i), 0);
  let lo = -0.5, hi = 1.5;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

export function analyse(i: AnalysisInput) {
  const base = settings().calc;
  const cfg = { ...base, tariff_per_kwh: i.tariff ?? base.tariff_per_kwh, cost_per_kwp: i.cost_per_kwp ?? base.cost_per_kwp, irradiation_kwh_m2_year: i.irradiation ?? base.irradiation_kwh_m2_year, performance_ratio: i.pr ?? base.performance_ratio };
  const roofSqm = i.roof_area_sqm ? (i.roof_unit === "sqft" ? i.roof_area_sqm / 10.7639 : i.roof_area_sqm) : undefined;
  const annualFromBill = i.monthly_bill ? (i.monthly_bill * 12) / cfg.tariff_per_kwh : undefined;
  const input: CalcInput = { annual_kwh: i.annual_kwh ?? (i.monthly_kwh ? undefined : annualFromBill), monthly_kwh: i.monthly_kwh, roof_area_sqm: roofSqm, capacity_kw: i.capacity_kw, panel_wp: i.panel_wp };
  const out = new SolarCalculationEngine(cfg).compute(input);
  const demand = input.annual_kwh ?? (input.monthly_kwh ? input.monthly_kwh * 12 : null);

  const esc = (i.escalation ?? base.tariff_escalation_pct ?? 3) / 100, omPct = (i.om_pct ?? base.om_pct ?? 1) / 100, deg = cfg.degradation_pct / 100;
  const gross = out.est_system_cost, subsidy = Math.max(0, i.subsidy ?? 0), net = Math.max(0, gross - subsidy);
  const years = Array.from({ length: 25 }, (_, n) => {
    const gen = out.annual_generation_kwh * Math.pow(1 - deg, n);
    const saving = gen * cfg.tariff_per_kwh * Math.pow(1 + esc, n);
    const om = gross * omPct;
    return { year: n + 1, gen: Math.round(gen), saving: Math.round(saving), om: Math.round(om), net: Math.round(saving - om) };
  });
  let cum = -net; const cumulative = [{ label: "Y0", value: Math.round(cum) }]; let payback: number | null = null;
  for (const y of years) { const prev = cum; cum += y.net; cumulative.push({ label: `Y${y.year}`, value: Math.round(cum) }); if (payback == null && cum >= 0) payback = Math.round((y.year - 1 + (y.net ? -prev / y.net : 0)) * 10) / 10; }
  const total25 = Math.round(cum);
  const rate = irr([-net, ...years.map((y) => y.net)]);
  const monthly = MONTHS.map((m, k) => ({ label: m, value: Math.round(out.annual_generation_kwh * SHAPE[k]) }));

  const acKw = out.recommended_kw / 1.15;
  let inv = { size: 0, count: 0 };
  { let best = Infinity; for (const s of INVERTERS) { const c = Math.max(1, Math.round(acKw / s)); if (c > 24) continue; const d = Math.abs(c * s - acKw) + c * 0.3; if (d < best) { best = d; inv = { size: s, count: c }; } } }

  return {
    input: { ...input, customer: i.customer, site: i.site }, cfg: { ...cfg, escalation_pct: esc * 100, om_pct: omPct * 100 }, out, demand, offsetPct: demand ? Math.min(100, Math.round((out.annual_generation_kwh / demand) * 100)) : null,
    co2_tonnes: Math.round((out.annual_generation_kwh * (base.co2_kg_per_kwh ?? 0.82)) / 100) / 10, gross, subsidy, net, payback, irr: rate == null ? null : Math.round(rate * 1000) / 10,
    roi25: net ? Math.round((total25 / net) * 100) : null, total25, years, cumulative, monthly, inverter: inv, dcac: inv.size ? Math.round((out.recommended_kw / (inv.size * inv.count)) * 100) / 100 : null,
  };
}
export type Analysis = ReturnType<typeof analyse>;

/** Parse the calculator query string into an analysis input. */
export function inputFromParams(sp: Record<string, string>): AnalysisInput {
  const n = (k: string) => (sp[k] !== undefined && sp[k] !== "" && Number.isFinite(Number(sp[k])) ? Number(sp[k]) : undefined);
  return { customer: sp.customer, site: sp.site, annual_kwh: n("annual_kwh"), monthly_kwh: n("monthly_kwh"), monthly_bill: n("monthly_bill"), roof_area_sqm: n("roof_area_sqm"), roof_unit: sp.roof_unit === "sqft" ? "sqft" : "sqm", capacity_kw: n("capacity_kw"), panel_wp: n("panel_wp"),
    tariff: n("tariff"), cost_per_kwp: n("cost_per_kwp"), irradiation: n("irradiation"), pr: n("pr"), escalation: n("escalation"), om_pct: n("om_pct"), subsidy: n("subsidy") };
}

