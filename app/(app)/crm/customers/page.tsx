import Link from "next/link";
import { guard } from "@/lib/auth";
import { listCustomers } from "@/lib/services/misc";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SearchBox } from "@/components/client";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard("crm");
  const sp = await searchParams;
  const rows = listCustomers(sp.q);
  return (
    <div>
      <PageHeader title="Customers" sub={`${rows.length} customer${rows.length === 1 ? "" : "s"}`} actions={<SearchBox defaultValue={sp.q} placeholder="Search customers…" />} />
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="users" title="No customers found" /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>ID</th><th>Customer</th><th>Industry</th><th>City</th><th>Primary contact</th><th className="r">Leads</th><th className="r">Projects</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}><td><Link className="lnk num" href={`/crm/customers/${c.id}`}>{c.code}</Link></td><td className="font-semibold">{c.name}</td><td>{c.industry ?? "—"}</td><td>{c.city ?? "—"}</td><td>{c.contact ?? "—"}{c.phone && <span className="text-xs text-muted"> · {c.phone}</span>}</td><td className="r num">{c.leads}</td><td className="r num">{c.projects}</td></tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
