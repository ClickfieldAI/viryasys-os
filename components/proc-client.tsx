"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "./ui";
import { useToast, type ActionResult } from "./client";
import { inr } from "@/lib/util";

/* ───────── signature pad ───────── */
export function SignaturePad({ name = "signature" }: { name?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext("2d")!;
    const fit = () => { const w = c.parentElement!.clientWidth; c.width = w; c.height = 140; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#1a2a36"; };
    fit();
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const start = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setEmpty(false); };
  const end = () => { if (!drawing.current) return; drawing.current = false; if (hidden.current) hidden.current.value = ref.current!.toDataURL("image/png"); };
  const clear = () => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); if (hidden.current) hidden.current.value = ""; setEmpty(true); };
  return (
    <div>
      <div className="relative rounded-lg border border-[var(--line-strong)] bg-white">
        <canvas ref={ref} className="block w-full touch-none" style={{ height: 140 }} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} aria-label="Signature area" />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-faint">Sign here</span>}
      </div>
      <input ref={hidden} type="hidden" name={name} />
      <button type="button" className="btn btn-sm mt-1.5" onClick={clear}>Clear</button>
    </div>
  );
}

/* ───────── project → material dependent pickers ───────── */
export interface MatOpt { id: number; project_id: number; name: string; unit: string; category: string; store: number; site: number; onHand: number; qty: number }
export function MaterialPicker({ projects, materials, defaultProject, show = "store", onlyWithStock = true }: { projects: { id: number; label: string }[]; materials: MatOpt[]; defaultProject?: number; show?: "store" | "site" | "onHand"; onlyWithStock?: boolean }) {
  const [pid, setPid] = useState<number | "">(defaultProject ?? "");
  const [mid, setMid] = useState<number | "">("");
  const opts = useMemo(() => materials.filter((m) => m.project_id === pid && (!onlyWithStock || m[show] > 0)), [materials, pid, show, onlyWithStock]);
  const sel = opts.find((m) => m.id === mid);
  return (
    <>
      <div><label className="label">Project *</label>
        <select name="project_id" required className="input" value={pid} onChange={(e) => { setPid(e.target.value ? Number(e.target.value) : ""); setMid(""); }}><option value="">Select…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
      <div><label className="label">Material *</label>
        <select name="requirement_id" required className="input" value={mid} disabled={!pid} onChange={(e) => setMid(e.target.value ? Number(e.target.value) : "")}><option value="">{pid ? (opts.length ? "Select…" : "No material with stock") : "Choose a project first"}</option>{opts.map((m) => <option key={m.id} value={m.id}>{m.name} — {m[show]} {m.unit} {show === "store" ? "in store" : show === "site" ? "at site" : "on hand"}</option>)}</select>
        {sel && <p className="hint">Maximum {sel[show]} {sel.unit}</p>}</div>
    </>
  );
}

/* ───────── search ───────── */
export function ProcSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ groups: { type: string; items: { code: string; title: string; sub?: string; href: string }[] }[] } | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => { try { const r = await fetch(`/api/procurement/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }); if (r.ok) { setRes(await r.json()); setOpen(true); } } catch { /* aborted */ } }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, []);
  return (
    <div className="relative" ref={box}>
      <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input className="input pl-8" style={{ width: 300 }} placeholder="PO, project, vendor, material, serial, GRN…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)} aria-label="Search procurement" />
      {open && res && (
        <div className="absolute right-0 z-40 mt-1 max-h-[60vh] w-[400px] max-w-[92vw] overflow-y-auto rounded-lg border border-line bg-white p-1.5 shadow-xl">
          {res.groups.length === 0 && <p className="p-3 text-center text-[13px] text-muted">No matches for “{q}”.</p>}
          {res.groups.map((g) => (
            <div key={g.type} className="mb-1"><div className="eyebrow px-2 pb-0.5 pt-1.5">{g.type}</div>
              {g.items.map((it) => <button key={it.href + it.code} onClick={() => { setOpen(false); router.push(it.href); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--green-50)]"><span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{it.title}</span><span className="block truncate text-xs text-muted">{it.code}{it.sub ? ` · ${it.sub}` : ""}</span></span><Icon name="arrow" size={12} className="text-faint" /></button>)}
            </div>))}
        </div>)}
    </div>
  );
}

/* ───────── column visibility for the big table ───────── */
export function ColumnPicker({ cols, tableId }: { cols: { key: string; label: string }[]; tableId: string }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("vos-proc-cols") ?? "[]"); if (Array.isArray(v)) setHidden(v); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem("vos-proc-cols", JSON.stringify(hidden)); } catch { /* ignore */ } }, [hidden]);
  return (
    <div className="relative">
      <style>{hidden.map((k) => `#${tableId} .col-${k}{display:none}`).join("")}</style>
      <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Columns</button>
      {open && <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-line bg-white p-2 shadow-lg">{cols.map((c) => <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-[13px]"><input type="checkbox" className="accent-[var(--green-600)]" checked={!hidden.includes(c.key)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((h) => h !== c.key) : [...hidden, c.key])} />{c.label}</label>)}</div>}
    </div>
  );
}

/* ───────── PO builder ───────── */
export interface ReqOpt { project_id?: number; project_label?: string; id: number; name: string; spec: string | null; unit: string; category: string; stage_id: number; stage_name: string; free: number; est: number; required_date: string | null; request_id: number | null; request_qty: number | null }
export interface CatRow { id: number; category: string; name: string; spec: string | null; unit: string; rate: number; tax_pct: number }
interface Extra { k: number; cat: string; name: string; spec: string; unit: string; qty: number; rate: number; tax: number; date: string }
export function POBuilder({ project, projects, vendors, stages, reqs, catalog = [], initial, poId, save }: {
  catalog?: CatRow[];
  project: { id: number; code: string; label: string; site: string };
  projects?: { id: number; label: string }[];
  vendors: { id: number; name: string; categories: string | null; payment_terms: string | null }[];
  stages: { id: number; name: string }[]; reqs: ReqOpt[];
  initial?: { vendor_id?: number; stage_id?: number | null; required_date?: string; payment_terms?: string; delivery_terms?: string; notes?: string; billing_address?: string; delivery_address?: string; lines?: Record<number, { qty: number; rate: number; tax_pct: number; description?: string; spec?: string; required_date?: string }> };
  poId?: number;
  save: (payload: string, submit: boolean) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [vendor, setVendor] = useState<number | "">(initial?.vendor_id ?? "");
  const [stage, setStage] = useState<number | "">(initial?.stage_id ?? "");
  const multi = (projects?.length ?? 0) > 1;
  const [f, setF] = useState({ required_date: initial?.required_date ?? "", payment_terms: initial?.payment_terms ?? "", delivery_terms: initial?.delivery_terms ?? "Delivery to project site, unloading by vendor", notes: initial?.notes ?? "", billing_address: initial?.billing_address ?? "", delivery_address: initial?.delivery_address ?? project.site });
  const [lines, setLines] = useState<Record<number, { on: boolean; qty: number; rate: number; tax: number; desc: string; spec: string; date: string }>>(() => {
    const o: Record<number, { on: boolean; qty: number; rate: number; tax: number; desc: string; spec: string; date: string }> = {};
    reqs.forEach((r) => { const il = initial?.lines?.[r.id]; o[r.id] = { on: !!il, qty: il?.qty ?? Math.min(r.request_qty ?? r.free, Math.max(r.free, 0)), rate: il?.rate ?? r.est, tax: il?.tax_pct ?? 18, desc: il?.description ?? r.name, spec: il?.spec ?? r.spec ?? "", date: il?.required_date ?? r.required_date ?? "" }; });
    return o;
  });
  const [extras, setExtras] = useState<Extra[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const cats = Array.from(new Set(catalog.map((c) => c.category)));
  const addExtra = () => setExtras((x) => [...x, { k: Date.now() + x.length, cat: cats[0] ?? "Other", name: "", spec: "", unit: "nos", qty: 1, rate: 0, tax: 18, date: f.required_date }]);
  const patchExtra = (k: number, p: Partial<Extra>) => setExtras((x) => x.map((e) => (e.k === k ? { ...e, ...p } : e)));
  const pickName = (k: number, cat: string, name: string) => { const opts = catalog.filter((c) => c.category === cat && c.name === name); const c0 = opts[0]; patchExtra(k, c0 ? { name, spec: c0.spec ?? "", unit: c0.unit, rate: c0.rate, tax: c0.tax_pct } : { name }); };
  const pickSpec = (k: number, cat: string, name: string, spec: string) => { const c0 = catalog.find((c) => c.category === cat && c.name === name && (c.spec ?? "") === spec); patchExtra(k, c0 ? { spec, unit: c0.unit, rate: c0.rate, tax: c0.tax_pct } : { spec }); };
  const vend = vendors.find((v) => v.id === vendor);
  const inStage = reqs.filter((r) => (stage === "" || r.stage_id === stage));
  const doneCount = inStage.filter((r) => r.free <= 0).length;
  const visible = inStage.filter((r) => showDone || r.free > 0);
  const chosen = reqs.filter((r) => lines[r.id]?.on);
  const sub = chosen.reduce((a, r) => a + lines[r.id].qty * lines[r.id].rate, 0) + extras.reduce((a, e) => a + e.qty * e.rate, 0);
  const tax = chosen.reduce((a, r) => a + (lines[r.id].qty * lines[r.id].rate * lines[r.id].tax) / 100, 0) + extras.reduce((a, e) => a + (e.qty * e.rate * e.tax) / 100, 0);
  const vendorCats = (vend?.categories ?? "").split(",").filter(Boolean);
  const mismatch = vend && vendorCats.length ? chosen.filter((r) => !vendorCats.includes(r.category)).map((r) => r.name) : [];

  const submit = async (submitForApproval: boolean) => {
    if (!vendor) return toast("Choose a vendor", "error");
    if (!chosen.length && !extras.length) return toast("Tick at least one material or add one from the catalog", "error");
    if (extras.some((e) => !e.name.trim() || !(e.qty > 0) || !(e.rate > 0))) return toast("Every added material needs a name, quantity and unit price", "error");
    setBusy(true);
    const payload = JSON.stringify({ multi, project_id: project.id, vendor_id: vendor, stage_id: multi ? null : stage || null, ...(multi ? { ...f, billing_address: "", delivery_address: "" } : f), lines: [...chosen.map((r) => ({ project_id: r.project_id ?? project.id, requirement_id: r.id, qty: lines[r.id].qty, rate: lines[r.id].rate, tax_pct: lines[r.id].tax, request_id: r.request_id, description: lines[r.id].desc, spec: lines[r.id].spec, required_date: lines[r.id].date })), ...extras.map((e) => ({ project_id: project.id, requirement_id: 0, qty: e.qty, rate: e.rate, tax_pct: e.tax, description: e.name, spec: e.spec, required_date: e.date, extra: { category: e.cat, name: e.name, spec: e.spec, unit: e.unit } }))] });
    try {
      const r = await save(payload, submitForApproval);
      if (r.ok) { toast(r.message ?? "Saved"); router.push(r.redirect ?? "/procurement/orders"); router.refresh(); } else toast(r.error ?? "Could not save", "error");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div className="card card-b grid gap-3 sm:grid-cols-2">
          <div><label className="label">Vendor *</label><select className="input" value={vendor} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : ""; setVendor(id); const v = vendors.find((x) => x.id === id); if (v?.payment_terms && !f.payment_terms) setF({ ...f, payment_terms: v.payment_terms }); }}><option value="">Select…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.categories ? ` — ${v.categories}` : ""}</option>)}</select></div>
          {!multi && <div><label className="label">Stage</label><select className="input" value={stage} onChange={(e) => setStage(e.target.value ? Number(e.target.value) : "")}><option value="">All stages</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
          <div><label className="label">Required delivery date</label><input type="date" className="input" value={f.required_date} onChange={(e) => setF({ ...f, required_date: e.target.value })} /><p className="hint">Blank → earliest requirement date</p></div>
          <div><label className="label">Payment terms</label><input className="input" value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} placeholder="e.g. 50% advance, balance on delivery" /></div>
        </div>

        <div className="card">
          <div className="card-h"><h3>Materials to order</h3>
            <div className="flex items-center gap-3 text-xs">
              {doneCount > 0 && <label className="flex items-center gap-1.5 text-faint"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show {doneCount} fully ordered</label>}
              <span className="text-faint">{chosen.length + extras.length} of {visible.filter((r) => r.free > 0).length + extras.length} selected</span>
              <button type="button" className="btn btn-sm" onClick={() => { const all = visible.filter((r) => r.free > 0).every((r) => lines[r.id].on); const n = { ...lines }; visible.forEach((r) => { if (r.free > 0) n[r.id] = { ...n[r.id], on: !all }; }); setLines(n); }}>Select / clear all</button>
            </div>
          </div>
          <datalist id="mat-names">{Array.from(new Set([...reqs.map((r) => r.name), ...catalog.map((c) => c.name)])).map((n) => <option key={n} value={n} />)}</datalist>
          {visible.length === 0 ? <p className="p-4 text-[13px] text-muted">Every BOQ line in this stage is already ordered. Use “Add material” below to order anything extra.</p> : (
            <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 1180 }}>
              <thead><tr><th style={{ width: 64 }}>Use</th><th style={{ minWidth: 240 }}>Material &amp; specification</th><th>{multi ? "Project" : "Stage"}</th><th className="r">Left</th><th style={{ width: 96 }}>Qty</th><th style={{ width: 120 }}>Unit price (₹)</th><th style={{ width: 84 }}>Tax %</th><th style={{ width: 140 }}>Deliver by</th><th className="r" style={{ width: 120 }}>Amount</th></tr></thead>
              <tbody>{visible.map((r) => { const l = lines[r.id]; const done = r.free <= 0; const set = (patch: Partial<typeof l>) => setLines({ ...lines, [r.id]: { ...l, ...patch, on: done ? false : true } }); return (
                <tr key={r.id} className={l.on ? "bg-[var(--green-50)]" : done ? "opacity-60" : ""}>
                  <td>{done ? <span className="badge b-gray" title="Whole BOQ quantity is already on other POs">Ordered</span> : <input type="checkbox" aria-label={`Select ${r.name}`} className="h-5 w-5 cursor-pointer accent-[var(--green-600)]" checked={l.on} onChange={(e) => setLines({ ...lines, [r.id]: { ...l, on: e.target.checked } })} />}</td>
                  <td>
                    <input className="input !h-8 font-semibold" list="mat-names" value={l.desc} disabled={done} aria-label="Material" onChange={(e) => set({ desc: e.target.value })} />
                    <input className="input !h-7 mt-1 text-xs" list={`spec-${r.id}`} value={l.spec} disabled={done} placeholder="Specification" aria-label="Specification" onChange={(e) => set({ spec: e.target.value })} />
                    <datalist id={`spec-${r.id}`}>{catalog.filter((c) => c.category === r.category && c.name === l.desc && c.spec).map((c) => <option key={c.id} value={c.spec!} />)}</datalist>
                    <div className="mt-0.5 text-[11px] text-faint">{r.category}{r.request_id ? " · from purchase request" : ""}{done ? " · fully ordered" : ""}</div>
                  </td>
                  <td className="text-xs text-muted">{multi ? r.project_label : r.stage_name}</td>
                  <td className="r num">{Math.max(r.free, 0)} {r.unit}</td>
                  <td><input type="number" min="0" max={r.free} step="any" className="input !h-8" value={l.qty} disabled={done} aria-label="Quantity" onChange={(e) => set({ qty: Number(e.target.value) })} /></td>
                  <td><input type="number" min="0" step="any" className="input !h-8" value={l.rate} disabled={done} aria-label="Unit price" onChange={(e) => set({ rate: Number(e.target.value) })} /></td>
                  <td><input type="number" min="0" max="100" step="any" className="input !h-8" value={l.tax} disabled={done} aria-label="Tax percent" onChange={(e) => set({ tax: Number(e.target.value) })} /></td>
                  <td><input type="date" className="input !h-8" value={l.date} disabled={done} aria-label="Deliver by" onChange={(e) => set({ date: e.target.value })} /></td>
                  <td className="r num font-semibold">{l.on ? inr(l.qty * l.rate * (1 + l.tax / 100)) : "—"}</td>
                </tr>); })}</tbody>
            </table></div>)}
        </div>

        {!multi && catalog.length > 0 && (
          <div className="card">
            <div className="card-h"><h3>Add materials from the catalog</h3><button type="button" className="btn btn-sm btn-primary" onClick={addExtra}><Icon name="plus" size={14} /> Add material</button></div>
            {extras.length === 0 ? <p className="p-4 text-[13px] text-muted">Need something that isn’t in the project’s BOQ? Add it here — pick a category, material and specification from the preloaded list, then edit quantity, price, tax and date. It’s recorded as an extra (outside BOQ).</p> : (
              <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 1180 }}>
                <thead><tr><th style={{ width: 130 }}>Category</th><th style={{ minWidth: 190 }}>Material</th><th style={{ minWidth: 230 }}>Specification</th><th style={{ width: 84 }}>Unit</th><th style={{ width: 96 }}>Qty</th><th style={{ width: 120 }}>Unit price (₹)</th><th style={{ width: 84 }}>Tax %</th><th style={{ width: 150 }}>Deliver by</th><th className="r" style={{ width: 110 }}>Amount</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>{extras.map((e) => { const names = Array.from(new Set(catalog.filter((c) => c.category === e.cat).map((c) => c.name))); const specs = catalog.filter((c) => c.category === e.cat && c.name === e.name && c.spec); return (
                  <tr key={e.k} className="bg-[var(--green-50)]">
                    <td><select className="input !h-8" value={e.cat} aria-label="Category" onChange={(ev) => patchExtra(e.k, { cat: ev.target.value, name: "", spec: "" })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><select className="input !h-8" value={e.name} aria-label="Material" onChange={(ev) => pickName(e.k, e.cat, ev.target.value)}><option value="">Select material…</option>{names.map((n) => <option key={n}>{n}</option>)}</select></td>
                    <td><input className="input !h-8" list={`xs-${e.k}`} value={e.spec} placeholder="Choose or type" aria-label="Specification" onChange={(ev) => pickSpec(e.k, e.cat, e.name, ev.target.value)} /><datalist id={`xs-${e.k}`}>{specs.map((c) => <option key={c.id} value={c.spec!} />)}</datalist></td>
                    <td><input className="input !h-8" value={e.unit} aria-label="Unit" onChange={(ev) => patchExtra(e.k, { unit: ev.target.value })} /></td>
                    <td><input type="number" min="0" step="any" className="input !h-8" value={e.qty} aria-label="Quantity" onChange={(ev) => patchExtra(e.k, { qty: Number(ev.target.value) })} /></td>
                    <td><input type="number" min="0" step="any" className="input !h-8" value={e.rate} aria-label="Unit price" onChange={(ev) => patchExtra(e.k, { rate: Number(ev.target.value) })} /></td>
                    <td><input type="number" min="0" max="100" step="any" className="input !h-8" value={e.tax} aria-label="Tax percent" onChange={(ev) => patchExtra(e.k, { tax: Number(ev.target.value) })} /></td>
                    <td><input type="date" className="input !h-8" value={e.date} aria-label="Deliver by" onChange={(ev) => patchExtra(e.k, { date: ev.target.value })} /></td>
                    <td className="r num font-semibold">{inr(e.qty * e.rate * (1 + e.tax / 100))}</td>
                    <td><button type="button" className="text-faint hover:text-[var(--red)]" aria-label="Remove line" onClick={() => setExtras((x) => x.filter((y) => y.k !== e.k))}><Icon name="x" size={16} /></button></td>
                  </tr>); })}</tbody>
              </table></div>)}
          </div>)}

        <div className="card card-b grid gap-3 sm:grid-cols-2">
          {!multi && <><div><label className="label">Billing address</label><textarea rows={2} className="input" value={f.billing_address} onChange={(e) => setF({ ...f, billing_address: e.target.value })} placeholder="Blank → ViryaSys registered address" /></div>
          <div><label className="label">Delivery address</label><textarea rows={2} className="input" value={f.delivery_address} onChange={(e) => setF({ ...f, delivery_address: e.target.value })} /></div></>}
          <div><label className="label">Delivery terms</label><input className="input" value={f.delivery_terms} onChange={(e) => setF({ ...f, delivery_terms: e.target.value })} /></div>
          <div><label className="label">Notes to vendor</label><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
      </div>

      <div className="space-y-5 xl:sticky xl:top-20 xl:self-start">
        <div className="card card-b">
          <div className="eyebrow">{multi ? `${projects!.length} projects` : "Project"}</div><div className="text-[14px] font-extrabold">{multi ? projects!.map((p) => p.label.split(" · ")[1] ?? p.label).join(", ") : project.label}</div>
          {multi && <p className="hint mt-1">One PO per project is created, so delivery, receipt and stock stay traceable to each project.</p>}
          <div className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><span className="text-muted">Lines</span><b className="num">{chosen.length + extras.length}</b></div>
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><b className="num">{inr(sub)}</b></div>
            <div className="flex justify-between"><span className="text-muted">Tax</span><b className="num">{inr(tax)}</b></div>
            <div className="flex justify-between border-t border-line pt-2 text-[15px]"><b>Total</b><b className="num">{inr(sub + tax)}</b></div>
          </div>
          {mismatch.length > 0 && <p className="mt-3 rounded-md bg-[var(--orange-50)] p-2 text-xs text-[var(--orange)]">Heads up: {vend?.name} isn’t listed for {mismatch.join(", ")}.</p>}
          <div className="mt-4 flex flex-col gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>{busy ? "Saving…" : "Save & submit for approval"}</button>
            <button className="btn" disabled={busy} onClick={() => submit(false)}>Save as draft</button>
            <Link href={poId ? `/procurement/${poId}` : "/procurement/orders"} className="btn btn-ghost">Cancel</Link>
          </div>
          <p className="hint mt-2">The MD or Finance must approve before the PO is released to the vendor.</p>
        </div>
      </div>
    </div>
  );
}

/* ───────── guided receiving flow (mobile-first) ───────── */
export interface RxItem { id: number; description: string; spec: string | null; unit: string; category: string; qty_dispatched: number; qty_received: number; qty_short: number }
export function ReceivingFlow({ delivery, items, mode, actions, customerHint }: {
  delivery: { id: number; code: string; project: string; vendor: string; po: string };
  items: RxItem[]; mode: "receive" | "inspect" | "ack";
  actions: { receive: (fd: FormData) => Promise<ActionResult>; inspect: (fd: FormData) => Promise<ActionResult>; ack: (fd: FormData) => Promise<ActionResult> };
  customerHint: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const order: ("arrival" | "items" | "inspect" | "sign")[] = mode === "receive" ? ["arrival", "items", "inspect", "sign"] : mode === "inspect" ? ["inspect", "sign"] : ["sign"];
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [arrival, setArrival] = useState({ received_by: "", vehicle: "", driver: "", notes: "" });
  const [rows, setRows] = useState(() => Object.fromEntries(items.map((i) => [i.id, { recv: mode === "receive" ? i.qty_dispatched : i.qty_received, spec: "yes", cond: "Good", pack: "Intact", dmg: 0, rej: 0, serials: "", remarks: "" }])));
  const [inspectNow, setInspectNow] = useState(true);
  const [cust, setCust] = useState(customerHint);
  const [remarks, setRemarks] = useState("");
  const sigRef = useRef<HTMLDivElement>(null);
  const files = useRef<Record<string, File[]>>({ delivery: [], inspection: [] });
  const cur = order[step];
  const set = (id: number, k: string, v: any) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }));

  const finish = async (withSignature: boolean) => {
    setBusy(true);
    try {
      if (mode === "receive") {
        const fd = new FormData();
        fd.set("received_by", arrival.received_by); fd.set("vehicle", arrival.vehicle); fd.set("driver", arrival.driver); fd.set("notes", arrival.notes);
        items.forEach((i) => fd.set(`recv_${i.id}`, String(rows[i.id].recv)));
        files.current.delivery.forEach((f) => fd.append("photos", f));
        const r = await actions.receive(fd); if (!r.ok) throw new Error(r.error);
        if (!inspectNow) { toast("Received — inspection is pending"); router.push(`/procurement/deliveries/${delivery.id}`); router.refresh(); return; }
      }
      if (mode !== "ack") {
        const fd = new FormData();
        items.forEach((i) => {
          const r = rows[i.id]; const recv = mode === "receive" ? r.recv : i.qty_received;
          const wrong = r.spec === "no"; // wrong specification → the whole lot is rejected
          const dmg = wrong ? 0 : Math.min(recv, r.dmg), rej = wrong ? recv : 0;
          fd.set(`spec_${i.id}`, r.spec); fd.set(`cond_${i.id}`, r.cond); fd.set(`pack_${i.id}`, r.pack); fd.set(`serials_${i.id}`, r.serials); fd.set(`remarks_${i.id}`, r.remarks);
          fd.set(`acc_${i.id}`, String(Math.max(0, recv - dmg - rej))); fd.set(`dmg_${i.id}`, String(dmg)); fd.set(`rej_${i.id}`, String(rej));
        });
        files.current.inspection.forEach((f) => fd.append("photos", f));
        const r = await actions.inspect(fd); if (!r.ok) throw new Error(r.error);
        toast(r.message ?? "Inspection recorded");
      }
      if (withSignature) {
        const fd = new FormData();
        fd.set("customer_name", cust); fd.set("remarks", remarks);
        fd.set("signature", (sigRef.current?.querySelector("input[name=signature]") as HTMLInputElement | null)?.value ?? "");
        const r = await actions.ack(fd); if (!r.ok) throw new Error(r.error);
        toast("Customer acknowledged the delivery");
      }
      router.push(`/procurement/deliveries/${delivery.id}`); router.refresh();
    } catch (e: any) { toast(e.message ?? "Something went wrong", "error"); } finally { setBusy(false); }
  };

  const next = () => {
    if (cur === "arrival" && !arrival.received_by.trim()) return toast("Enter who is receiving the material", "error");
    if (cur === "items") for (const i of items) { const q = rows[i.id].recv; if (q < 0 || q > i.qty_dispatched) return toast(`${i.description}: quantity must be between 0 and ${i.qty_dispatched}`, "error"); }
    setStep(step + 1);
  };
  const totalSteps = order.length;
  const Field = ({ l, children }: { l: string; children: React.ReactNode }) => <div><label className="label">{l}</label>{children}</div>;

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="mb-4 flex items-center gap-2" aria-label={`Step ${step + 1} of ${totalSteps}`}>
        {order.map((o, i) => <div key={o} className="flex-1"><div className="h-1.5 rounded-full" style={{ background: i <= step ? "var(--green-500)" : "#dfe5ea" }} /><div className={`mt-1 text-[10.5px] font-bold uppercase tracking-wider ${i === step ? "text-ink" : "text-faint"}`}>{o === "arrival" ? "Arrival" : o === "items" ? "Quantities" : o === "inspect" ? "Inspect" : "Sign-off"}</div></div>)}
      </div>

      {cur === "arrival" && (
        <div className="card card-b space-y-3">
          <h2 className="text-[15px] font-extrabold">Material has arrived</h2>
          <p className="text-[13px] text-muted">{delivery.code} · {delivery.project} · from {delivery.vendor}</p>
          <Field l="Received by *"><input className="input" style={{ height: 44 }} value={arrival.received_by} onChange={(e) => setArrival({ ...arrival, received_by: e.target.value })} autoComplete="name" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field l="Vehicle no."><input className="input" style={{ height: 44 }} value={arrival.vehicle} onChange={(e) => setArrival({ ...arrival, vehicle: e.target.value })} placeholder="TN 09 AB 1234" /></Field><Field l="Driver"><input className="input" style={{ height: 44 }} value={arrival.driver} onChange={(e) => setArrival({ ...arrival, driver: e.target.value })} /></Field></div>
          <Field l="Photos of the delivery"><input type="file" accept="image/*" capture="environment" multiple className="input !h-auto py-2 text-xs" onChange={(e) => (files.current.delivery = Array.from(e.target.files ?? []))} /></Field>
          <Field l="Notes"><input className="input" style={{ height: 44 }} value={arrival.notes} onChange={(e) => setArrival({ ...arrival, notes: e.target.value })} /></Field>
        </div>)}

      {cur === "items" && (
        <div className="space-y-3">
          <h2 className="text-[15px] font-extrabold">How much was unloaded?</h2>
          {items.map((i) => (
            <div key={i.id} className="card card-b">
              <div className="text-[14px] font-bold">{i.description}</div>
              <div className="text-xs text-muted">{i.spec ?? i.category} · expected {i.qty_dispatched} {i.unit}</div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="btn" style={{ width: 44, height: 44 }} onClick={() => set(i.id, "recv", Math.max(0, Number(rows[i.id].recv) - 1))} aria-label="Decrease">−</button>
                <input type="number" inputMode="decimal" min="0" max={i.qty_dispatched} step="any" className="input text-center text-lg font-bold" style={{ height: 44 }} value={rows[i.id].recv} onChange={(e) => set(i.id, "recv", Number(e.target.value))} aria-label={`Received quantity for ${i.description}`} />
                <button type="button" className="btn" style={{ width: 44, height: 44 }} onClick={() => set(i.id, "recv", Math.min(i.qty_dispatched, Number(rows[i.id].recv) + 1))} aria-label="Increase">+</button>
                <button type="button" className="btn btn-sm" onClick={() => set(i.id, "recv", i.qty_dispatched)}>All</button>
              </div>
              {rows[i.id].recv < i.qty_dispatched && <p className="mt-1.5 text-xs font-semibold text-[var(--red)]">Short by {i.qty_dispatched - rows[i.id].recv} {i.unit} — a shortage exception will be raised.</p>}
            </div>))}
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[var(--green-600)]" checked={inspectNow} onChange={(e) => setInspectNow(e.target.checked)} /> Inspect now (uncheck to inspect later)</label>
        </div>)}

      {cur === "inspect" && (
        <div className="space-y-3">
          <h2 className="text-[15px] font-extrabold">Inspect the material</h2>
          {items.map((i) => { const r = rows[i.id]; const recv = mode === "receive" ? r.recv : i.qty_received; return (
            <div key={i.id} className="card card-b space-y-3">
              <div><div className="text-[14px] font-bold">{i.description}</div><div className="text-xs text-muted">{recv} {i.unit} received{i.spec ? ` · ${i.spec}` : ""}</div></div>
              <div className="grid grid-cols-2 gap-3">
                <Field l="Matches specification?"><select className="input" style={{ height: 44 }} value={r.spec} onChange={(e) => set(i.id, "spec", e.target.value)}><option value="yes">Yes</option><option value="no">No — reject lot</option></select></Field>
                <Field l="Packaging"><select className="input" style={{ height: 44 }} value={r.pack} onChange={(e) => set(i.id, "pack", e.target.value)}><option>Intact</option><option>Torn / wet</option><option>Missing</option></select></Field>
                <Field l="Condition"><select className="input" style={{ height: 44 }} value={r.cond} onChange={(e) => set(i.id, "cond", e.target.value)}><option>Good</option><option>Minor damage</option><option>Damaged</option></select></Field>
                <Field l={`Damaged qty`}><input type="number" min="0" max={recv} step="any" className="input" style={{ height: 44 }} value={r.dmg} disabled={r.spec === "no"} onChange={(e) => set(i.id, "dmg", Math.min(recv, Number(e.target.value)))} /></Field>
              </div>
              {["Inverters"].includes(i.category) && <Field l="Serial numbers (comma or new line)"><textarea rows={2} className="input" value={r.serials} onChange={(e) => set(i.id, "serials", e.target.value)} placeholder="SN123, SN124…" /></Field>}
              <Field l="Remarks"><input className="input" style={{ height: 44 }} value={r.remarks} onChange={(e) => set(i.id, "remarks", e.target.value)} /></Field>
              <p className="text-xs font-semibold">{r.spec === "no" ? <span className="text-[var(--red)]">Accepted 0 · Rejected {recv}</span> : <span>Accepted <b className="text-[var(--green-700)]">{Math.max(0, recv - r.dmg)}</b> · Damaged <b className="text-[var(--red)]">{r.dmg}</b></span>}</p>
            </div>); })}
          <Field l="Inspection photos (evidence)"><input type="file" accept="image/*" capture="environment" multiple className="input !h-auto py-2 text-xs" onChange={(e) => (files.current.inspection = Array.from(e.target.files ?? []))} /></Field>
        </div>)}

      {cur === "sign" && (
        <div className="card card-b space-y-3" ref={sigRef}>
          <h2 className="text-[15px] font-extrabold">Customer acknowledgement</h2>
          <p className="text-[13px] text-muted">“Material received at site.” The signed delivery note transfers responsibility for the accepted material.</p>
          <Field l="Customer name *"><input className="input" style={{ height: 44 }} value={cust} onChange={(e) => setCust(e.target.value)} /></Field>
          <Field l="Signature"><SignaturePad /></Field>
          <Field l="Remarks"><input className="input" style={{ height: 44 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </div>)}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button className="btn" disabled={busy || step === 0} onClick={() => setStep(step - 1)}>Back</button>
        {step < totalSteps - 1 ? <button className="btn btn-primary" style={{ height: 44, minWidth: 120 }} onClick={next}>Next</button> : (
          <div className="flex flex-wrap justify-end gap-2">
            {mode !== "ack" && <button className="btn" disabled={busy} onClick={() => finish(false)}>Finish without signature</button>}
            <button className="btn btn-primary" style={{ height: 44 }} disabled={busy || !cust.trim()} onClick={() => finish(true)}>{busy ? "Saving…" : mode === "ack" ? "Accept delivery" : "Finish & sign"}</button>
          </div>)}
      </div>
    </div>
  );
}

/* ───────── multi-select project picker ───────── */
export function ProjectMultiSelect({ projects }: { projects: { id: number; name: string; code: string; kw: string; nreq: number }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const shown = projects.filter((p) => !q || `${p.name} ${p.code}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allShown = shown.length > 0 && shown.every((p) => sel.includes(p.id));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <input className="input" style={{ width: 220 }} placeholder="Filter projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter projects" />
        <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[var(--green-600)]" checked={allShown} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...shown.map((p) => p.id)])] : sel.filter((id) => !shown.some((p) => p.id === id)))} /> Select all shown</label>
        <span className="ml-auto flex items-center gap-2">
          {sel.length > 0 && <button className="btn btn-sm" onClick={() => setSel([])}>Clear</button>}
          <button className="btn btn-primary btn-sm" disabled={sel.length === 0} onClick={() => router.push(sel.length === 1 ? `/procurement/new?project=${sel[0]}` : `/procurement/new?projects=${sel.join(",")}`)}>{sel.length ? `Create PO for ${sel.length} project${sel.length > 1 ? "s" : ""}` : "Select projects"}</button>
        </span>
      </div>
      <ul className="max-h-[70vh] overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id} className="border-b border-line last:border-0">
            <label className={`row-link flex cursor-pointer items-center gap-3 px-4 py-2.5 ${sel.includes(p.id) ? "bg-[var(--green-50)]" : ""}`}>
              <input type="checkbox" className="h-4 w-4 accent-[var(--green-600)]" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
              <span className="min-w-0 flex-1"><b className="text-[13.5px]">{p.name}</b><span className="ml-2 text-xs text-muted num">{p.code} · {p.kw}</span></span><span className="badge b-blue">{p.nreq} to order</span>
              <Link href={`/procurement/new?project=${p.id}`} className="lnk text-xs" onClick={(e) => e.stopPropagation()}>Open alone</Link>
            </label>
          </li>))}
        {shown.length === 0 && <li className="p-6 text-center text-[13px] text-muted">No project matches “{q}”.</li>}
      </ul>
    </div>
  );
}
