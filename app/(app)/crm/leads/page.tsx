import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, ALL_LEAD_STATUSES, LEAD_SOURCES, label } from "@/lib/config";
import { listLeads, slaTick, slaInfo } from "@/lib/services/leads";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, Pagination } from "@/components/ui";
import { ModalButton, ActionForm, SearchBox, SlaTimer } from "@/components/client";
import { LeadFormFields } from "@/components/forms";
import { createLeadAction } from "@/app/actions/crm";
import { fmtKw, inrShort, timeAgo } from "@/lib/util";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("crm");
  const sp = await searchParams;
  slaTick();
  const page = Number(sp.page) || 1;
  const { rows, total, pages } = listLeads({ q: sp.q, status: sp.status, source: sp.source, owner: sp.mine ? user.id : undefined, page });
  const counts = Object.fromEntries((getDb().prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all() as any[]).map((r) => [r.status, r.c]));
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...(sp.q && { q: sp.q }), ...(sp.status && { status: sp.status }), ...(sp.source && { source: sp.source }), ...(sp.mine && { mine: "1" }), ...(o as any) });
    [...p.keys()].forEach((k) => !p.get(k) && p.delete(k));
    return `/crm/leads?${p}`;
  };
  return (
    <div>
      <PageHeader title="Leads" sub={`${total} lead${total === 1 ? "" : "s"}${sp.status ? ` · ${label(sp.status)}` : ""}`}
        actions={<>
          <SearchBox placeholder="Search leads…" defaultValue={sp.q} />
          {can(user.role, "crm", "w") && (
            <ModalButton label="New lead" icon="plus" title="New lead" width={640}>
              <ActionForm action={createLeadAction} submitLabel="Create lead" className="space-y-4">
                <LeadFormFields />
                <p className="hint">The system checks for duplicates before creating. The lead is auto-assigned and its 2-minute response timer starts immediately.</p>
              </ActionForm>
            </ModalButton>
          )}
        </>} />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link href={href({ status: undefined, page: undefined })} className={`btn btn-sm ${!sp.status ? "btn-dark" : ""}`}>All</Link>
        {ALL_LEAD_STATUSES.map((s) => (
          <Link key={s} href={href({ status: s, page: undefined })} className={`btn btn-sm ${sp.status === s ? "btn-dark" : ""}`}>{label(s)} <span className="opacity-60">{counts[s] ?? 0}</span></Link>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Link href={href({ mine: sp.mine ? undefined : "1", page: undefined })} className={`btn btn-sm ${sp.mine ? "btn-dark" : ""}`}>My leads</Link>
        {sp.source && <Link href={href({ source: undefined })} className="btn btn-sm">Source: {LEAD_SOURCES[sp.source] ?? sp.source} ✕</Link>}
      </div>

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState title="No leads match" body="Try clearing filters, or capture a new lead." icon="funnel" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Lead</th><th>Customer</th><th>Location</th><th className="r">Capacity</th><th>Source</th><th>Owner</th><th>Status</th><th className="r">Est. value</th><th>Response</th></tr></thead>
              <tbody>
                {rows.map((l) => {
                  const s = slaInfo(l);
                  return (
                    <tr key={l.id}>
                      <td><Link href={`/crm/leads/${l.id}`} className="lnk num">{l.code}</Link><div className="text-[11px] text-faint">{timeAgo(l.received_at)}</div></td>
                      <td className="font-semibold">{l.customer_name}<div className="text-xs font-normal text-muted">{l.contact_name}</div></td>
                      <td>{l.city ?? "—"}</td>
                      <td className="r num">{fmtKw(l.capacity_kw)}</td>
                      <td>{LEAD_SOURCES[l.source] ?? l.source}</td>
                      <td>{l.owner_name ?? <span className="text-faint">Unassigned</span>}</td>
                      <td><StatusBadge status={l.status} /></td>
                      <td className="r num">{inrShort(l.est_value)}</td>
                      <td>{l.first_response_at || l.sla_status !== "running" || l.status !== "NEW" ? <StatusBadge status={s.state} tone={s.state === "met" ? "green" : s.state === "breached" ? "red" : "orange"}>{s.state === "met" ? "SLA met" : s.state === "breached" ? "SLA breached" : "Running"}</StatusBadge> : <SlaTimer deadline={s.deadline} total={s.total} state={s.state} responseSeconds={s.responseSeconds} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} href={(p) => href({ page: String(p) })} />
      </Card>
    </div>
  );
}
