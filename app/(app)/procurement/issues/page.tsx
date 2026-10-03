import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { issuesList, stockOptions } from "@/lib/services/procurement";
import { PageHeader, Card, EmptyState, Field } from "@/components/ui";
import { ModalButton, ActionForm } from "@/components/client";
import { MaterialPicker } from "@/components/proc-client";
import { issueMaterialAction } from "@/app/actions/procurement";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Material Issues" };
export const dynamic = "force-dynamic";

export default async function Issues({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const viewer = { id: user.id, role: user.role };
  const rows = issuesList(viewer, Number(sp.project) || undefined);
  const { mats, projects } = stockOptions(viewer);
  const wr = can(user.role, "receiving", "w");
  return (
    <div>
      <PageHeader title="Material issues" sub="Material moving from project store to installation. Each issue reduces store stock and creates a ledger entry."
        actions={wr ? <ModalButton label="Issue material" icon="plus" title="Issue material to installation" width={520}>
          <ActionForm action={issueMaterialAction} submitLabel="Issue material" className="space-y-3"><div className="space-y-3"><MaterialPicker projects={projects} materials={mats} show="store" /></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Quantity *"><input name="qty" type="number" step="any" min="0" required className="input" /></Field><Field label="Installation stage"><input name="install_stage" className="input" placeholder="Panel installation" /></Field><Field label="Issued by *"><input name="issued_by" required defaultValue={user.name} className="input" /></Field><Field label="Received by *"><input name="received_by" required className="input" placeholder="Site engineer" /></Field></div><Field label="Purpose"><input name="purpose" className="input" /></Field></ActionForm></ModalButton> : undefined} />
      <Card flush>{rows.length === 0 ? <EmptyState icon="upload" title="No material issued yet" body="Issue accepted material to the installation team from the project store." /> : (
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 860 }}><thead><tr><th>Issue</th><th>Project</th><th>Material</th><th className="r">Qty</th><th>Stage</th><th>Issued by</th><th>Received by</th><th>Date</th></tr></thead>
          <tbody>{rows.map((m) => <tr key={m.id}><td className="num font-semibold">{m.code}</td><td><Link className="lnk" href={`/procurement/inventory/${m.project_id}`}>{m.pcode}</Link><div className="text-xs text-muted">{m.cname}</div></td><td>{m.material}</td><td className="r num">{m.qty} {m.unit}</td><td>{m.install_stage ?? "—"}</td><td>{m.issued_by}</td><td>{m.received_by}</td><td>{fmtDateTime(m.at)}</td></tr>)}</tbody></table></div>)}</Card>
    </div>
  );
}
