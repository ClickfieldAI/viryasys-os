import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { returnsList, stockOptions } from "@/lib/services/procurement";
import { PageHeader, Card, EmptyState, Field, StatusBadge } from "@/components/ui";
import { ModalButton, ActionForm } from "@/components/client";
import { MaterialPicker } from "@/components/proc-client";
import { Select } from "@/components/forms";
import { returnMaterialAction } from "@/app/actions/procurement";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Material Returns" };
export const dynamic = "force-dynamic";

export default async function Returns({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const viewer = { id: user.id, role: user.role };
  const rows = returnsList(viewer, Number(sp.project) || undefined);
  const { mats, projects } = stockOptions(viewer);
  const wr = can(user.role, "receiving", "w");
  return (
    <div>
      <PageHeader title="Material returns" sub="Unused material leaving a project at completion — inspected on return and removed from the project’s stock."
        actions={wr ? <ModalButton label="Return material" icon="plus" title="Return unused material" width={520}>
          <ActionForm action={returnMaterialAction} submitLabel="Record return" className="space-y-3"><div className="space-y-3"><MaterialPicker projects={projects} materials={mats} show="onHand" /></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Quantity *"><input name="qty" type="number" step="any" min="0" required className="input" /></Field><Field label="Condition"><Select name="condition" options={["Good", "Minor damage", "Damaged"]} /></Field><Field label="Returned by *"><input name="returned_by" required className="input" /></Field><Field label="Received by *"><input name="received_by" required defaultValue={user.name} className="input" /></Field></div><Field label="Reason"><input name="reason" className="input" placeholder="Unused at project completion" /></Field></ActionForm></ModalButton> : undefined} />
      <Card flush>{rows.length === 0 ? <EmptyState icon="refresh" title="No returns yet" body="Unused material is returned when a project completes; you’ll be prompted automatically." /> : (
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 860 }}><thead><tr><th>Return</th><th>Project</th><th>Material</th><th className="r">Qty</th><th>Condition</th><th>Reason</th><th>Returned by</th><th>Received by</th><th>Date</th></tr></thead>
          <tbody>{rows.map((m) => <tr key={m.id}><td className="num font-semibold">{m.code}</td><td><Link className="lnk" href={`/procurement/inventory/${m.project_id}`}>{m.pcode}</Link><div className="text-xs text-muted">{m.cname}</div></td><td>{m.material}</td><td className="r num">{m.qty} {m.unit}</td><td><StatusBadge status={m.condition === "Good" ? "ACCEPTED" : "DAMAGED"}>{m.condition}</StatusBadge></td><td className="text-muted">{m.reason ?? "—"}</td><td>{m.returned_by}</td><td>{m.received_by}</td><td>{fmtDateTime(m.at)}</td></tr>)}</tbody></table></div>)}</Card>
    </div>
  );
}
