import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { getDb } from "@/lib/db";
import { scopeSql } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { cancelRequestAction } from "@/app/actions/procurement";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Purchase requests" };
export const dynamic = "force-dynamic";

export default async function Requests({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const sc = scopeSql({ id: user.id, role: user.role }, "q.project_id");
  const rows = getDb().prepare(`SELECT q.*, p.code pcode, c.name cname, v.name vname, u.name uname FROM purchase_requests q JOIN projects p ON p.id = q.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN vendors v ON v.id = q.preferred_vendor_id LEFT JOIN users u ON u.id = q.created_by
    WHERE ${sc.sql} ${sp.status ? "AND q.status = ?" : ""} ORDER BY q.status = 'OPEN' DESC, CASE q.priority WHEN 'CRITICAL' THEN 0 WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, q.id DESC LIMIT 200`).all(...sc.args, ...(sp.status ? [sp.status] : [])) as any[];
  const w = can(user.role, "procurement", "w");
  return (
    <div>
      <PageHeader title="Purchase requests" sub="Raised from approved project requirements, then converted into purchase orders." actions={w ? <Link className="btn btn-primary" href="/procurement/new">Create PO</Link> : undefined} />
      <div className="mb-3 flex gap-1.5">{[["", "All"], ["OPEN", "Open"], ["CONVERTED", "Converted"], ["CANCELLED", "Cancelled"]].map(([k, l]) => <Link key={k} href={k ? `/procurement/requests?status=${k}` : "/procurement/requests"} className={`btn btn-sm ${(sp.status ?? "") === k ? "btn-dark" : ""}`}>{l}</Link>)}</div>
      <Card flush>{rows.length === 0 ? <EmptyState icon="file" title="No purchase requests" body="Open a project’s procurement plan and request material from its requirements." /> : (
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Request</th><th>Project</th><th>Material</th><th className="r">Qty</th><th>Required by</th><th>Priority</th><th>Preferred vendor</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((q) => <tr key={q.id}><td className="num font-semibold">{q.code}</td><td><Link className="lnk" href={`/procurement/plans/${q.project_id}`}>{q.pcode}</Link><div className="text-xs text-muted">{q.cname}</div></td><td>{q.material}<div className="text-xs text-muted">{q.spec}</div></td><td className="r num">{q.qty} {q.unit}</td><td>{fmtDate(q.required_by)}</td><td><StatusBadge status={q.priority} /></td><td>{q.vname ?? "—"}</td><td><StatusBadge status={q.status} /></td><td className="r">{w && q.status === "OPEN" && <ActionButton action={cancelRequestAction.bind(null, q.id)} className="btn btn-ghost btn-sm">Cancel</ActionButton>}</td></tr>)}</tbody></table></div>)}</Card>
    </div>
  );
}
