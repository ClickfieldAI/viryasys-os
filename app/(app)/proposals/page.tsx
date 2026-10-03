import Link from "next/link";
import { guard } from "@/lib/auth";
import { listProposals } from "@/lib/services/proposals";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { SearchBox } from "@/components/client";
import { fmtKw, inr, fmtDate } from "@/lib/util";
import { can } from "@/lib/config";

export const metadata = { title: "Proposals" };
export const dynamic = "force-dynamic";

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("proposals");
  const sp = await searchParams;
  let rows = listProposals(sp.q);
  if (sp.status) rows = rows.filter((r) => r.status === sp.status);
  const statuses = ["DRAFT", "APPROVED", "SENT", "NEGOTIATION", "ACCEPTED", "REJECTED"];
  return (
    <div>
      <PageHeader title="Proposals" sub="Generated from survey + design + BOQ in one click. Every revision is preserved."
        actions={<><SearchBox defaultValue={sp.q} placeholder="Search proposals…" />{can(user.role, "system") && <Link className="btn" href="/system/proposal-template">Edit template</Link>}</>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/proposals" className={`btn btn-sm ${!sp.status ? "btn-dark" : ""}`}>All</Link>
        {statuses.map((s) => <Link key={s} href={`/proposals?status=${s}`} className={`btn btn-sm ${sp.status === s ? "btn-dark" : ""}`}>{s[0] + s.slice(1).toLowerCase()}</Link>)}
      </div>
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="file" title="No proposals" body="Once a designer completes the design and BOQ, generate a proposal from the lead." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Proposal</th><th>Customer</th><th className="r">Capacity</th><th className="r">Version</th><th className="r">Value (incl. tax)</th><th>Owner</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td><Link className="lnk num" href={`/proposals/${p.id}`}>{p.code}</Link></td><td className="font-semibold">{p.customer_name}</td>
                <td className="r num">{fmtKw(p.capacity_kw)}</td><td className="r num">V{p.current_version}</td><td className="r num font-semibold">{inr(p.total)}</td>
                <td>{p.owner_name ?? "—"}</td><td><StatusBadge status={p.status} /></td><td>{fmtDate(p.created_at)}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
