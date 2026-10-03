// Preliminary layout drawing model (all drawing coordinates in millimetres, y grows downward) + pure helpers shared by editor, sheet and server.
export interface Roof { id: string; x: number; y: number; w: number; h: number; label: string; kind: "roof" | "area" }
export interface PvArray { id: string; x: number; y: number; rows: number; cols: number; mw: number; mh: number; gap: number; dim: boolean }
export interface Obstacle { id: string; kind: "circle" | "rect"; x: number; y: number; w: number; h: number; label: string }
export interface Note { id: string; text: string; x: number; y: number; tx: number; ty: number }
export interface Dim { id: string; x1: number; y1: number; x2: number; y2: number; offset: number; text: string }
export interface Drawing { roofs: Roof[]; arrays: PvArray[]; obstacles: Obstacle[]; notes: Note[]; dims: Dim[]; north_deg: number; show_dims: boolean }
export interface Sheet {
  title: string; customer_name: string; address: string; coordinates: string; prn: string;
  designed_by: string; approved_by: string; scale: "NTS" | "AUTO"; paper: "A4" | "A3"; rev: string; date: string; sheet_no: string;
  module_wp: number; module_w: number; module_h: number; inverter_text: string; roof_type: string; mounting: string;
  company_name: string; company_address: string;
}

export const MODULE_PRESETS: { wp: number; w: number; h: number }[] = [
  { wp: 335, w: 992, h: 1956 }, { wp: 450, w: 1038, h: 2094 }, { wp: 540, w: 1134, h: 2279 }, { wp: 545, w: 1134, h: 2279 }, { wp: 550, w: 1134, h: 2384 }, { wp: 580, w: 1134, h: 2278 }, { wp: 620, w: 1134, h: 2382 },
];
export const MOUNTING = ["FLUSH MOUNT", "TILTED (ELEVATED) MOUNT", "BALLASTED MOUNT", "GROUND MOUNT", "CARPORT / SHED MOUNT"];
export const uid = () => Math.random().toString(36).slice(2, 8);
export const snap = (v: number, step = 10) => Math.round(v / step) * step;

export function presetFor(wp: number) {
  return MODULE_PRESETS.reduce((b, p) => (Math.abs(p.wp - wp) < Math.abs(b.wp - wp) ? p : b), MODULE_PRESETS[2]);
}
export function arrayBox(a: PvArray) {
  return { x: a.x, y: a.y, w: a.cols * a.mw + Math.max(0, a.cols - 1) * a.gap, h: a.rows * a.mh + Math.max(0, a.rows - 1) * a.gap };
}
export function totals(d: Drawing, wp: number) {
  const modules = d.arrays.reduce((s, a) => s + a.rows * a.cols, 0);
  const area = d.arrays.reduce((s, a) => { const b = arrayBox(a); return s + (b.w * b.h) / 1e6; }, 0);
  return { modules, kwp: Math.round(((modules * wp) / 1000) * 100) / 100, area_sqm: Math.round(area * 10) / 10 };
}
export function bounds(d: Drawing) {
  const xs: number[] = [], ys: number[] = [];
  const box = (x: number, y: number, w: number, h: number) => { xs.push(x, x + w); ys.push(y, y + h); };
  d.roofs.forEach((r) => box(r.x, r.y, r.w, r.h));
  d.arrays.forEach((a) => { const b = arrayBox(a); box(b.x, b.y, b.w, b.h); });
  d.obstacles.forEach((o) => box(o.x, o.y, o.w, o.h));
  d.notes.forEach((n) => { xs.push(n.x, n.tx); ys.push(n.y, n.ty); });
  d.dims.forEach((m) => { xs.push(m.x1, m.x2); ys.push(m.y1, m.y2); });
  if (!xs.length) return { x: 0, y: 0, w: 10000, h: 6000 };
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 };
}
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
/** Human-readable problems: arrays off the roof, overlapping each other or an obstacle. */
export function check(d: Drawing): string[] {
  const out: string[] = [];
  const roofs = d.roofs.filter((r) => r.kind === "roof");
  d.arrays.forEach((a, i) => {
    const b = arrayBox(a);
    if (roofs.length && !roofs.some((r) => inside(b, r))) out.push(`Array ${i + 1} is not fully inside a roof section`);
    d.arrays.forEach((c, j) => { if (j > i && overlap(b, arrayBox(c))) out.push(`Arrays ${i + 1} and ${j + 1} overlap`); });
    d.obstacles.forEach((o) => { if (overlap(b, o)) out.push(`Array ${i + 1} overlaps “${o.label || "obstacle"}”`); });
  });
  return out;
}

/** Fill a roof section with modules: clear edge `setback`, `count` modules max (or as many as fit). Returns up to two arrays (full rows + a partial last row). */
export function fillRoof(roof: Roof, mod: { w: number; h: number }, orient: "portrait" | "landscape", setback: number, gap: number, count?: number): PvArray[] {
  const mw = orient === "portrait" ? mod.w : mod.h, mh = orient === "portrait" ? mod.h : mod.w;
  const aw = roof.w - 2 * setback, ah = roof.h - 2 * setback;
  const maxCols = Math.floor((aw + gap) / (mw + gap)), maxRows = Math.floor((ah + gap) / (mh + gap));
  if (maxCols < 1 || maxRows < 1) return [];
  const total = Math.min(count && count > 0 ? count : Infinity, maxCols * maxRows);
  const cols = Math.min(maxCols, total), fullRows = Math.floor(total / cols), rest = total - fullRows * cols;
  const out: PvArray[] = [];
  const x0 = roof.x + setback, y0 = roof.y + setback;
  if (fullRows > 0) out.push({ id: uid(), x: x0, y: y0, rows: fullRows, cols, mw, mh, gap, dim: true });
  if (rest > 0) out.push({ id: uid(), x: x0, y: y0 + fullRows * (mh + gap), rows: 1, cols: rest, mw, mh, gap, dim: false });
  return out;
}

export function defaultDrawing(o: { roofW?: number; roofH?: number; roofType?: string; wp?: number; modules?: number } = {}): { drawing: Drawing; sheet_mod: { w: number; h: number } } {
  const roofW = o.roofW || 8000, roofH = o.roofH || 5000;
  const p = presetFor(o.wp ?? 545);
  const roof: Roof = { id: uid(), x: 0, y: 0, w: roofW, h: roofH, label: `${(o.roofType || "ROOF").toUpperCase()}`, kind: "roof" };
  const arrays = o.modules ? fillRoof(roof, p, "portrait", 600, 20, o.modules) : [];
  const notes: Note[] = [];
  if (arrays[0]) { const b = arrayBox(arrays[0]); notes.push({ id: uid(), text: "(N) PHOTOVOLTAIC ARRAY ON ROOF", x: b.x + b.w * 0.4, y: roofH + 1800, tx: b.x + b.w * 0.5, ty: b.y + b.h }); }
  notes.push({ id: uid(), text: `${roof.label}`, x: roofW * 0.85, y: roofH + 1800, tx: roofW * 0.9, ty: roofH });
  return { drawing: { roofs: [roof], arrays, obstacles: [], notes, dims: [], north_deg: 0, show_dims: true }, sheet_mod: { w: p.w, h: p.h } };
}
