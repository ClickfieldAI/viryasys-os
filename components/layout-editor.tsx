"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import { useToast, type ActionResult } from "./client";
import { LayoutSheet, sheetGeometry, titleBlockColumns } from "./layout-sheet";
import { MODULE_PRESETS, MOUNTING, arrayBox, check, fillRoof, snap, totals, uid, type Drawing, type Sheet, type PvArray, type Roof, type Obstacle, type Note, type Dim } from "@/lib/layout-geom";

interface Img { kind: string; id: number; name: string; path: string }
type Sel = string | null;
const kindOf = (s: Sel) => (s ? s.split(":")[0] : "");
const idOf = (s: Sel) => (s ? s.split(":")[1] : "");

function Num({ label, value, onChange, step = 10, unit = "mm", min }: { label: string; value: number; onChange: (n: number) => void; step?: number; unit?: string; min?: number }) {
  return <div><label className="label">{label}{unit && <span className="ml-1 font-normal text-faint">({unit})</span>}</label><input className="input !h-8" type="number" step={step} min={min} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}
function Txt({ label, value, onChange, ph, span }: { label: string; value: string; onChange: (v: string) => void; ph?: string; span?: boolean }) {
  return <div className={span ? "col-span-2" : ""}><label className="label">{label}</label><input className="input !h-8" value={value} placeholder={ph} onChange={(e) => onChange(e.target.value)} /></div>;
}

export function LayoutEditor({ id, init, aerial, images, proposalCode, actions }: {
  id: number; code: string;
  init: { sheet: Sheet; drawing: Drawing; status: string; rev: string };
  aerial: string | null; images: Img[]; proposalCode: string | null;
  actions: { save: (payload: string) => Promise<ActionResult>; issue: () => Promise<ActionResult>; aerial: (fd: FormData) => Promise<ActionResult>; attach: (fd: FormData) => Promise<ActionResult> };
}) {
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(init.sheet);
  const [d, setD] = useState<Drawing>(init.drawing);
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [orient, setOrient] = useState<"portrait" | "landscape">("portrait");
  const [setback, setSetback] = useState(600);
  const [gap, setGap] = useState(20);
  const [count, setCount] = useState(0);
  const hist = useRef<Drawing[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { key: string; wx: number; wy: number; orig: any }>(null);

  const geo = useMemo(() => sheetGeometry(sheet, d), [sheet, d]);
  const cols0 = useMemo(() => titleBlockColumns(geo), [geo]);
  const t = useMemo(() => totals(d, sheet.module_wp), [d, sheet.module_wp]);
  const problems = useMemo(() => check(d), [d]);

  const push = () => { hist.current = [...hist.current.slice(-30), structuredClone(d)]; };
  const change = (fn: (x: Drawing) => Drawing, record = true) => { if (record) push(); setD((x) => fn(x)); setDirty(true); };
  const undo = () => { const p = hist.current.pop(); if (p) { setD(p); setDirty(true); setSel(null); } };
  const setS = (patch: Partial<Sheet>) => { setSheet((s) => ({ ...s, ...patch })); setDirty(true); };

  const toWorld = (e: React.PointerEvent) => {
    const svg = svgRef.current!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: (p.x - geo.ox) / geo.s, y: (p.y - geo.oy) / geo.s };
  };
  const getEl = (key: string): any => { const [k, i] = key.split(":"); return (k === "roof" ? d.roofs : k === "array" ? d.arrays : k === "obs" ? d.obstacles : d.notes).find((x: any) => x.id === i); };
  const onPick = (key: Sel, e?: React.PointerEvent) => {
    setSel(key);
    if (key && e) { const w = toWorld(e); const el = getEl(key); if (el) { push(); drag.current = { key, wx: w.x, wy: w.y, orig: { x: el.x, y: el.y, tx: el.tx, ty: el.ty } }; (e.currentTarget as SVGElement).ownerSVGElement?.setPointerCapture(e.pointerId); } }
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const dr = drag.current; if (!dr) return;
    const w = toWorld(e); const dx = w.x - dr.wx, dy = w.y - dr.wy;
    const step = e.shiftKey ? 1 : 10;
    const [k, i] = dr.key.split(":");
    setD((x) => ({
      ...x,
      roofs: k === "roof" ? x.roofs.map((r) => (r.id === i ? { ...r, x: snap(dr.orig.x + dx, step), y: snap(dr.orig.y + dy, step) } : r)) : x.roofs,
      arrays: k === "array" ? x.arrays.map((a) => (a.id === i ? { ...a, x: snap(dr.orig.x + dx, step), y: snap(dr.orig.y + dy, step) } : a)) : x.arrays,
      obstacles: k === "obs" ? x.obstacles.map((o) => (o.id === i ? { ...o, x: snap(dr.orig.x + dx, step), y: snap(dr.orig.y + dy, step) } : o)) : x.obstacles,
      notes: k === "note" ? x.notes.map((n) => (n.id === i ? { ...n, x: snap(dr.orig.x + dx, step), y: snap(dr.orig.y + dy, step) } : n)) : x.notes,
    }));
    setDirty(true);
  };
  const onUp = () => { drag.current = null; };

  const mainRoof = d.roofs.find((r) => r.kind === "roof") ?? d.roofs[0];
  const add = {
    roof: (kind: "roof" | "area") => { const r: Roof = { id: uid(), x: mainRoof ? mainRoof.x + mainRoof.w + 600 : 0, y: mainRoof?.y ?? 0, w: 4000, h: 3000, label: kind === "roof" ? "ROOF" : "BUILDING", kind }; change((x) => ({ ...x, roofs: [...x.roofs, r] })); setSel(`roof:${r.id}`); },
    array: () => { const wide = orient === "portrait" ? { mw: sheet.module_w, mh: sheet.module_h } : { mw: sheet.module_h, mh: sheet.module_w }; const a: PvArray = { id: uid(), x: (mainRoof?.x ?? 0) + setback, y: (mainRoof?.y ?? 0) + setback, rows: 1, cols: 3, ...wide, gap, dim: true }; change((x) => ({ ...x, arrays: [...x.arrays, a] })); setSel(`array:${a.id}`); },
    obs: (kind: "circle" | "rect") => { const o: Obstacle = { id: uid(), kind, x: (mainRoof?.x ?? 0) + 500, y: (mainRoof?.y ?? 0) + 500, w: kind === "circle" ? 1200 : 1500, h: kind === "circle" ? 1200 : 1000, label: kind === "circle" ? "TANK" : "" }; change((x) => ({ ...x, obstacles: [...x.obstacles, o] })); setSel(`obs:${o.id}`); },
    note: () => { const b = mainRoof ?? { x: 0, y: 0, w: 6000, h: 4000 }; const n: Note = { id: uid(), text: "NOTE", x: b.x + b.w * 0.5, y: b.y + b.h + 1500, tx: b.x + b.w * 0.5, ty: b.y + b.h }; change((x) => ({ ...x, notes: [...x.notes, n] })); setSel(`note:${n.id}`); },
    dim: () => { const b = mainRoof ?? { x: 0, y: 0, w: 6000, h: 4000 }; const m: Dim = { id: uid(), x1: b.x, y1: b.y + b.h, x2: b.x + Math.min(b.w, 3000), y2: b.y + b.h, offset: 6, text: "" }; change((x) => ({ ...x, dims: [...x.dims, m] })); setSel(`dim:${m.id}`); },
  };
  const del = () => { if (!sel) return; const [k, i] = sel.split(":"); change((x) => ({ ...x, roofs: k === "roof" ? x.roofs.filter((r) => r.id !== i) : x.roofs, arrays: k === "array" ? x.arrays.filter((r) => r.id !== i) : x.arrays, obstacles: k === "obs" ? x.obstacles.filter((r) => r.id !== i) : x.obstacles, notes: k === "note" ? x.notes.filter((r) => r.id !== i) : x.notes, dims: k === "dim" ? x.dims.filter((r) => r.id !== i) : x.dims })); setSel(null); };
  const dup = () => { if (!sel) return; const [k, i] = sel.split(":"); const nid = uid(); change((x) => k === "array" ? { ...x, arrays: [...x.arrays, { ...x.arrays.find((a) => a.id === i)!, id: nid, y: x.arrays.find((a) => a.id === i)!.y + 1500 }] } : k === "obs" ? { ...x, obstacles: [...x.obstacles, { ...x.obstacles.find((a) => a.id === i)!, id: nid, x: x.obstacles.find((a) => a.id === i)!.x + 1200 }] } : x); };

  const upd = <K extends "roofs" | "arrays" | "obstacles" | "notes" | "dims">(k: K, i: string, patch: Partial<Drawing[K][number]>) => change((x) => ({ ...x, [k]: (x[k] as any[]).map((e) => (e.id === i ? { ...e, ...patch } : e)) }) as Drawing, false) ;
  const autoFill = (r: Roof) => {
    const arr = fillRoof(r, { w: sheet.module_w, h: sheet.module_h }, orient, setback, gap, count || undefined);
    if (!arr.length) return toast("The roof section is too small for a module with that clearance", "error");
    change((x) => ({ ...x, arrays: [...x.arrays.filter((a) => { const b = arrayBox(a); return !(b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h); }), ...arr] }));
    toast(`Placed ${arr.reduce((s, a) => s + a.rows * a.cols, 0)} modules`);
  };

  const save = async (): Promise<boolean> => {
    setBusy("save");
    try { const r = await actions.save(JSON.stringify({ sheet, drawing: d })); if (r.ok) { toast(r.message ?? "Saved"); setDirty(false); router.refresh(); return true; } toast(r.error ?? "Could not save", "error"); return false; } catch (e: any) { toast(e.message, "error"); return false; } finally { setBusy(""); }
  };
  const ensureSaved = async () => (dirty ? save() : true);
  const issue = async () => {
    if (!(await ensureSaved())) return;
    setBusy("issue"); try { const r = await actions.issue(); if (r.ok) { toast(r.message ?? "Issued"); router.refresh(); } else toast(r.error ?? "Failed", "error"); } finally { setBusy(""); }
  };
  const openPrint = async () => { if (!(await ensureSaved())) return; window.open(`/layout-print/${id}`, "_blank"); };
  const fileBase = () => `${sheet.sheet_no} ${sheet.customer_name} Rev ${sheet.rev}`.replace(/[^\w .-]+/g, "").trim();
  const download = (blob: Blob, name: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  /** Serialise the sheet with images inlined so it renders standalone (SVG file / PNG export). */
  const standaloneSvg = async () => {
    const svg = svgRef.current!.cloneNode(true) as SVGSVGElement;
    for (const im of Array.from(svg.querySelectorAll("image"))) {
      const href = im.getAttribute("href"); if (!href) continue;
      const blob = await (await fetch(href)).blob();
      im.setAttribute("href", await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); }));
    }
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.removeAttribute("class");
    svg.querySelectorAll("[style*='cursor']").forEach((el) => (el as SVGElement).style.removeProperty("cursor"));
    const out = new XMLSerializer().serializeToString(svg);
    return out.replace(/<svg /, `<svg width="${geo.W}mm" height="${geo.H}mm" `);
  };
  const renderPng = async (): Promise<Blob> => {
    const W = 3000, H = Math.round((W * geo.H) / geo.W);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Could not render the sheet")); standaloneSvg().then((x) => { img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(x); }, rej); });
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
    return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Export failed"))), "image/png"));
  };
  const exportAs = async (kind: "png" | "svg") => {
    setBusy(kind);
    try { if (kind === "svg") download(new Blob([await standaloneSvg()], { type: "image/svg+xml" }), `${fileBase()}.svg`); else download(await renderPng(), `${fileBase()}.png`); }
    catch (e: any) { toast(e.message || "Export failed", "error"); } finally { setBusy(""); }
  };
  const setAerial = async (fd: FormData) => { setBusy("aerial"); try { const r = await actions.aerial(fd); if (r.ok) { toast("Aerial image updated"); router.refresh(); } else toast(r.error ?? "Failed", "error"); } finally { setBusy(""); } };
  const aerialFileRef = useRef<HTMLInputElement>(null);
  const onAerialFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.set("file", f);
    await setAerial(fd);
    e.target.value = "";
  };

  const attach = async () => {
    if (!(await ensureSaved())) return;
    setBusy("attach");
    try {
      const blob = await renderPng();
      const fd = new FormData(); fd.set("file", new File([blob], `Preliminary layout ${sheet.sheet_no} Rev ${sheet.rev}.png`, { type: "image/png" }));
      const r = await actions.attach(fd); if (r.ok) toast(r.message ?? "Attached"); else toast(r.error ?? "Failed", "error");
    } catch (e: any) { toast(e.message || "Could not attach — use Print / PDF instead", "error"); } finally { setBusy(""); }
  };

  const selEl = getEl(sel ?? "") ?? (kindOf(sel) === "dim" ? d.dims.find((x) => x.id === idOf(sel)) : undefined);
  const k = kindOf(sel);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-3">
        <div className="card flex flex-wrap items-center gap-2 p-2.5">
          <button className="btn btn-sm" onClick={() => add.roof("roof")}><Icon name="plus" size={13} /> Roof section</button>
          <button className="btn btn-sm" onClick={() => add.roof("area")}><Icon name="plus" size={13} /> Adjoining area</button>
          <button className="btn btn-sm" onClick={add.array}><Icon name="plus" size={13} /> PV array</button>
          <button className="btn btn-sm" onClick={() => add.obs("circle")}><Icon name="plus" size={13} /> Tank / round</button>
          <button className="btn btn-sm" onClick={() => add.obs("rect")}><Icon name="plus" size={13} /> Obstacle box</button>
          <button className="btn btn-sm" onClick={add.note}><Icon name="plus" size={13} /> Callout</button>
          <button className="btn btn-sm" onClick={add.dim}><Icon name="plus" size={13} /> Dimension</button>
          <span className="mx-1 h-5 w-px bg-line" />
          <button className="btn btn-sm" onClick={undo}>Undo</button>
          <button className="btn btn-sm" onClick={dup} disabled={!sel}>Duplicate</button>
          <button className="btn btn-sm btn-danger" onClick={del} disabled={!sel}>Delete</button>
          <span className="ml-auto text-xs text-faint">Drag items to move · Shift = fine (1 mm) · click empty space to deselect</span>
        </div>
        <div className="card relative overflow-hidden p-2">
          <LayoutSheet sheet={sheet} drawing={d} aerial={aerial} selectedId={sel} onPick={onPick} svgRef={svgRef} onPointerMove={onMove} onPointerUp={onUp} />
          <input ref={aerialFileRef} type="file" accept="image/*" className="hidden" onChange={onAerialFile} />
          <button type="button" title={aerial ? "Replace the aerial photo" : "Attach an aerial photo"} disabled={busy === "aerial"}
            onClick={() => aerialFileRef.current?.click()}
            className="absolute z-10 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-[var(--green-600)] bg-white/90 text-[var(--green-700)] backdrop-blur-sm transition hover:bg-[var(--green-50)] disabled:opacity-60"
            style={{ left: `${(cols0.cx[0] / geo.W) * 100}%`, top: `${((geo.titleTop + 5 * geo.u) / geo.H) * 100}%`, width: `${(cols0.cols[0] / geo.W) * 100}%`, height: `${((geo.titleH - 5 * geo.u) / geo.H) * 100}%` }}>
            <Icon name="upload" size={16} />
            <span className="px-1 text-center text-[10px] font-semibold leading-tight">{busy === "aerial" ? "Uploading…" : aerial ? "Replace photo" : "Attach photo"}</span>
          </button>
        </div>
        {problems.length > 0 && <div className="rounded-xl border border-[#f0d9a8] bg-[var(--solar-50)] p-3 text-[13px]"><b>Check the layout:</b><ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
        <div className="card card-b">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-[var(--green-50)] p-2"><div className="text-xs text-muted">Modules</div><b className="num text-[20px]">{t.modules}</b></div>
            <div className="rounded-lg bg-[var(--green-50)] p-2"><div className="text-xs text-muted">Capacity</div><b className="num text-[20px]">{t.kwp} kWp</b></div>
            <div className="rounded-lg bg-[var(--sunk)] p-2"><div className="text-xs text-muted">Array area</div><b className="num text-[20px]">{t.area_sqm} m²</b></div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <button className="btn btn-primary w-full" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
            <div className="grid grid-cols-2 gap-2"><button className="btn" onClick={openPrint}><Icon name="file" size={14} /> Print / PDF</button><button className="btn" disabled={busy === "issue"} onClick={issue}>Issue Rev {sheet.rev}</button></div>
            <div className="rounded-lg bg-[var(--sunk)] p-2">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">Print &amp; download</div>
              <div className="grid grid-cols-3 gap-1.5">
                <button className="btn btn-sm" onClick={openPrint} title="Opens the print dialog — choose Save as PDF">PDF</button>
                <button className="btn btn-sm" disabled={busy === "png"} onClick={() => exportAs("png")}>{busy === "png" ? "…" : "PNG"}</button>
                <button className="btn btn-sm" disabled={busy === "svg"} onClick={() => exportAs("svg")}>{busy === "svg" ? "…" : "SVG"}</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <div><label className="label">Paper</label><select className="input !h-8" value={sheet.paper} onChange={(e) => setS({ paper: e.target.value as any })}><option value="A4">A4 (210 × 297)</option><option value="A3">A3 (297 × 420)</option></select></div>
                <div><label className="label">Scale</label><select className="input !h-8" value={sheet.scale} onChange={(e) => setS({ scale: e.target.value as any })}><option value="NTS">Not to scale</option><option value="AUTO">1 : n (computed)</option></select></div>
              </div>
              <p className="hint mt-1.5">Changes are saved automatically before printing. In the print dialog choose <b>Save as PDF</b>, landscape, margins <b>None</b>.</p>
            </div>
            <button className="btn" disabled={!proposalCode || busy === "attach"} onClick={attach} title={proposalCode ? "" : "Generate the proposal first"}>{busy === "attach" ? "Attaching…" : proposalCode ? `Attach to proposal ${proposalCode}` : "Attach to proposal (no proposal yet)"}</button>
          </div>
          <p className="hint mt-2">Status: <b>{init.status}</b> · editing an issued layout starts the next revision letter.</p>
        </div>

        {sel && selEl ? (
          <div className="card card-b">
            <div className="mb-2 flex items-center justify-between"><h4 className="text-[13.5px] font-extrabold capitalize">{k === "obs" ? "Obstacle" : k === "note" ? "Callout" : k === "dim" ? "Dimension" : k === "roof" ? "Roof / area" : "PV array"}</h4><button className="text-xs text-faint" onClick={() => setSel(null)}>Close</button></div>
            <div className="grid grid-cols-2 gap-2">
              {k === "roof" && <>
                <Txt label="Label" value={selEl.label} onChange={(v) => upd("roofs", selEl.id, { label: v })} />
                <div><label className="label">Type</label><select className="input !h-8" value={selEl.kind} onChange={(e) => upd("roofs", selEl.id, { kind: e.target.value as any })}><option value="roof">PV roof</option><option value="area">Adjoining area</option></select></div>
                <Num label="X" value={selEl.x} onChange={(v) => upd("roofs", selEl.id, { x: v })} /><Num label="Y" value={selEl.y} onChange={(v) => upd("roofs", selEl.id, { y: v })} />
                <Num label="Width" value={selEl.w} min={100} onChange={(v) => upd("roofs", selEl.id, { w: v })} /><Num label="Length" value={selEl.h} min={100} onChange={(v) => upd("roofs", selEl.id, { h: v })} />
                <div className="col-span-2 mt-1 rounded-lg bg-[var(--sunk)] p-2.5">
                  <div className="mb-1.5 text-xs font-bold">Auto-place modules on this roof</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="label">Orientation</label><select className="input !h-8" value={orient} onChange={(e) => setOrient(e.target.value as any)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
                    <Num label="Edge clearance" value={setback} onChange={setSetback} /><Num label="Gap between modules" value={gap} step={5} onChange={setGap} /><Num label="Number of modules (0 = fill)" value={count} step={1} unit="" min={0} onChange={setCount} />
                  </div>
                  <button className="btn btn-sm btn-primary mt-2 w-full" onClick={() => autoFill(selEl)}>Place modules</button>
                </div>
              </>}
              {k === "array" && <>
                <Num label="X" value={selEl.x} onChange={(v) => upd("arrays", selEl.id, { x: v })} /><Num label="Y" value={selEl.y} onChange={(v) => upd("arrays", selEl.id, { y: v })} />
                <Num label="Rows" value={selEl.rows} step={1} unit="" min={1} onChange={(v) => upd("arrays", selEl.id, { rows: Math.max(1, Math.round(v)) })} /><Num label="Columns" value={selEl.cols} step={1} unit="" min={1} onChange={(v) => upd("arrays", selEl.id, { cols: Math.max(1, Math.round(v)) })} />
                <Num label="Module width" value={selEl.mw} step={1} onChange={(v) => upd("arrays", selEl.id, { mw: v })} /><Num label="Module height" value={selEl.mh} step={1} onChange={(v) => upd("arrays", selEl.id, { mh: v })} />
                <Num label="Gap" value={selEl.gap} step={5} onChange={(v) => upd("arrays", selEl.id, { gap: v })} />
                <button className="btn btn-sm mt-5" onClick={() => upd("arrays", selEl.id, { mw: selEl.mh, mh: selEl.mw })}>Rotate modules 90°</button>
                <label className="col-span-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={selEl.dim} onChange={(e) => upd("arrays", selEl.id, { dim: e.target.checked })} className="accent-[var(--green-600)]" /> Show size dimensions</label>
                <p className="col-span-2 text-xs text-faint">{selEl.rows * selEl.cols} modules · {Math.round(arrayBox(selEl).w)} × {Math.round(arrayBox(selEl).h)} mm</p>
              </>}
              {k === "obs" && <>
                <Txt label="Label" value={selEl.label} onChange={(v) => upd("obstacles", selEl.id, { label: v })} />
                <div><label className="label">Shape</label><select className="input !h-8" value={selEl.kind} onChange={(e) => upd("obstacles", selEl.id, { kind: e.target.value as any })}><option value="circle">Round</option><option value="rect">Box</option></select></div>
                <Num label="X" value={selEl.x} onChange={(v) => upd("obstacles", selEl.id, { x: v })} /><Num label="Y" value={selEl.y} onChange={(v) => upd("obstacles", selEl.id, { y: v })} />
                <Num label="Width" value={selEl.w} onChange={(v) => upd("obstacles", selEl.id, { w: v })} /><Num label="Length" value={selEl.h} onChange={(v) => upd("obstacles", selEl.id, { h: v })} />
              </>}
              {k === "note" && <>
                <Txt span label="Text" value={selEl.text} onChange={(v) => upd("notes", selEl.id, { text: v })} />
                <Num label="Text X" value={selEl.x} onChange={(v) => upd("notes", selEl.id, { x: v })} /><Num label="Text Y" value={selEl.y} onChange={(v) => upd("notes", selEl.id, { y: v })} />
                <Num label="Points to X" value={selEl.tx} onChange={(v) => upd("notes", selEl.id, { tx: v })} /><Num label="Points to Y" value={selEl.ty} onChange={(v) => upd("notes", selEl.id, { ty: v })} />
              </>}
              {k === "dim" && <>
                <Num label="From X" value={selEl.x1} onChange={(v) => upd("dims", selEl.id, { x1: v })} /><Num label="From Y" value={selEl.y1} onChange={(v) => upd("dims", selEl.id, { y1: v })} />
                <Num label="To X" value={selEl.x2} onChange={(v) => upd("dims", selEl.id, { x2: v })} /><Num label="To Y" value={selEl.y2} onChange={(v) => upd("dims", selEl.id, { y2: v })} />
                <Num label="Offset" value={selEl.offset} step={1} unit="mm on sheet" onChange={(v) => upd("dims", selEl.id, { offset: v })} /><Txt label="Text (blank = measured)" value={selEl.text} onChange={(v) => upd("dims", selEl.id, { text: v })} />
              </>}
            </div>
          </div>
        ) : (
          <div className="card card-b text-[13px] text-muted">Click an item on the sheet to edit its size and position, or use the toolbar to add roof sections, PV arrays, tanks and callouts. Dimensions are in millimetres.
            {d.dims.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{d.dims.map((m, i) => <button key={m.id} className="btn btn-sm" onClick={() => setSel(`dim:${m.id}`)}>Dim {i + 1}</button>)}</div>}</div>
        )}

        <div className="card">
          <div className="card-h"><h3>Sheet information</h3></div>
          <div className="card-b grid grid-cols-2 gap-2">
            <Txt span label="Drawing title" value={sheet.title} onChange={(v) => setS({ title: v })} />
            <Txt span label="Customer name" value={sheet.customer_name} onChange={(v) => setS({ customer_name: v })} />
            <Txt span label="Address" value={sheet.address} onChange={(v) => setS({ address: v })} />
            <Txt label="Co-ordinates" value={sheet.coordinates} onChange={(v) => setS({ coordinates: v })} ph="12.87, 79.93" /><Txt label="PRN number" value={sheet.prn} onChange={(v) => setS({ prn: v })} />
            <Txt label="Designed by" value={sheet.designed_by} onChange={(v) => setS({ designed_by: v })} /><Txt label="Approved by" value={sheet.approved_by} onChange={(v) => setS({ approved_by: v })} />
            <Txt label="Date" value={sheet.date} onChange={(v) => setS({ date: v })} /><Txt label="Sheet no." value={sheet.sheet_no} onChange={(v) => setS({ sheet_no: v })} />
            <div><label className="label">Paper</label><select className="input !h-8" value={sheet.paper} onChange={(e) => setS({ paper: e.target.value as any })}><option value="A4">A4</option><option value="A3">A3</option></select></div>
            <div><label className="label">Scale</label><select className="input !h-8" value={sheet.scale} onChange={(e) => setS({ scale: e.target.value as any })}><option value="NTS">Not to scale</option><option value="AUTO">Show 1 : n</option></select></div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>General system information</h3></div>
          <div className="card-b grid grid-cols-2 gap-2">
            <div><label className="label">Module</label><select className="input !h-8" value={sheet.module_wp} onChange={(e) => { const p = MODULE_PRESETS.find((m) => m.wp === Number(e.target.value)); setS({ module_wp: Number(e.target.value), ...(p ? { module_w: p.w, module_h: p.h } : {}) }); }}>{[...new Set([sheet.module_wp, ...MODULE_PRESETS.map((m) => m.wp)])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w} Wp</option>)}</select></div>
            <div />
            <Num label="Module width" value={sheet.module_w} step={1} onChange={(v) => setS({ module_w: v })} /><Num label="Module length" value={sheet.module_h} step={1} onChange={(v) => setS({ module_h: v })} />
            <Txt span label="Inverter" value={sheet.inverter_text} onChange={(v) => setS({ inverter_text: v })} ph="3000W INVERTER" />
            <Txt label="Roof type" value={sheet.roof_type} onChange={(v) => setS({ roof_type: v })} />
            <div><label className="label">Mounting type</label><select className="input !h-8" value={sheet.mounting} onChange={(e) => setS({ mounting: e.target.value })}>{[...new Set([sheet.mounting, ...MOUNTING])].map((m) => <option key={m}>{m}</option>)}</select></div>
            <Num label="North direction" value={d.north_deg} step={5} unit="° clockwise" onChange={(v) => change((x) => ({ ...x, north_deg: v }), false)} />
            <label className="flex items-center gap-2 pt-5 text-[13px]"><input type="checkbox" checked={d.show_dims} onChange={(e) => change((x) => ({ ...x, show_dims: e.target.checked }), false)} className="accent-[var(--green-600)]" /> Auto dimensions</label>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Aerial map</h3></div>
          <div className="card-b space-y-2">
            {images.length > 0 && <form action={setAerial} className="flex gap-2"><select name="path" className="input !h-8 flex-1" defaultValue=""><option value="">Choose from the site file…</option>{images.map((i) => <option key={`${i.kind}${i.id}`} value={i.path}>{i.name}</option>)}</select><button className="btn btn-sm" type="submit">Use</button></form>}
            <form action={setAerial} className="flex gap-2"><input name="file" type="file" accept="image/*" required className="input !h-auto flex-1 py-1 text-xs" /><button className="btn btn-sm" type="submit" disabled={busy === "aerial"}>Upload</button></form>
            <p className="hint">Screenshot the Google Maps satellite view of the roof and upload it — it appears in the title block with a location pin.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
