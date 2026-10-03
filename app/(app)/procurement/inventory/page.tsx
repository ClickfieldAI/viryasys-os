import Link from "next/link";
import { guard } from "@/lib/auth";
import { projectStock } from "@/lib/services/procurement";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { inrShort } from "@/lib/util";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function Inventory() {
  const user = await guard("procurement");
  const rows = projectStock({ id: user.id, role: user.role });
  const tot = rows.reduce((a, r) => ({ store: a.store + r.store, site: a.site + r.site, consumed: a.consumed + r.consumed, damaged: a.damaged + r.damaged }), { store: 0, site: 0, consumed: 0, damaged: 0 });
  return (
    <div>
      <PageHeader title="Inventory" sub="Stock is project-linked and built from an immutable ledger — every quantity traces to a receipt, issue, consumption or return." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{([["Available in store", tot.store], ["Issued & at site", tot.site], ["Consumed", tot.consumed], ["Damaged / rejected", tot.damaged]] as [string, number][]).map(([l, v]) => <div key={l} className="card p-3.5"><div className="eyebrow">{l}</div><div className="mt-1 text-2xl font-extrabold num">{inrShort(v)}</div></div>)}</div>
      <Card flush>{rows.length === 0 ? <EmptyState icon="cube" title="No stock yet" body="Stock appears here when material is received and accepted on a project." /> : (
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 980 }}><thead><tr><th>Project</th><th className="r">Received</th><th className="r">Accepted</th><th className="r">In store</th><th className="r">Issued (at site)</th><th className="r">Consumed</th><th className="r">Returned</th><th className="r">Damaged / rejected</th><th>Variance</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link className="lnk" href={`/procurement/inventory/${r.id}`}>{r.customer}</Link><div className="text-xs text-muted num">{r.code} · {r.stage.replace("_", " ").toLowerCase()}</div></td><td className="r num">{inrShort(r.received)}</td><td className="r num">{inrShort(r.accepted)}</td><td className="r num font-semibold">{inrShort(r.store)}</td><td className="r num">{inrShort(r.site)}</td><td className="r num">{inrShort(r.consumed)}</td><td className="r num">{inrShort(r.returned)}</td><td className={`r num ${r.damaged > 0 ? "text-[var(--red)]" : ""}`}>{inrShort(r.damaged)}</td><td>{r.flags ? <StatusBadge status="AT_RISK">{r.flags} flagged</StatusBadge> : <span className="text-faint">—</span>}</td></tr>)}</tbody></table></div>)}</Card>
      <p className="hint mt-2">Values are quantities × PO rate (BOQ estimate where no PO exists). Open a project for the material-level ledger.</p>
    </div>
  );
}
