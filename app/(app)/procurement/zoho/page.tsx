import { guard } from "@/lib/auth";
import { events, mappings, syncSummary, ZOHO_EVENTS } from "@/lib/services/procurement";
import { ZohoBooks } from "@/lib/providers";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SyncBadge } from "@/components/proc";
import { ActionButton } from "@/components/client";
import { zohoRetryAction, zohoRetryAllAction, zohoMappingAction } from "@/app/actions/procurement";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Zoho Books sync" };
export const dynamic = "force-dynamic";

export default async function ZohoPage() {
  const user = await guard("procurement");
  const ev = events(150);
  const maps = mappings();
  const sum = syncSummary();
  const canAct = ["md", "finance", "admin"].includes(user.role);
  const canApprove = ["md", "finance"].includes(user.role);
  const configured = ZohoBooks.configured();
  return (
    <div>
      <PageHeader title="Accounting sync — Zoho Books" sub="Procurement publishes clean business events. Zoho Books stays the accounting system; the ledger treatment is defined and approved by Finance, not invented here."
        actions={canAct ? <ActionButton action={zohoRetryAllAction} className="btn">Retry failed / pending</ActionButton> : undefined} />
      <div className={`mb-5 rounded-lg border p-3 text-[13px] ${configured ? "border-[var(--green-100)] bg-[var(--green-50)]" : "border-[#f0d9a8] bg-[var(--solar-50)]"}`}>
        {configured ? (ZohoBooks.simulated() ? "Simulation mode (ZOHO_SIMULATE=1): events are marked synced without contacting Zoho." : "Connected: approved events are POSTed to the configured sync endpoint.") : "Not connected. Set ZOHO_SYNC_ENDPOINT (and ZOHO_TOKEN) in .env.local. Until then, approved events fail visibly with a reason and can be retried — nothing is silently dropped."}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">{["PENDING", "PROCESSING", "SYNCED", "FAILED", "RETRYING"].map((s) => <div key={s} className="card p-3.5"><SyncBadge status={s} /><div className="mt-1.5 text-2xl font-extrabold num">{sum[s] ?? 0}</div></div>)}</div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Event mappings" flush className="lg:col-span-1">
          <ul>{maps.map((m) => <li key={m.event_type} className="border-b border-line px-4 py-3 last:border-0"><div className="flex items-start justify-between gap-2"><div><div className="text-[13px] font-bold">{m.event_type}</div><div className="text-xs text-muted">{ZOHO_EVENTS[m.event_type]}</div>{m.enabled ? <div className="text-[11px] text-[var(--green-700)]">Approved by {m.approved_by} · {fmtDateTime(m.approved_at)}</div> : <div className="text-[11px] text-faint">Awaiting finance approval — events are queued, not sent</div>}</div>
            {canApprove ? <ActionButton action={zohoMappingAction.bind(null, m.event_type, !m.enabled)} className={`btn btn-sm ${m.enabled ? "" : "btn-primary"}`} confirm={m.enabled ? `Stop syncing ${m.event_type}?` : `Approve syncing ${m.event_type} to Zoho Books? Only do this once the accounting treatment is confirmed.`} confirmLabel={m.enabled ? "Disable" : "Approve"}>{m.enabled ? "On" : "Approve"}</ActionButton> : <span className={`badge ${m.enabled ? "b-green" : ""}`}>{m.enabled ? "On" : "Off"}</span>}</div></li>)}</ul>
        </Card>
        <Card title="Sync events" flush className="lg:col-span-2">{ev.length === 0 ? <EmptyState icon="refresh" title="No events yet" body="Events appear as orders are approved, POs released, material received and delivery notes signed." /> : (
          <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 700 }}><thead><tr><th>When</th><th>Event</th><th>Reference</th><th>Status</th><th>Detail</th><th /></tr></thead>
            <tbody>{ev.map((e) => <tr key={e.id}><td className="whitespace-nowrap text-muted">{fmtDateTime(e.created_at)}</td><td className="text-xs font-bold">{e.event_type}</td><td className="num">{e.ref}</td><td><SyncBadge status={e.status} /></td><td className="max-w-[260px] text-xs text-muted">{e.status === "FAILED" ? <><b className="text-[var(--red)]">Zoho sync failed</b> — {e.last_error}</> : e.status === "SYNCED" ? `ID ${e.external_id}` : e.last_error ?? ""}{e.attempts > 0 ? ` · ${e.attempts} attempt${e.attempts > 1 ? "s" : ""}` : ""}</td>
              <td className="r">{canAct && ["FAILED"].includes(e.status) && <ActionButton action={zohoRetryAction.bind(null, e.id)} className="btn btn-sm">Retry</ActionButton>}</td></tr>)}</tbody></table></div>)}</Card>
      </div>
    </div>
  );
}
