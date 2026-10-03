import { arrayBox, bounds, totals, type Drawing, type Sheet } from "@/lib/layout-geom";

const PAPER = { A4: { W: 297, H: 210 }, A3: { W: 420, H: 297 } } as const;

/** Where the drawing lands on the sheet (paper mm) — shared by the sheet renderer and the editor's drag maths. */
export function sheetGeometry(sheet: Sheet, d: Drawing) {
  const { W, H } = PAPER[sheet.paper] ?? PAPER.A4;
  const u = W / 297;
  const titleH = 40 * u, titleTop = H - 5 * u - titleH;
  const area = { x: 10 * u, y: 46 * u, w: W - 20 * u, h: titleTop - 46 * u - 6 * u };
  const b = bounds(d);
  const padX = 16 * u, padTop = 17 * u, padBottom = 9 * u;
  const s = Math.min((area.w - 2 * padX) / b.w, (area.h - padTop - padBottom) / b.h);
  const ox = area.x + (area.w - b.w * s) / 2 - b.x * s, oy = area.y + padTop + (area.h - padTop - padBottom - b.h * s) / 2 - b.y * s;
  const scaleLabel = sheet.scale === "AUTO" ? `1:${Math.max(1, Math.round(1 / s)).toString()}` : "NTS";
  return { W, H, u, titleH, titleTop, area, s, ox, oy, scaleLabel };
}

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) { if ((line + " " + w).trim().length > maxChars && line) { out.push(line); line = w; } else line = (line + " " + w).trim(); }
  if (line) out.push(line);
  return out;
}

function Dim({ x1, y1, x2, y2, off, text, u }: { x1: number; y1: number; x2: number; y2: number; off: number; text: string; u: number }) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // unit normal
  const ax = x1 + nx * off, ay = y1 + ny * off, bx = x2 + nx * off, by = y2 + ny * off;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const flip = ang > 90 || ang < -90;
  const mx = (ax + bx) / 2 + nx * 1.6 * u, my = (ay + by) / 2 + ny * 1.6 * u;
  const tick = 1.1 * u;
  const ext = (px: number, py: number, qx: number, qy: number) => <line x1={px + nx * Math.sign(off) * 0.8 * u} y1={py + ny * Math.sign(off) * 0.8 * u} x2={qx + nx * Math.sign(off) * 1.2 * u} y2={qy + ny * Math.sign(off) * 1.2 * u} />;
  return (
    <g stroke="#111" strokeWidth={0.18 * u} fill="none">
      {ext(x1, y1, ax, ay)}{ext(x2, y2, bx, by)}
      <line x1={ax} y1={ay} x2={bx} y2={by} />
      {[[ax, ay], [bx, by]].map(([px, py], i) => <line key={i} x1={px - tick * 0.7} y1={py + tick * 0.7} x2={px + tick * 0.7} y2={py - tick * 0.7} strokeWidth={0.3 * u} transform={`rotate(${ang} ${px} ${py})`} />)}
      <text x={mx} y={my} fontSize={2.3 * u} fill="#111" stroke="none" textAnchor="middle" transform={`rotate(${flip ? ang + 180 : ang} ${mx} ${my})`}>{text}</text>
    </g>);
}

export function titleBlockColumns(geo: ReturnType<typeof sheetGeometry>) {
  const { W, u } = geo;
  const bx = 5 * u, bw = W - 10 * u;
  const cols = [50, 80, 55, 70, 32].map((c) => (c * u * bw) / (287 * u));
  const cx: number[] = []; cols.reduce((a, c, i) => { cx[i] = a; return a + c; }, bx);
  return { bx, bw, cols, cx };
}

export function LayoutSheet({ sheet, drawing, aerial, logo = "/brand/logo.png", selectedId, onPick, svgRef, onPointerDown, onPointerMove, onPointerUp }: {
  sheet: Sheet; drawing: Drawing; aerial?: string | null; logo?: string; selectedId?: string | null; onPick?: (id: string | null, e?: React.PointerEvent) => void;
  svgRef?: React.Ref<SVGSVGElement>; onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void; onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void; onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void;
}) {
  const g = sheetGeometry(sheet, drawing);
  const { W, H, u, titleH, titleTop, s, ox, oy } = g;
  const X = (x: number) => ox + x * s, Y = (y: number) => oy + y * s;
  const t = totals(drawing, sheet.module_wp);
  const sel = (id: string) => selectedId === id;
  const hi = (id: string) => (sel(id) ? "#ff8a00" : undefined);
  const pick = (id: string) => (onPick ? (e: React.PointerEvent) => { e.stopPropagation(); onPick(id, e); } : undefined);

  // title block columns (paper units), inside a 5u border
  const { bx, bw, cols, cx } = titleBlockColumns(g);
  const mods = t.modules;
  const info = [
    ["MODULES:", `(${mods}) PV MODULES (${sheet.module_wp}W)`],
    ["INVERTER:", sheet.inverter_text || "—"],
    ["ROOF TYPE:", sheet.roof_type || "—"],
    ["MOUNTING TYPE:", sheet.mounting || "—"],
  ];

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full bg-white" style={{ fontFamily: "Manrope, Arial, sans-serif", touchAction: "none" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={onPick ? () => onPick(null) : undefined}>
      <rect x="0" y="0" width={W} height={H} fill="#fff" />
      <rect x={5 * u} y={5 * u} width={W - 10 * u} height={H - 10 * u} fill="none" stroke="#111" strokeWidth={0.5 * u} />

      {/* title */}
      <text x={W / 2} y={16 * u} fontSize={6 * u} fontWeight="800" textAnchor="middle" textDecoration="underline" fill="#111">{sheet.title}</text>

      {/* general system information */}
      <g>
        <rect x={W - 5 * u - 84 * u} y={5 * u} width={84 * u} height={36 * u} fill="#fff" stroke="#111" strokeWidth={0.4 * u} />
        <text x={W - 5 * u - 82 * u} y={11 * u} fontSize={2.6 * u} fontWeight="700" fill="#111">GENERAL SYSTEM INFORMATION:</text>
        {info.map(([k, v], i) => <text key={k} x={W - 5 * u - 82 * u} y={(17 + i * 6) * u} fontSize={2.6 * u} fill="#111"><tspan fontWeight="800">{k}</tspan><tspan> {v}</tspan></text>)}
      </g>

      {/* drawing */}
      <g>
        {drawing.roofs.map((r) => (
          <g key={r.id} onPointerDown={pick(`roof:${r.id}`)} style={{ cursor: onPick ? "move" : undefined }}>
            <rect x={X(r.x)} y={Y(r.y)} width={r.w * s} height={r.h * s} fill={r.kind === "roof" ? "#fff" : "#fafafa"} stroke={hi(`roof:${r.id}`) ?? (r.kind === "roof" ? "#111" : "#555")} strokeWidth={(sel(`roof:${r.id}`) ? 0.7 : r.kind === "roof" ? 0.45 : 0.25) * u} />
            {r.kind === "area" && r.label && <text x={X(r.x + r.w / 2)} y={Y(r.y + r.h / 2)} fontSize={2.2 * u} fill="#777" textAnchor="middle">{r.label}</text>}
          </g>))}
        {drawing.arrays.map((a) => {
          const b = arrayBox(a), id = `array:${a.id}`;
          return (
            <g key={a.id} onPointerDown={pick(id)} style={{ cursor: onPick ? "move" : undefined }}>
              {Array.from({ length: a.rows }).flatMap((_, r) => Array.from({ length: a.cols }).map((__, c) => (
                <rect key={`${r}-${c}`} x={X(a.x + c * (a.mw + a.gap))} y={Y(a.y + r * (a.mh + a.gap))} width={a.mw * s} height={a.mh * s} fill="#eaf1ff" stroke={hi(id) ?? "#0a2bd6"} strokeWidth={0.28 * u} />)))}
              <rect x={X(b.x)} y={Y(b.y)} width={b.w * s} height={b.h * s} fill="none" stroke={hi(id) ?? "#0a2bd6"} strokeWidth={0.55 * u} />
            </g>);
        })}
        {drawing.obstacles.map((o) => {
          const id = `obs:${o.id}`;
          return (
            <g key={o.id} onPointerDown={pick(id)} style={{ cursor: onPick ? "move" : undefined }}>
              {o.kind === "circle"
                ? <ellipse cx={X(o.x + o.w / 2)} cy={Y(o.y + o.h / 2)} rx={(o.w / 2) * s} ry={(o.h / 2) * s} fill="#fff8ee" stroke={hi(id) ?? "#f28c00"} strokeWidth={0.4 * u} />
                : <rect x={X(o.x)} y={Y(o.y)} width={o.w * s} height={o.h * s} fill="#f3f3f3" stroke={hi(id) ?? "#666"} strokeWidth={0.35 * u} />}
              {o.label && <text x={X(o.x + o.w / 2)} y={Y(o.y + o.h / 2) + 0.8 * u} fontSize={2 * u} fill="#555" textAnchor="middle">{o.label}</text>}
            </g>);
        })}

        {/* auto dimensions */}
        {drawing.show_dims && (
          <>
            {drawing.roofs.filter((r) => r.kind === "roof").map((r) => (
              <g key={`d${r.id}`}>
                <Dim x1={X(r.x)} y1={Y(r.y)} x2={X(r.x + r.w)} y2={Y(r.y)} off={-13 * u} text={String(Math.round(r.w))} u={u} />
                <Dim x1={X(r.x)} y1={Y(r.y)} x2={X(r.x)} y2={Y(r.y + r.h)} off={13 * u} text={String(Math.round(r.h))} u={u} />
              </g>))}
            {drawing.arrays.filter((a) => a.dim).map((a) => { const b = arrayBox(a); return (
              <g key={`da${a.id}`}>
                <Dim x1={X(b.x)} y1={Y(b.y)} x2={X(b.x + b.w)} y2={Y(b.y)} off={-6 * u} text={String(Math.round(b.w))} u={u} />
                <Dim x1={X(b.x)} y1={Y(b.y + b.h)} x2={X(b.x)} y2={Y(b.y)} off={-6 * u} text={String(Math.round(b.h))} u={u} />
              </g>); })}
          </>)}
        {drawing.dims.map((m) => <Dim key={m.id} x1={X(m.x1)} y1={Y(m.y1)} x2={X(m.x2)} y2={Y(m.y2)} off={m.offset * u} text={m.text || String(Math.round(Math.hypot(m.x2 - m.x1, m.y2 - m.y1)))} u={u} />)}

        {/* callouts */}
        {drawing.notes.map((n) => {
          const id = `note:${n.id}`;
          return (
            <g key={n.id} onPointerDown={pick(id)} style={{ cursor: onPick ? "move" : undefined }}>
              <polyline points={`${X(n.tx)},${Y(n.ty)} ${X(n.x)},${Y(n.y)} ${X(n.x) + 22 * u},${Y(n.y)}`} fill="none" stroke={hi(id) ?? "#111"} strokeWidth={0.2 * u} />
              <text x={X(n.x) + 22 * u + 1.5 * u} y={Y(n.y) + 0.9 * u} fontSize={2.4 * u} fill={hi(id) ?? "#111"}>{n.text}</text>
              <circle cx={X(n.tx)} cy={Y(n.ty)} r={0.7 * u} fill={hi(id) ?? "#111"} />
            </g>);
        })}
      </g>

      {/* north arrow */}
      <g transform={`translate(${16 * u} ${titleTop - 14 * u}) rotate(${drawing.north_deg})`}>
        <circle r={6 * u} fill="#fff" stroke="#111" strokeWidth={0.3 * u} />
        <path d={`M0 ${-9 * u} L${2.6 * u} ${-2 * u} L0 ${-3.2 * u} L${-2.6 * u} ${-2 * u} Z`} fill="#111" />
        <text y={4.2 * u} fontSize={3.2 * u} fontWeight="800" textAnchor="middle" fill="#111" transform={`rotate(${-drawing.north_deg} 0 ${4 * u})`}>N</text>
      </g>

      {/* title block */}
      <g stroke="#111" strokeWidth={0.35 * u} fill="none">
        <line x1={bx} y1={titleTop} x2={bx + bw} y2={titleTop} />
        {cx.slice(1).map((x, i) => <line key={i} x1={x} y1={titleTop} x2={x} y2={titleTop + titleH} />)}
      </g>
      {/* aerial map */}
      <g>
        <text x={cx[0] + cols[0] - 2 * u} y={titleTop + 3.6 * u} fontSize={2.6 * u} fontWeight="800" textAnchor="end" fill="#111">AERIAL MAP</text>
        {aerial ? <><image href={aerial} x={cx[0] + 1 * u} y={titleTop + 6 * u} width={cols[0] - 2 * u} height={titleH - 8 * u} preserveAspectRatio="xMidYMid slice" /><circle cx={cx[0] + cols[0] / 2} cy={titleTop + 6 * u + (titleH - 8 * u) / 2} r={1.3 * u} fill="#e11d1d" stroke="#fff" strokeWidth={0.3 * u} /></>
          : <text x={cx[0] + cols[0] / 2} y={titleTop + titleH / 2 + 3 * u} fontSize={2.4 * u} textAnchor="middle" fill="#999">Add an aerial image</text>}
      </g>
      {/* customer info */}
      <g fontSize={2.5 * u} fill="#111">
        <text x={cx[1] + 2 * u} y={titleTop + 5 * u} fontSize={3 * u} fontWeight="800">CUSTOMER INFORMATION</text>
        <text x={cx[1] + 2 * u} y={titleTop + 11 * u}><tspan fontWeight="700">NAME: </tspan>{sheet.customer_name.toUpperCase()}</text>
        {(() => {
          const fs = 2.4 * u, max = Math.floor((cols[1] - 4 * u) / (fs * 0.64));
          const rows: { k: string; v: string }[] = [{ k: "ADDRESS:", v: sheet.address.toUpperCase() }, ...(sheet.coordinates ? [{ k: "CO-ORDINATES:", v: sheet.coordinates }] : []), ...(sheet.prn ? [{ k: "PRN NUMBER:", v: sheet.prn }] : [])];
          let y = titleTop + 16 * u;
          return rows.map((r) => { const lines = wrap(`${r.k} ${r.v}`, max); const el = (
            <text key={r.k} x={cx[1] + 2 * u} y={y} fontSize={fs} fill="#111">{lines.map((ln, i) => <tspan key={i} x={cx[1] + 2 * u} dy={i === 0 ? 0 : fs * 1.3}>{i === 0 ? <><tspan fontWeight="700">{r.k}</tspan>{ln.slice(r.k.length)}</> : ln}</tspan>)}</text>); y += lines.length * fs * 1.3 + 1.2 * u; return el; });
        })()}
      </g>
      {/* company */}
      <g>
        <image href={logo} x={cx[2] + 3 * u} y={titleTop + 3 * u} width={cols[2] - 6 * u} height={12 * u} preserveAspectRatio="xMidYMid meet" />
        {(() => {
          const fs = 2.2 * u, max = Math.floor((cols[2] - 4 * u) / (fs * 0.64));
          const lines = [sheet.company_name, ...wrap(sheet.company_address, max)];
          return <text x={cx[2] + cols[2] / 2} y={titleTop + 19 * u} fontSize={fs} textAnchor="middle" fill="#111">{lines.map((ln, i) => <tspan key={i} x={cx[2] + cols[2] / 2} dy={i === 0 ? 0 : fs * 1.3} fontWeight={i === 0 ? 700 : 400}>{ln}</tspan>)}</text>;
        })()}
      </g>
      {/* drawing details */}
      <g fontSize={2.5 * u} fill="#111">
        <text x={cx[3] + 2 * u} y={titleTop + 6 * u} fontSize={3.2 * u} fontWeight="800">{sheet.title.replace("LAYOUT", "").trim()}</text>
        {[["DESIGNED BY", sheet.designed_by], ["APPROVED BY", sheet.approved_by], ["SCALE", g.scaleLabel], ["PAPER SIZE", sheet.paper === "A3" ? "297 X 420" : "210 X 297"], ["DATE", sheet.date]].map(([k, v], i) => (
          <text key={k} x={cx[3] + 2 * u} y={titleTop + (13 + i * 5.6) * u}><tspan fontWeight="700">{k}: </tspan>{String(v).toUpperCase()}</text>))}
      </g>
      {/* sheet number */}
      <g>
        <text x={cx[4] + cols[4] / 2} y={titleTop + 8 * u} fontSize={2.5 * u} textAnchor="middle" fill="#111">REV: <tspan fontWeight="800">{sheet.rev}</tspan></text>
        <text x={cx[4] + cols[4] / 2} y={titleTop + titleH - 9 * u} fontSize={2.2 * u} textAnchor="middle" fill="#555">SHEET</text>
        <text x={cx[4] + cols[4] / 2} y={titleTop + titleH - 3 * u} fontSize={5 * u} fontWeight="800" textAnchor="middle" fill="#111">{sheet.sheet_no}</text>
      </g>
    </svg>
  );
}
