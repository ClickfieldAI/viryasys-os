// Pure proposal rendering — used by the server (print/PDF) and the client (live editor preview).
// Source of truth is the structured sections + variables; HTML is only ever an output.
import { inr, fmtDate } from "./util";

export type SectionType = "cover" | "text" | "boq" | "pricing" | "commercial" | "payment" | "signature" | "image";
export interface Section { key: string; title: string; type: SectionType; body: string; visible: boolean }
export interface Brand { logo_path: string | null; footer: string; contact: string }
export interface TemplateDoc { brand: Brand; sections: Section[] }
export interface Item { description: string; spec?: string | null; qty: number; unit: string; rate: number }
export interface TaxLine { name: string; pct: number; amount: number }
export interface Pricing { items: Item[]; subtotal: number; discount: number; taxes: TaxLine[]; tax: number; total: number }
export interface PayLine { name: string; pct: number; amount: number }

export const VARIABLES: { key: string; label: string }[] = [
  { key: "company_name", label: "ViryaSys company name" }, { key: "customer_name", label: "Customer name" },
  { key: "contact_person", label: "Contact person" }, { key: "site_location", label: "Site location" },
  { key: "system_capacity", label: "System capacity" }, { key: "panel_brand", label: "Panel brand" },
  { key: "panel_details", label: "Panel count × wattage" }, { key: "inverter_brand", label: "Inverter brand" },
  { key: "inverter_details", label: "Inverter count × rating" }, { key: "estimated_generation", label: "Estimated generation" },
  { key: "project_value", label: "Project value (pre-tax)" }, { key: "tax", label: "Total tax" }, { key: "total_value", label: "Total value" },
  { key: "payment_terms", label: "Payment terms summary" }, { key: "validity", label: "Validity" },
  { key: "proposal_date", label: "Proposal date" }, { key: "proposal_no", label: "Proposal number" }, { key: "version", label: "Version" },
  { key: "contact_phone", label: "Customer phone" }, { key: "survey_date", label: "Site survey date" }, { key: "salutation", label: "Salutation (Sir / Madam)" },
  { key: "pm_name", label: "Project manager name" }, { key: "pm_title", label: "Project manager title" }, { key: "validity_days", label: "Offer validity (days)" },
  { key: "area_requirement", label: "Shadow-free area required" }, { key: "gst_label", label: "Tax summary (e.g. 18% GST)" },
];

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Substitute {{vars}} into already-escaped text. Unknown variables stay visible so they're noticed. */
export function applyVars(text: string, vars: Record<string, string>): string {
  return esc(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? esc(vars[k]) : `<mark>${m}</mark>`)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
/** Plain-text variable substitution (emails, Word export). Unknown variables are left as-is. */
export function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Light markup: blank-line paragraphs, "- " bullets, "## " subheads, "| a | b |" tables. */
export function renderBody(body: string, vars: Record<string, string>): string {
  const blocks = body.split(/\n\s*\n/);
  return blocks
    .map((b) => {
      const lines = b.split("\n").filter((l) => l.trim());
      if (!lines.length) return "";
      if (lines.every((l) => l.trim().startsWith("|"))) {
        const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        const [head, ...rest] = rows;
        return `<table class="pt"><thead><tr>${head.map((c) => `<th>${applyVars(c, vars)}</th>`).join("")}</tr></thead><tbody>${rest.filter((r) => !r.every((c) => /^-+$/.test(c))).map((r) => `<tr>${r.map((c) => `<td>${applyVars(c, vars)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      }
      if (lines.every((l) => /^\s*[-•]\s/.test(l))) return `<ul>${lines.map((l) => `<li>${applyVars(l.replace(/^\s*[-•]\s/, ""), vars)}</li>`).join("")}</ul>`;
      return lines.map((l) => (l.startsWith("## ") ? `<h4>${applyVars(l.slice(3), vars)}</h4>` : `<p>${applyVars(l, vars)}</p>`)).join("");
    })
    .join("");
}

const row = (c: (string | number)[], cls = "") => `<tr class="${cls}">${c.map((x, i) => `<td class="${i > 1 ? "r" : ""}">${x}</td>`).join("")}</tr>`;

export function renderSection(s: Section, ctx: { vars: Record<string, string>; pricing: Pricing; payments: PayLine[]; brand: Brand; plan?: string[] }): string {
  const { vars, pricing: p, payments, brand, plan = [] } = ctx;
  if (s.type === "cover") {
    const logo = brand.logo_path ? `<img class="logo" src="${esc(brand.logo_path)}" alt="ViryaSys Technologies"/>` : "";
    return `<section class="cover">${logo}<div class="kicker">${applyVars(s.title, vars)}</div><h1>${applyVars(s.body.split("\n")[0] ?? "", vars)}</h1><div class="sub">${renderBody(s.body.split("\n").slice(1).join("\n"), vars)}</div></section>`;
  }
  let inner = "";
  if (s.type === "text") inner = renderBody(s.body, vars);
  else if (s.type === "boq") {
    inner = renderBody(s.body, vars) +
      `<table class="pt"><thead><tr><th>S. No.</th><th>Description</th><th>Proposed make / specification</th><th class="r">Qty.</th></tr></thead><tbody>${p.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td>${esc(i.spec ?? "")}</td><td class="r">${esc(i.qty)} ${esc(i.unit)}</td></tr>`).join("")}</tbody></table>`;
  } else if (s.type === "pricing") {
    inner = renderBody(s.body, vars) +
      `<table class="pt"><thead><tr><th>#</th><th>Description</th><th class="r">Qty × Rate</th><th class="r">Amount</th></tr></thead><tbody>${p.items.map((i, n) => row([n + 1, esc(i.description), `${i.qty} × ${inr(i.rate)}`, inr(i.qty * i.rate)])).join("")}` +
      row(["", "<b>Subtotal</b>", "", `<b>${inr(p.subtotal)}</b>`], "sum") +
      (p.discount ? row(["", "Discount", "", `− ${inr(p.discount)}`], "sum") : "") +
      p.taxes.map((t) => row(["", `${esc(t.name)} @ ${t.pct}%`, "", inr(t.amount)], "sum")).join("") +
      row(["", "<b>Grand total</b>", "", `<b>${inr(p.total)}</b>`], "grand") + `</tbody></table>`;
  } else if (s.type === "commercial") {
    const lines = s.body.split("\n").filter((l) => l.trim());
    const desc = applyVars(lines[0] ?? "", vars);
    const net = p.subtotal - p.discount;
    const rate = p.taxes.reduce((a, t) => a + t.pct, 0);
    inner = renderBody(lines.slice(1).join("\n\n"), vars) +
      `<table class="pt"><thead><tr><th>Sl.#</th><th>Technical details</th><th class="r">Price (Rs.)*</th></tr></thead><tbody>` +
      row(["1", desc, inr(net)]) +
      row(["", `<small>@ <b>${p.taxes.map((t) => `${esc(t.name)} ${t.pct}%`).join(" + ")}</b> (${rate}% GST) will be applicable</small>`, inr(p.tax)], "sum") +
      row(["", "<b>Total amount</b>", `<b>${inr(p.total)}</b>`], "grand") + `</tbody></table>`;
  } else if (s.type === "image") {
    inner = renderBody(s.body, vars) + (plan.length ? plan.map((src) => `<img class="plan" src="${esc(src)}" alt="Plan view"/>`).join("") : `<p class="ph">The plan view / single line diagram is attached to the proposal email. Upload it on the proposal page to show it here.</p>`);
  } else if (s.type === "payment") {
    inner = renderBody(s.body, vars) +
      `<table class="pt"><thead><tr><th>Milestone</th><th class="r">Share</th><th class="r">Amount</th></tr></thead><tbody>${payments.map((m) => `<tr><td>${esc(m.name)}</td><td class="r">${m.pct}%</td><td class="r">${inr(m.amount)}</td></tr>`).join("")}</tbody></table>`;
  } else if (s.type === "signature") {
    inner = renderBody(s.body, vars) +
      `<div class="sig"><div><div class="line"></div>For ${esc(vars.company_name)}<br/><span>Authorised signatory</span></div><div><div class="line"></div>For ${esc(vars.customer_name)}<br/><span>Accepted by (name, date)</span></div></div>`;
  }
  return `<section>${s.title.trim() ? `<h2>${applyVars(s.title, vars)}</h2>` : ""}${inner}</section>`;
}

export function renderProposal(doc: TemplateDoc, vars: Record<string, string>, pricing: Pricing, payments: PayLine[], plan: string[] = []) {
  const ctx = { vars, pricing, payments, brand: doc.brand, plan };
  const foot = `<div class="foot"><span>${esc(doc.brand.footer)}</span><span>${esc(doc.brand.contact)}</span></div>`;
  return doc.sections.filter((s) => s.visible).map((s) => renderSection(s, ctx)).join("\n") + foot;
}

/* ───────────── pricing engine (pure) ───────────── */
export function computePricing(items: Item[], discount: number, taxRates: { name: string; pct: number }[]): Pricing {
  const subtotal = items.reduce((a, i) => a + i.qty * i.rate, 0);
  const d = Math.min(Math.max(discount || 0, 0), subtotal);
  const base = subtotal - d;
  const taxes = taxRates.map((t) => ({ name: t.name, pct: t.pct, amount: Math.round(base * t.pct) / 100 }));
  const tax = taxes.reduce((a, t) => a + t.amount, 0);
  return { items, subtotal, discount: d, taxes, tax, total: Math.round((base + tax) * 100) / 100 };
}
export function computePayments(terms: { name: string; pct: number }[], total: number): PayLine[] {
  return terms.map((t) => ({ name: t.name, pct: t.pct, amount: Math.round((total * t.pct) / 100) }));
}
export function validateTerms(terms: { pct: number }[]): string | null {
  const sum = terms.reduce((a, t) => a + (Number(t.pct) || 0), 0);
  return Math.abs(sum - 100) < 0.01 ? null : `Payment milestones add up to ${sum}%, must be 100%`;
}

export const PROPOSAL_CSS = `
.pdoc{font-family:Manrope,system-ui,sans-serif;color:#1A2A36;font-size:13px;line-height:1.6}
.pdoc section{padding:22px 0;border-bottom:1px solid #E3E8ED;break-inside:avoid-page}
.pdoc section.cover{padding:56px 0 48px;border-bottom:3px solid #32C36C}
.pdoc .logo{height:52px;margin-bottom:56px;display:block}
.pdoc .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#1F9A50;font-weight:700}
.pdoc h1{font-size:30px;line-height:1.2;margin:10px 0 14px;font-weight:800;color:#1A2A36;letter-spacing:-.01em}
.pdoc h2{font-size:16px;margin:0 0 10px;font-weight:800;padding-left:10px;border-left:3px solid #32C36C}
.pdoc h4{font-size:13px;margin:12px 0 4px;font-weight:700}
.pdoc p{margin:0 0 8px}.pdoc ul{margin:0 0 8px;padding-left:18px}.pdoc li{margin:2px 0}
.pdoc .sub{color:#4B5B68}
.pdoc table.pt{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px}
.pdoc .pt th{background:#1A2A36;color:#fff;text-align:left;padding:6px 8px;font-weight:600}
.pdoc .pt td{padding:6px 8px;border-bottom:1px solid #E3E8ED}
.pdoc .r{text-align:right}.pdoc tr.sum td{background:#F6F8F9}.pdoc tr.grand td{background:#EAF8EF;font-size:13px;border-top:2px solid #32C36C}
.pdoc img.plan{max-width:100%;margin:8px 0;border:1px solid #E3E8ED}.pdoc .ph{color:#8A98A4;font-style:italic;border:1px dashed #CFD7DE;padding:14px;text-align:center}.pdoc small{font-size:11px}
.pdoc mark{background:#FFE65A;padding:0 2px;border-radius:2px}
.pdoc .sig{display:flex;gap:48px;margin-top:36px}.pdoc .sig>div{flex:1;font-weight:600}.pdoc .sig span{font-weight:400;color:#6B7A87;font-size:11px}
.pdoc .line{border-bottom:1px solid #1A2A36;height:40px;margin-bottom:6px}
.pdoc .foot{margin-top:24px;padding-top:10px;border-top:1px solid #E3E8ED;font-size:11px;color:#6B7A87;display:flex;justify-content:space-between;gap:16px}
`;

export { fmtDate };
