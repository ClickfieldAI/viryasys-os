// Sample data so the template editor can preview real-looking output without a live proposal.
import { settings } from "../db";
import type { Item } from "../proposal-render";

export function buildSampleVars() {
  const s = settings();
  const items: Item[] = [
    { description: "Solar PV modules", spec: "540 Wp mono PERC, Tier-1", qty: 926, unit: "nos", rate: 12600 },
    { description: "String inverter", spec: "100 kW, 3-phase", qty: 5, unit: "nos", rate: 390000 },
    { description: "Mounting structure", spec: "HDG", qty: 500, unit: "kWp", rate: 3300 },
    { description: "Installation & commissioning", spec: "Turnkey", qty: 500, unit: "kWp", rate: 3800 },
  ];
  const vars = {
    company_name: "ViryaSys Technologies", customer_name: "ABC Textiles", contact_person: "Mr. Karthik", site_location: "Coimbatore", system_capacity: "500 kW",
    panel_brand: "Waaree", panel_details: "926 × 540 Wp", inverter_brand: "Sungrow", inverter_details: "5 × 100 kW", estimated_generation: "720,000 kWh / year",
    project_value: "₹1,70,00,000", tax: "₹30,60,000", total_value: "₹2,00,60,000", payment_terms: s.payment_templates[0].milestones.map((m) => `${m.pct}% ${m.name}`).join(" / "),
    validity: "25 Oct 2026", proposal_date: "25 Sep 2026", proposal_no: "VS-PROP-000001", version: "V1",
  };
  return { vars, items, taxes: s.taxes, terms: s.payment_templates[0].milestones };
}
