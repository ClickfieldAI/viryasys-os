"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import { useToast, type ActionResult } from "./client";
import { VARIABLES, PROPOSAL_CSS, computePricing, computePayments, renderProposal, validateTerms, type Item, type Section, type TemplateDoc } from "@/lib/proposal-render";
import { inr } from "@/lib/util";

interface Props {
  mode: "proposal" | "template";
  doc: TemplateDoc;
  vars: Record<string, string>;
  items?: Item[];
  discount?: number;
  taxes?: { name: string; pct: number }[];
  terms?: { name: string; pct: number }[];
  paymentTemplates?: { name: string; milestones: { name: string; pct: number }[] }[];
  editable: boolean;
  liveNote?: string;
  plan?: string[];
  save: (payload: string) => Promise<ActionResult>;
  uploadLogo?: (fd: FormData) => Promise<ActionResult & { path?: string }>;
}

const TYPE_HINT: Record<string, string> = { commercial: "First line = the price-row description; the price, GST and total rows are generated from the pricing", image: "Intro text; the uploaded plan view / SLD image appears below it", cover: "Cover page — first line is the headline; remaining lines are the sub-text", boq: "Intro text; the BOQ table is generated from the pricing rows", pricing: "Intro text; the pricing table is generated from the pricing rows", payment: "Intro text; the schedule table is generated from the payment milestones", signature: "Text above the signature blocks" };

export function ProposalEditor(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"pricing" | "content" | "preview">(p.mode === "proposal" ? "pricing" : "content");
  const [doc, setDoc] = useState<TemplateDoc>(p.doc);
  const [items, setItems] = useState<Item[]>(p.items ?? []);
  const [discount, setDiscount] = useState(p.discount ?? 0);
  const [taxes, setTaxes] = useState(p.taxes ?? []);
  const [terms, setTerms] = useState(p.terms ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const ro = !p.editable;
  const touch = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setDirty(true); };

  const pricing = useMemo(() => computePricing(items, discount, taxes), [items, discount, taxes]);
  const payments = useMemo(() => computePayments(terms, pricing.total), [terms, pricing.total]);
  const termErr = validateTerms(terms);
  const liveVars = useMemo(() => p.mode === "template" ? p.vars : ({
    ...p.vars, project_value: inr(pricing.subtotal - pricing.discount), tax: inr(pricing.tax), total_value: inr(pricing.total), payment_terms: terms.map((t) => `${t.pct}% ${t.name}`).join(" / "),
  }), [p.vars, p.mode, pricing, terms]);
  const html = useMemo(() => renderProposal(doc, liveVars, pricing, payments, p.plan ?? []), [doc, liveVars, pricing, payments, p.plan]);

  const setSection = (i: number, patch: Partial<Section>) => touch(setDoc)({ ...doc, sections: doc.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= doc.sections.length) return;
    const a = [...doc.sections]; [a[i], a[j]] = [a[j], a[i]]; touch(setDoc)({ ...doc, sections: a });
  };
  const insertVar = (i: number, key: string) => {
    const s = doc.sections[i], el = bodyRefs.current[s.key];
    const tag = `{{${key}}}`;
    const at = el?.selectionStart ?? s.body.length, end = el?.selectionEnd ?? at;
    setSection(i, { body: s.body.slice(0, at) + tag + s.body.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + tag.length, at + tag.length); });
  };

  const doSave = () => {
    if (p.mode === "proposal") {
      if (termErr) { toast(termErr, "error"); setTab("pricing"); return; }
      if (!items.some((i) => i.description.trim() && i.qty > 0)) { toast("Add at least one pricing row", "error"); setTab("pricing"); return; }
    }
    start(async () => {
      const payload = p.mode === "proposal" ? { items, discount, taxes, terms, doc } : doc;
      const r = await p.save(JSON.stringify(payload)).catch((e) => ({ ok: false, error: e.message } as ActionResult));
      if (r.ok) { toast(r.message ?? "Saved"); setDirty(false); router.refresh(); } else toast(r.error ?? "Could not save", "error");
    });
  };

  const upload = async (file: File) => {
    if (!p.uploadLogo) return;
    const fd = new FormData(); fd.set("logo", file);
    const r = await p.uploadLogo(fd);
    if (r.ok && r.path) { touch(setDoc)({ ...doc, brand: { ...doc.brand, logo_path: r.path } }); toast(r.message ?? "Logo uploaded"); } else toast(r.error ?? "Upload failed", "error");
  };

  const TABS = p.mode === "proposal" ? ([["pricing", "Pricing & payment"], ["content", "Content"], ["preview", "Preview"]] as const) : ([["content", "Sections"], ["preview", "Preview"]] as const);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-[#e9edf1] p-1">
          {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-8 rounded-md px-3.5 text-[13px] font-semibold transition-colors ${tab === k ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}>{l}</button>)}
        </div>
        <div className="flex items-center gap-2">
          {dirty && !ro && <span className="text-xs font-semibold text-[var(--orange)]">Unsaved changes</span>}
          {ro && <span className="badge b-navy"><Icon name="lock" size={11} /> Read-only — older version</span>}
          {!ro && p.liveNote && <span className="badge b-orange">{p.liveNote}</span>}
          {!ro && <button type="button" onClick={doSave} disabled={pending || !dirty} className="btn btn-primary">{pending ? "Saving…" : p.mode === "template" ? "Save template" : p.liveNote ? "Save changes" : "Save draft"}</button>}
        </div>
      </div>

      {tab === "pricing" && p.mode === "proposal" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <div className="card">
            <div className="card-h"><h3>Pricing rows</h3>{!ro && <button type="button" className="btn btn-sm" onClick={() => touch(setItems)([...items, { description: "", spec: "", qty: 1, unit: "nos", rate: 0 }])}><Icon name="plus" size={13} /> Add row</button>}</div>
            <div className="overflow-x-auto">
              <table className="tbl" style={{ minWidth: 760 }}>
                <thead><tr><th>Description</th><th>Specification</th><th style={{ width: 84 }}>Qty</th><th style={{ width: 70 }}>Unit</th><th style={{ width: 120 }}>Rate (₹)</th><th className="r" style={{ width: 120 }}>Amount</th><th style={{ width: 34 }} /></tr></thead>
                <tbody>{items.map((it, i) => (
                  <tr key={i}>
                    <td><input className="input" value={it.description} disabled={ro} aria-label="Description" onChange={(e) => touch(setItems)(items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></td>
                    <td><input className="input" value={it.spec ?? ""} disabled={ro} aria-label="Specification" onChange={(e) => touch(setItems)(items.map((x, j) => j === i ? { ...x, spec: e.target.value } : x))} /></td>
                    <td><input className="input" type="number" min="0" step="any" value={it.qty} disabled={ro} aria-label="Quantity" onChange={(e) => touch(setItems)(items.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} /></td>
                    <td><input className="input" value={it.unit} disabled={ro} aria-label="Unit" onChange={(e) => touch(setItems)(items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} /></td>
                    <td><input className="input" type="number" min="0" step="any" value={it.rate} disabled={ro} aria-label="Rate" onChange={(e) => touch(setItems)(items.map((x, j) => j === i ? { ...x, rate: Number(e.target.value) } : x))} /></td>
                    <td className="r num font-semibold">{inr(it.qty * it.rate)}</td>
                    <td>{!ro && <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove row" onClick={() => touch(setItems)(items.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>

          <div className="space-y-5">
            <div className="card card-b">
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="num font-semibold">{inr(pricing.subtotal)}</span></div>
                <div className="flex items-center justify-between gap-3"><span className="text-muted">Discount (₹)</span><input className="input !h-8 !w-[120px] text-right" type="number" min="0" step="any" value={discount} disabled={ro} aria-label="Discount" onChange={(e) => touch(setDiscount)(Number(e.target.value))} /></div>
                {taxes.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5"><input className="input !h-7 !w-[64px] text-xs" value={t.name} disabled={ro} aria-label="Tax name" onChange={(e) => touch(setTaxes)(taxes.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><input className="input !h-7 !w-[56px] text-right text-xs" type="number" min="0" max="100" step="any" value={t.pct} disabled={ro} aria-label="Tax percent" onChange={(e) => touch(setTaxes)(taxes.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x))} />%</span>
                    <span className="flex items-center gap-1"><span className="num">{inr(pricing.taxes[i]?.amount)}</span>{!ro && <button type="button" className="btn btn-ghost btn-sm !px-1" aria-label="Remove tax" onClick={() => touch(setTaxes)(taxes.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>}</span>
                  </div>))}
                {!ro && <button type="button" className="btn btn-sm w-full" onClick={() => touch(setTaxes)([...taxes, { name: "Tax", pct: 0 }])}>+ Add tax line</button>}
                <div className="flex justify-between border-t border-line pt-3 text-[15px]"><span className="font-extrabold">Grand total</span><span className="num font-extrabold">{inr(pricing.total)}</span></div>
              </div>
              <p className="hint mt-2">Tax rates come from Settings and are editable per proposal.</p>
            </div>

            <div className="card card-b">
              <div className="mb-2 flex items-center justify-between"><h3 className="text-[13px] font-bold">Payment milestones</h3>
                {!ro && p.paymentTemplates && <select className="input !h-7 !w-auto text-xs" aria-label="Apply payment template" value="" onChange={(e) => { const t = p.paymentTemplates!.find((x) => x.name === e.target.value); if (t) touch(setTerms)(t.milestones.map((m) => ({ ...m }))); }}><option value="">Apply template…</option>{p.paymentTemplates.map((t) => <option key={t.name}>{t.name}</option>)}</select>}</div>
              <div className="space-y-2">
                {terms.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_64px_92px_auto] items-center gap-2 text-[13px]">
                    <input className="input !h-8" value={t.name} disabled={ro} aria-label="Milestone name" onChange={(e) => touch(setTerms)(terms.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <input className="input !h-8 text-right" type="number" min="0" max="100" step="any" value={t.pct} disabled={ro} aria-label="Milestone percent" onChange={(e) => touch(setTerms)(terms.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x))} />
                    <span className="num text-right font-semibold">{inr(payments[i]?.amount)}</span>
                    {!ro && <button type="button" className="btn btn-ghost btn-sm !px-1" aria-label="Remove milestone" onClick={() => touch(setTerms)(terms.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>}
                  </div>))}
              </div>
              {!ro && <button type="button" className="btn btn-sm mt-2 w-full" onClick={() => touch(setTerms)([...terms, { name: "Milestone", pct: 0 }])}>+ Add milestone</button>}
              {termErr ? <p className="mt-2 text-xs font-semibold text-[var(--red)]">{termErr}</p> : <p className="mt-2 text-xs text-[var(--green-700)]">Adds up to 100%</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "content" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            {doc.sections.map((s, i) => (
              <div key={s.key} className={`card ${s.visible ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <div className="flex flex-col"><button type="button" className="text-faint hover:text-ink disabled:opacity-30" disabled={ro || i === 0} onClick={() => move(i, -1)} aria-label="Move up"><span className="block rotate-180"><Icon name="chevron" size={14} /></span></button><button type="button" className="text-faint hover:text-ink disabled:opacity-30" disabled={ro || i === doc.sections.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><Icon name="chevron" size={14} /></button></div>
                  <button type="button" className="flex-1 text-left" onClick={() => setOpen(open === s.key ? null : s.key)}>
                    <span className="text-[13.5px] font-bold">{s.title || "Untitled section"}</span>
                    <span className="ml-2 badge">{s.type}</span>
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={s.visible} disabled={ro} className="h-4 w-4 accent-[var(--green-600)]" onChange={(e) => setSection(i, { visible: e.target.checked })} /> Show</label>
                  {s.type === "text" && !ro && <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete section" onClick={() => { if (confirm(`Delete “${s.title}”?`)) touch(setDoc)({ ...doc, sections: doc.sections.filter((_, j) => j !== i) }); }}><Icon name="x" size={14} /></button>}
                </div>
                {open === s.key && (
                  <div className="space-y-3 border-t border-line p-3">
                    <div><label className="label">Section title</label><input className="input" value={s.title} disabled={ro} onChange={(e) => setSection(i, { title: e.target.value })} /></div>
                    <div>
                      <div className="mb-1 flex items-center justify-between"><label className="label !mb-0">Content</label>
                        {!ro && <select className="input !h-7 !w-auto text-xs" aria-label="Insert variable" value="" onChange={(e) => e.target.value && insertVar(i, e.target.value)}><option value="">Insert variable…</option>{VARIABLES.map((v) => <option key={v.key} value={v.key}>{`{{${v.key}}} — ${v.label}`}</option>)}</select>}</div>
                      <textarea ref={(el) => { bodyRefs.current[s.key] = el; }} className="input font-mono text-[12.5px]" rows={Math.min(14, Math.max(4, s.body.split("\n").length + 1))} value={s.body} disabled={ro} onChange={(e) => setSection(i, { body: e.target.value })} />
                      <p className="hint">{TYPE_HINT[s.type] ?? "Paragraphs: blank line · bullets: “- item” · sub-heading: “## Heading” · tables: “| A | B |” rows"}</p>
                    </div>
                  </div>)}
              </div>))}
            {!ro && <button type="button" className="btn w-full" onClick={() => { const k = `custom_${Date.now()}`; touch(setDoc)({ ...doc, sections: [...doc.sections, { key: k, title: "New section", type: "text", visible: true, body: "" }] }); setOpen(k); }}><Icon name="plus" size={14} /> Add section</button>}
          </div>

          <div className="space-y-5">
            <div className="card card-b">
              <h3 className="mb-2 text-[13px] font-bold">Branding</h3>
              <div className="space-y-3">
                <div>
                  <label className="label">Logo</label>
                  {doc.brand.logo_path && /* eslint-disable-next-line @next/next/no-img-element */ <img src={doc.brand.logo_path} alt="Logo" className="mb-2 h-10 rounded border border-line bg-white p-1" />}
                  {p.mode === "template" && !ro && p.uploadLogo && <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="input !h-auto py-1.5 text-xs" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Replace logo" />}
                  {p.mode === "proposal" && <p className="hint">Set in the proposal template.</p>}
                </div>
                <div><label className="label">Footer</label><input className="input" value={doc.brand.footer} disabled={ro || p.mode === "proposal"} onChange={(e) => touch(setDoc)({ ...doc, brand: { ...doc.brand, footer: e.target.value } })} /></div>
                <div><label className="label">Contact details</label><input className="input" value={doc.brand.contact} disabled={ro || p.mode === "proposal"} onChange={(e) => touch(setDoc)({ ...doc, brand: { ...doc.brand, contact: e.target.value } })} /></div>
              </div>
            </div>
            <div className="card card-b">
              <h3 className="mb-2 text-[13px] font-bold">Dynamic variables</h3>
              <ul className="space-y-1 text-xs">{VARIABLES.map((v) => <li key={v.key} className="flex justify-between gap-2"><code className="text-[11.5px] text-[var(--green-700)]">{`{{${v.key}}}`}</code><span className="truncate text-muted">{liveVars[v.key] || v.label}</span></li>)}</ul>
            </div>
          </div>
        </div>
      )}

      {tab === "preview" && (
        <div className="card overflow-hidden">
          <div className="border-b border-line bg-[var(--sunk)] px-4 py-2 text-xs text-muted">Live preview — exactly what the customer PDF contains. Unresolved {"{{variables}}"} are highlighted.</div>
          <div className="bg-[#e9edf1] p-4 sm:p-8"><style>{PROPOSAL_CSS}</style>
            <div className="pdoc mx-auto max-w-[820px] bg-white px-6 py-8 shadow-md sm:px-12" dangerouslySetInnerHTML={{ __html: html }} /></div>
        </div>
      )}
    </div>
  );
}
