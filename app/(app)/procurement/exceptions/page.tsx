import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { allExceptions, EXCEPTION_TYPES, procurementTick } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { ExceptionRow } from "@/components/proc";
import { ModalButton, ActionForm } from "@/components/client";
import { Field } from "@/components/ui";
import { resolveExceptionAction } from "@/app/actions/procurement";
import { fmtDateTime } from "@/lib/util";
import { getDb } from "@/lib/db";

export const metadata = { title: "Procurement exceptions" };
export const dynamic = "force-dynamic";

export default async function Exceptions({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  procurementTick();
  const status = sp.status === "RESOLVED" ? "RESOLVED" : "OPEN";
  const rows = allExceptions({ status, type: sp.type, viewer: { id: user.id, role: user.role } });
  const counts = Object.fromEntries((getDb().prepare("SELECT type, COUNT(*) c FROM procurement_exceptions WHERE status = 'OPEN' GROUP BY type").all() as any[]).map((r) => [r.type, r.c]));
  const w = can(user.role, "procurement", "w");
  const href = (o: Record<string, string | undefined>) => { const p = new URLSearchParams({ ...(sp.status && { status: sp.status }), ...(sp.type && { type: sp.type }), ...(o as any) }); [...p.keys()].forEach((k) => !p.get(k) && p.delete(k)); return `/procurement/exceptions?${p}`; };
  const alerts = getDb().prepare("SELECT * FROM procurement_alerts ORDER BY id DESC LIMIT 12").all() as any[];
  return (
    <div>
      <PageHeader title="Exception centre" sub="Everything that has gone off-plan — raised automatically, closed automatically when the cause clears or by hand with a resolution." />
      <div className="mb-3 flex flex-wrap gap-1.5"><Link href={href({ type: undefined })} className={`btn btn-sm ${!sp.type ? "btn-dark" : ""}`}>All types</Link>{Object.entries(EXCEPTION_TYPES).map(([k, l]) => <Link key={k} href={href({ type: k })} className={`btn btn-sm ${sp.type === k ? "btn-dark" : ""}`}>{l} <span className="opacity-60">{counts[k] ?? 0}</span></Link>)}
        <span className="mx-1 h-5 w-px bg-line" /><Link href={href({ status: undefined })} className={`btn btn-sm ${status === "OPEN" ? "btn-dark" : ""}`}>Open</Link><Link href={href({ status: "RESOLVED" })} className={`btn btn-sm ${status === "RESOLVED" ? "btn-dark" : ""}`}>Resolved</Link></div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card flush className="lg:col-span-2">{rows.length === 0 ? <EmptyState icon="check" title={status === "OPEN" ? "No open exceptions" : "Nothing resolved yet"} body="All current procurement commitments are on schedule." /> : (
          <ul>{rows.map((e) => <ExceptionRow key={e.id} e={e} action={e.status === "OPEN" ? (w ? <ModalButton label="Resolve" title={`Resolve ${e.code}`} className="btn btn-sm" width={440}><ActionForm action={resolveExceptionAction.bind(null, e.id)} submitLabel="Mark resolved" className="space-y-3"><p className="text-[13px] text-muted">{e.detail}</p><Field label="Resolution *"><input name="resolution" required className="input" placeholder="What was done?" /></Field></ActionForm></ModalButton> : null) : <span className="text-xs text-muted">{e.resolution}</span>} />)}</ul>)}</Card>
        <Card title="Alert engine" flush>{alerts.length === 0 ? <EmptyState icon="bell" title="No alerts yet" /> : <ul>{alerts.map((a) => <li key={a.id} className="border-b border-line px-4 py-2.5 text-[13px] last:border-0"><div className="font-semibold">{a.title}</div><div className="text-xs text-muted">{a.body}</div><div className="mt-0.5 flex items-center justify-between text-[11px] text-faint"><span>{fmtDateTime(a.created_at)}</span><StatusBadge status={String(a.severity).toUpperCase()} /></div></li>)}</ul>}</Card>
      </div>
    </div>
  );
}
