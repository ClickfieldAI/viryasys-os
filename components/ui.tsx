// Server-safe design-system primitives.
import Link from "next/link";
import type { ReactNode } from "react";
import { label } from "@/lib/config";

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  users: "M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20M11 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 20v-1a3 3 0 0 0-2-2.8M16 5.2a3.5 3.5 0 0 1 0 6.6",
  funnel: "M3 5h18l-7 8v6l-4 2v-8z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  cube: "M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10",
  truck: "M1 5h13v11H1zM14 9h4l4 4v3h-8zM6 19.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM18 19.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  shield: "M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5 10 17.5 19 7",
  x: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  alert: "M12 3 2 20h20zM12 10v4M12 17h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  map: "M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  tool: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  inbox: "M3 13h5l1.5 3h5L16 13h5M3 13l3-8h12l3 8v6H3z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  chevron: "M6 9l6 6 6-6",
  refresh: "M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  printer: "M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5",
  lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z",
  clipboard: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6M9 14l2 2 4-4",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  panel: "M3 8l3-4h12l3 4M3 8v9h18V8M3 8h18M9 8v9M15 8v9M3 12.5h18",
  dots: "M12 6h.01M12 12h.01M12 18h.01",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3",
};

export function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ICONS.list} />
    </svg>
  );
}

export function PageHeader({ title, sub, actions, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && (
          <div className="mb-1 flex items-center gap-1.5 text-xs text-faint">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {c.href ? <Link href={c.href} className="hover:text-ink">{c.label}</Link> : c.label}
                {i < crumbs.length - 1 && <span>/</span>}
              </span>
            ))}
          </div>
        )}
        <h1 className="truncate text-[22px] font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", flush = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-h">
          <h3>{title}</h3>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "card-b"}>{children}</div>
    </section>
  );
}

const KPI_ICON: [RegExp, string, string][] = [
  [/lead|enquir/i, "funnel", "tile-blue"], [/proposal|quote/i, "file", "tile-purple"], [/project|install|capacity/i, "sun", "tile-green"],
  [/revenue|collect|payment|invoice|outstanding|cash|pipeline|value|receiv/i, "wallet", "tile-amber"], [/procure|order|po\b|deliver|material|stock/i, "truck", "tile-teal"],
  [/task|survey|design|milestone|follow/i, "clipboard", "tile-blue"], [/delay|risk|overdue|breach|exception/i, "bell", "tile-red"],
];
export function kpiIcon(label: string, i = 0) {
  const m = KPI_ICON.find(([r]) => r.test(label));
  return m ? { icon: m[1], tile: m[2] } : { icon: (["chart", "grid", "layers", "bolt"] as const)[i % 4], tile: ["tile-green", "tile-blue", "tile-amber", "tile-purple"][i % 4] };
}

export function KpiCard({ label: l, value, sub, href, tone, icon, tile, delta }: { label: string; value: string; sub?: string; href: string; tone?: "warn" | "bad" | "good"; icon?: string; tile?: string; delta?: number | null }) {
  const c = tone === "bad" ? "text-[var(--red)]" : tone === "warn" ? "text-[var(--orange)]" : tone === "good" ? "text-[var(--green-700)]" : "";
  const ic = icon ? { icon, tile: tile ?? "tile-green" } : kpiIcon(l);
  return (
    <Link href={href} className="kpi card">
      <div className="flex items-start gap-3">
        <span className={`ic-tile ${ic.tile}`}><Icon name={ic.icon} size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-muted">{l}</div>
          <div className={`v num ${c}`}>{value}</div>
          {(sub || delta != null) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-faint">
              {delta != null && <span className={delta >= 0 ? "delta-up" : "delta-down"}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span>}
              {sub && <span className="truncate">{sub}</span>}
            </div>)}
        </div>
      </div>
    </Link>
  );
}

/** Smooth area chart (server-rendered SVG). */
export function AreaChart({ rows, height = 200, color = "#32c36c", fmt = (n: number) => String(n) }: { rows: { label: string; value: number }[]; height?: number; color?: string; fmt?: (n: number) => string }) {
  const W = 900, H = height, pl = 14, pr = 14, pt = 14, pb = 28;
  const max = Math.max(1, ...rows.map((r) => r.value)) * 1.15;
  const x = (i: number) => pl + (rows.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (rows.length - 1));
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const pts = rows.map((r, i) => [x(i), y(r.value)] as const);
  let d = pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  for (let i = 1; i < pts.length; i++) { const cx = (pts[i - 1][0] + pts[i][0]) / 2; d += ` C${cx},${pts[i - 1][1]} ${cx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`; }
  const area = pts.length ? `${d} L${pts[pts.length - 1][0]},${H - pb} L${pts[0][0]},${H - pb} Z` : "";
  const id = `ag${Math.abs(color.length * 7 + rows.length)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={rows.map((r) => `${r.label}: ${fmt(r.value)}`).join(", ")}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {[0, .25, .5, .75, 1].map((t) => <line key={t} x1={pl} x2={W - pr} y1={pt + t * (H - pt - pb)} y2={pt + t * (H - pt - pb)} stroke="#e8efeb" strokeDasharray="3 4" />)}
      <path d={area} fill={`url(#${id})`} /><path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {pts.map(([px, py], i) => <g key={i}><circle cx={px} cy={py} r="4" fill="#fff" stroke={color} strokeWidth="2.5" /><title>{`${rows[i].label}: ${fmt(rows[i].value)}`}</title><text x={px} y={H - 8} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} fontSize="12" fill="#8a9a92">{rows[i].label}</text></g>)}
    </svg>
  );
}

/** Donut with centre total and legend. */
export function Donut({ parts, centre, sub }: { parts: { label: string; value: number; color: string }[]; centre?: string; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] shrink-0 -rotate-90" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef3f0" strokeWidth="16" />
        {parts.map((p) => { const len = (p.value / total) * C; const el = <circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} />; off += len; return el; })}
        <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}><text x="70" y="70" textAnchor="middle" fontSize="24" fontWeight="800" fill="#12261b">{centre ?? total}</text><text x="70" y="88" textAnchor="middle" fontSize="10" fill="#8a9a92">{sub}</text></g>
      </svg>
      <ul className="min-w-[140px] flex-1 space-y-2 text-[13px]">
        {parts.map((p) => <li key={p.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} /><span className="flex-1 text-muted">{p.label}</span><b className="num">{p.value}</b><span className="w-10 text-right text-xs text-faint">{Math.round((p.value / total) * 100)}%</span></li>)}
      </ul>
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "b-green", red: "b-red", orange: "b-orange", blue: "b-blue", solar: "b-solar", navy: "b-navy", gray: "",
};
const STATUS_TONE: Record<string, string> = {
  NEW: "blue", CONTACTED: "blue", QUALIFIED: "navy", SITE_VISIT: "navy", SITE_SURVEY: "navy", DESIGN: "navy", PROPOSAL: "solar", NEGOTIATION: "orange", WON: "green", LOST: "red", ON_HOLD: "gray", DISQUALIFIED: "gray",
  ON_TRACK: "green", AT_RISK: "orange", DELAYED: "red", BLOCKED: "red", COMPLETED: "green", delayed: "red", overdue: "red",
  DRAFT: "gray", APPROVED: "green", SENT: "blue", ACCEPTED: "green", REJECTED: "red", INVOICE_DRAFT: "gray", INVOICED: "blue", PENDING: "gray", PAID: "green", PARTIAL: "orange",
  CONFIRMED: "blue", ORDERED: "blue", PARTIALLY_RECEIVED: "orange", RECEIVED: "green", CANCELLED: "gray", INSPECTED: "blue", DAMAGED: "red",
  OPEN: "blue", IN_PROGRESS: "orange", WAITING: "gray", RESOLVED: "green", CLOSED: "gray", SCHEDULED: "blue",
  IN_PROGRESS_: "orange", READY: "green", REVIEW: "orange", LEAD_CREATED: "green", IGNORED: "gray", NOT_A_LEAD: "gray",
  met: "green", breached: "red", running: "orange", hot: "red", warm: "orange", cold: "blue", high: "red", medium: "orange", low: "gray",
  CURRENT: "orange", DONE: "green", UPCOMING: "gray", SUBMITTED: "green",
  PENDING_APPROVAL: "orange", AWAITING_APPROVAL: "orange", AWAITING_CONFIRMATION: "orange", VENDOR_CONFIRMED: "green", PARTIALLY_CONFIRMED: "orange", IN_TRANSIT: "blue", PLANNED: "gray", READY_FOR_DISPATCH: "blue",
  ACKNOWLEDGED: "green", PARTIALLY_ACCEPTED: "orange", SHORTAGE: "red", NOT_ORDERED: "gray", REQUESTED: "blue", WITHIN_BUDGET: "green", OVER_BUDGET: "red", NOT_STARTED: "gray",
  LOW: "gray", MEDIUM: "orange", HIGH: "red", CRITICAL: "red", GOOD: "green", FAIR: "orange", POOR: "red", SYNCED: "green", FAILED: "red", PROCESSING: "blue", RETRYING: "orange", critical: "red",
  NORMAL: "gray", URGENT: "orange", ISSUED: "navy", CONVERTED: "green", AUTHORIZED: "green", LOCKED: "red",
};
export function StatusBadge({ status, tone, children }: { status?: string | null; tone?: keyof typeof TONES; children?: ReactNode }) {
  if (!status) return <span className="text-faint">—</span>;
  const t = tone ?? STATUS_TONE[status] ?? "gray";
  return (
    <span className={`badge ${TONES[t] ?? ""}`}>
      <i />
      {children ?? label(status)}
    </span>
  );
}

export function EmptyState({ title, body, action, icon = "inbox" }: { title: string; body?: string; action?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--green-50)] text-[var(--green-700)]"><Icon name={icon} size={18} /></div>
      <div className="font-bold">{title}</div>
      {body && <p className="mt-1 max-w-sm text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone }: { value: number; tone?: "warn" | "bad" }) {
  const bg = tone === "bad" ? "var(--red)" : tone === "warn" ? "var(--solar-600)" : undefined;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: bg }} />
    </div>
  );
}

export function Field({ label: l, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{l}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, base }: { tabs: { key: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`} scroll={false}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${active === t.key ? "border-[var(--green-500)] text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-[#eef1f4] px-1.5 text-[11px] text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, total, href }: { page: number; pages: number; total: number; href: (p: number) => string }) {
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
      <span>{total} record{total === 1 ? "" : "s"}</span>
      <div className="flex items-center gap-2">
        <span>Page {page} of {pages}</span>
        {page > 1 ? <Link className="btn btn-sm" href={href(page - 1)}>Previous</Link> : <span className="btn btn-sm opacity-40">Previous</span>}
        {page < pages ? <Link className="btn btn-sm" href={href(page + 1)}>Next</Link> : <span className="btn btn-sm opacity-40">Next</span>}
      </div>
    </div>
  );
}

/** Vertical timeline of dated events. */
export function Timeline({ items }: { items: { title: ReactNode; sub?: ReactNode; at?: string; tone?: "green" | "red" | "gray" | "solar" }[] }) {
  return (
    <ol className="relative ml-2 border-l border-line">
      {items.map((it, i) => (
        <li key={i} className="relative pb-4 pl-5 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: it.tone === "green" ? "var(--green-500)" : it.tone === "red" ? "var(--red)" : it.tone === "solar" ? "var(--solar-600)" : "var(--line-strong)" }} />
          <div className="text-[13px] font-semibold">{it.title}</div>
          {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
          {it.at && <div className="text-[11px] text-faint">{it.at}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Horizontal lifecycle track: completed ✓, current ●, upcoming ○ (project & lead timelines). */
export function Track({ steps }: { steps: { label: string; state: "done" | "current" | "todo" | "late" }[] }) {
  return (
    <div className="flex items-start overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={i} className="flex min-w-[84px] flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : s.state === "todo" ? "bg-line" : "bg-[var(--green-500)]"}`} />
            <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[10px] font-bold ${s.state === "done" ? "border-[var(--green-500)] bg-[var(--green-500)] text-white" : s.state === "current" ? "border-[var(--green-500)] bg-white text-[var(--green-700)]" : s.state === "late" ? "border-[var(--red)] bg-white text-[var(--red)]" : "border-line bg-white text-faint"}`}>
              {s.state === "done" ? <Icon name="check" size={12} /> : s.state === "current" ? <span className="live-dot" /> : s.state === "late" ? "!" : ""}
            </div>
            <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? "opacity-0" : s.state === "done" ? "bg-[var(--green-500)]" : "bg-line"}`} />
          </div>
          <div className={`mt-1.5 px-1 text-[11px] leading-tight ${s.state === "todo" ? "text-faint" : s.state === "late" ? "font-bold text-[var(--red)]" : "font-semibold"}`}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function BarList({ rows, color = "var(--green-500)", fmt = (n: number) => String(n) }: { rows: { label: string; value: number; sub?: string }[]; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate text-muted">{r.label}</span>
          <div className="h-2 rounded-full bg-[#eef1f4]"><div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color, minWidth: r.value ? 4 : 0 }} /></div>
          <span className="num min-w-8 text-right font-semibold">{fmt(r.value)}{r.sub && <span className="ml-1 font-normal text-faint">{r.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) { return <div className={`skeleton ${className}`} />; }
export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[84px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
    </div>
  );
}

/** Vertical bar chart (server-rendered, no library). */
export function MiniBars({ rows, height = 120, color = "var(--green-500)", fmt = (n: number) => String(n) }: { rows: { label: string; value: number }[]; height?: number; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height }} role="img" aria-label={rows.map((r) => `${r.label}: ${fmt(r.value)}`).join(", ")}>
        {rows.map((r, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${r.label}: ${fmt(r.value)}`}>
            <span className="text-[10.5px] font-semibold text-muted num">{r.value ? fmt(r.value) : ""}</span>
            <div className="w-full rounded-t" style={{ height: `${Math.max(r.value ? 4 : 1, (r.value / max) * (height - 22))}px`, background: i === rows.length - 1 ? color : "color-mix(in srgb, " + color + " 45%, white)" }} />
          </div>))}
      </div>
      <div className="mt-1 flex gap-2">{rows.map((r, i) => <div key={i} className="flex-1 text-center text-[10.5px] text-faint">{r.label}</div>)}</div>
    </div>
  );
}

/** Horizontal stacked bar with a legend. */
export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[#e6ebef]">{parts.map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />)}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{parts.map((p) => <span key={p.label} className="flex items-center gap-1.5 text-muted"><i className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.label} <b className="num text-ink">{p.value}</b></span>)}</div>
    </div>
  );
}

/** Compact stat tile with optional delta. */
export function StatTile({ label: l, value, sub, delta, tone, href }: { label: string; value: string; sub?: string; delta?: number | null; tone?: "good" | "bad" | "warn"; href?: string }) {
  const c = tone === "bad" ? "text-[var(--red)]" : tone === "warn" ? "text-[var(--orange)]" : tone === "good" ? "text-[var(--green-700)]" : "";
  const body = (
    <>
      <div className="eyebrow">{l}</div>
      <div className={`mt-1 text-[22px] font-extrabold leading-tight num ${c}`}>{value}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
        {delta != null && <span className={`font-bold ${delta >= 0 ? "text-[var(--green-700)]" : "text-[var(--red)]"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span>}
        {sub && <span>{sub}</span>}
      </div>
    </>
  );
  return href ? <Link href={href} className="card block p-3.5 transition-colors hover:border-[var(--green-500)]">{body}</Link> : <div className="card p-3.5">{body}</div>;
}
