// Server-safe procurement components.
import Link from "next/link";
import { Card, Icon, StatusBadge, ProgressBar, EmptyState } from "./ui";
import { inr, inrShort, fmtDate, fmtKw } from "@/lib/util";
import { label } from "@/lib/config";
import type { ProjectProc, Risk } from "@/lib/services/proc/intel";

export function ProcurementHealth({ h }: { h: { total: number; onTrack: number; atRisk: number; delayed: number; pct: number; pctRisk: number; pctDelayed: number } }) {
  const tone = h.pct >= 85 ? "var(--green-600)" : h.pct >= 65 ? "var(--solar-600)" : "var(--red)";
  return (
    <Card title="Procurement health" actions={<span className="text-xs text-faint">{h.total} live line item{h.total === 1 ? "" : "s"}</span>}>
      <div className="flex items-end gap-3">
        <div className="text-[34px] font-extrabold leading-none num" style={{ color: tone }}>{h.pct}%</div>
        <div className="pb-1 text-[13px] font-semibold text-muted">on track</div>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[#e6ebef]" role="img" aria-label={`${h.pct}% on track, ${h.pctRisk}% at risk, ${h.pctDelayed}% delayed`}>
        <div style={{ width: `${h.pct}%`, background: "var(--green-500)" }} />
        <div style={{ width: `${h.pctRisk}%`, background: "var(--solar)" }} />
        <div style={{ width: `${h.pctDelayed}%`, background: "var(--red)" }} />
      </div>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        {([["On track", h.pct, h.onTrack, "var(--green-500)"], ["At risk", h.pctRisk, h.atRisk, "var(--solar-600)"], ["Delayed", h.pctDelayed, h.delayed, "var(--red)"]] as [string, number, number, string][]).map(([l, p, c, col]) => (
          <div key={l} className="flex items-center justify-between"><dt className="flex items-center gap-2 text-muted"><i className="h-2 w-2 rounded-full" style={{ background: col }} />{l}</dt><dd className="num font-semibold">{p}% <span className="font-normal text-faint">· {c}</span></dd></div>))}
      </dl>
      <p className="hint mt-2">Derived from every open PO line: delayed = promised date passed; at risk = unconfirmed &gt;12h, promise later than needed, or needed within 2 days.</p>
    </Card>
  );
}

export const RiskBadge = ({ risk }: { risk: Risk | string }) => <StatusBadge status={String(risk).toUpperCase()}>{label(String(risk))}</StatusBadge>;

export function ProjectProcRow({ p }: { p: ProjectProc }) {
  return (
    <Link href={`/procurement/plans/${p.project_id}`} className="row-link block border-b border-line px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold">{p.customer} <span className="font-normal text-muted">· {fmtKw(p.capacity_kw)}</span></div>
          <div className="text-xs text-faint num">{p.code}</div>
        </div>
        <StatusBadge status={p.health} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-5">
        <div className="col-span-2 sm:col-span-1"><div className="mb-1 flex justify-between text-faint"><span>Procurement</span><b className="num text-ink">{p.pct}%</b></div><ProgressBar value={p.pct} tone={p.health === "DELAYED" ? "bad" : p.health === "AT_RISK" ? "warn" : undefined} /></div>
        <div><div className="text-faint">PO value</div><b className="num">{inrShort(p.poValue)}</b></div>
        <div><div className="text-faint">Received</div><b className="num">{inrShort(p.receivedValue)}</b></div>
        <div><div className="text-faint">Pending</div><b className="num">{inrShort(p.pendingValue)}</b></div>
        <div><div className="text-faint">Next delivery</div><b>{p.nextDelivery ? fmtDate(p.nextDelivery).replace(/ \d{4}$/, "") : "—"}</b>{p.delayedItems > 0 && <span className="ml-1 font-bold text-[var(--red)]">· {p.delayedItems} delayed</span>}</div>
      </div>
    </Link>
  );
}

const SEV_ICON: Record<string, string> = { critical: "var(--red)", high: "var(--red)", medium: "var(--solar-600)", low: "var(--faint)" };
export function ExceptionRow({ e, action }: { e: any; action?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
      <span className="mt-0.5 shrink-0" style={{ color: SEV_ICON[e.severity] }}><Icon name="alert" size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold">
          {label(e.type)}{e.material ? <span className="font-semibold">— {e.material}</span> : null}
          <StatusBadge status={String(e.severity).toUpperCase()} />
        </div>
        <div className="text-xs text-muted">{e.customer_name ?? ""}{e.project_code ? ` · ${e.project_code}` : ""}{e.vendor_name ? ` · ${e.vendor_name}` : ""}</div>
        {e.detail && <div className="mt-0.5 text-xs text-ink">{e.detail}</div>}
      </div>
      <div className="shrink-0 text-right text-xs">{e.due_date && <div className="text-faint">Due {fmtDate(e.due_date).replace(/ \d{4}$/, "")}</div>}{action}</div>
    </li>
  );
}

export function SyncBadge({ status }: { status: string }) {
  return <StatusBadge status={status} tone={status === "SYNCED" ? "green" : status === "FAILED" ? "red" : status === "PENDING" ? "gray" : "orange"}>{label(status)}</StatusBadge>;
}

export function DeliveryCard({ d }: { d: any }) {
  return (
    <Link href={d.href} className="card block p-3 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2"><div className="text-[12px] font-extrabold num">{d.code}</div>{d.late && <span className="badge b-red">Late</span>}</div>
      <div className="mt-1 truncate text-[13px] font-semibold">{d.customer}</div>
      <div className="text-xs text-muted">{d.project} · {d.vendor}</div>
      <div className="mt-1.5 line-clamp-2 text-xs">{d.items}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-faint"><span>Expected {d.expected ? fmtDate(d.expected).replace(/ \d{4}$/, "") : "TBC"}</span><StatusBadge status={d.status} /></div>
    </Link>
  );
}

export function LockedPanel({ gate }: { gate: { reasons: { code: string; message: string; required?: string; received?: string }[]; project?: any } }) {
  const r = gate.reasons[0];
  return (
    <div className="card mx-auto max-w-[620px] border-l-4 p-6" style={{ borderLeftColor: "var(--red)" }}>
      <div className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-[var(--red)]"><Icon name="lock" size={18} /> Procurement Locked</div>
      <p className="text-[13.5px]">Procurement cannot be initiated.</p>
      <dl className="mt-3 space-y-2 text-[13.5px]">
        <div><dt className="eyebrow">Reason</dt><dd className="font-semibold">{r.message}</dd></div>
        {r.required && <div className="grid grid-cols-2 gap-3"><div><dt className="eyebrow">Required</dt><dd className="font-bold num">{r.required}</dd></div><div><dt className="eyebrow">Received</dt><dd className="font-bold num text-[var(--red)]">{r.received}</dd></div></div>}
        <div className="grid grid-cols-2 gap-3"><div><dt className="eyebrow">Project</dt><dd className="font-semibold num">{gate.project?.code}</dd></div><div><dt className="eyebrow">Customer</dt><dd className="font-semibold">{gate.project?.customer_name ?? "—"}</dd></div></div>
      </dl>
      {gate.reasons.length > 1 && <ul className="mt-3 list-disc pl-5 text-xs text-muted">{gate.reasons.slice(1).map((x) => <li key={x.code}>{x.message}</li>)}</ul>}
    </div>
  );
}
export { EmptyState, inr };
