import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { scopeSql } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Material Receipt" };
export const dynamic = "force-dynamic";

export default async function Receipts() {
  const user = await guard("procurement");
  const sc = scopeSql({ id: user.id, role: user.role }, "d.project_id");
  const db = getDb();
  const base = `FROM deliveries d JOIN purchase_orders o ON o.id = d.po_id LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN vendors v ON v.id = d.vendor_id`;
  const pendingInsp = db.prepare(`SELECT d.*, o.code po_code, p.code pcode, c.name cname, v.name vname ${base} WHERE d.status = 'RECEIVED' AND ${sc.sql} ORDER BY d.received_at`).all(...sc.args) as any[];
  const pendingAck = db.prepare(`SELECT d.*, o.code po_code, p.code pcode, c.name cname, v.name vname, n.id dn_id, n.code dn ${base} JOIN delivery_notes n ON n.delivery_id = d.id WHERE d.status = 'INSPECTED' AND ${sc.sql} ORDER BY d.received_at`).all(...sc.args) as any[];
  const receipts = db.prepare(`SELECT mr.*, d.code dcode, d.id did, o.code po_code, p.code pcode, c.name cname, v.name vname, g.id grn_id, g.code grn, n.id dn_id, n.code dn, mi.result ${base} JOIN material_receipts mr ON mr.delivery_id = d.id LEFT JOIN grns g ON g.delivery_id = d.id LEFT JOIN delivery_notes n ON n.delivery_id = d.id LEFT JOIN material_inspections mi ON mi.delivery_id = d.id WHERE ${sc.sql} ORDER BY mr.id DESC LIMIT 60`).all(...sc.args) as any[];
  const wr = can(user.role, "receiving", "w");
  return (
    <div>
      <PageHeader title="Material receipt" sub="What has arrived at site, what is waiting for inspection, and the receipt documents (GRN, delivery note)." />
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2">Awaiting inspection <span className="rounded-full bg-[#eef1f4] px-1.5 text-[11px] text-muted">{pendingInsp.length}</span></span>} flush>
          {pendingInsp.length === 0 ? <EmptyState icon="check" title="No inspections pending" body="Every delivery that has arrived has been inspected." /> : (
            <ul>{pendingInsp.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-0"><div className="min-w-0"><Link className="lnk num" href={`/procurement/deliveries/${d.id}`}>{d.code}</Link><div className="truncate text-xs text-muted">{d.cname} · {d.pcode} · {d.vname} · received {fmtDateTime(d.received_at)}</div></div>{wr && <Link className="btn btn-sm btn-primary" href={`/procurement/deliveries/${d.id}/receive`}>Inspect</Link>}</li>)}</ul>)}
        </Card>
        <Card title={<span className="flex items-center gap-2">Awaiting customer acknowledgement <span className="rounded-full bg-[#eef1f4] px-1.5 text-[11px] text-muted">{pendingAck.length}</span></span>} flush>
          {pendingAck.length === 0 ? <EmptyState icon="check" title="Nothing waiting for signature" /> : (
            <ul>{pendingAck.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-0"><div className="min-w-0"><Link className="lnk num" href={`/procurement/deliveries/${d.id}`}>{d.code}</Link><div className="truncate text-xs text-muted">{d.cname} · {d.pcode} · note {d.dn}</div></div>{wr && <Link className="btn btn-sm btn-primary" href={`/procurement/deliveries/${d.id}/receive`}>Get signature</Link>}</li>)}</ul>)}
        </Card>
      </div>
      <Card title="Recent receipts" flush>
        {receipts.length === 0 ? <EmptyState icon="receipt" title="No receipts yet" /> : (
          <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 900 }}><thead><tr><th>Receipt</th><th>Delivery</th><th>PO</th><th>Project</th><th>Vendor</th><th>Received by</th><th>When</th><th>Inspection</th><th>GRN</th><th>Delivery note</th></tr></thead>
            <tbody>{receipts.map((r) => <tr key={r.id}><td className="num">{r.code}</td><td><Link className="lnk num" href={`/procurement/deliveries/${r.did}`}>{r.dcode}</Link></td><td className="num">{r.po_code}</td><td>{r.pcode}<div className="text-xs text-muted">{r.cname}</div></td><td>{r.vname}</td><td>{r.received_by}{r.vehicle ? <div className="text-xs text-muted">{r.vehicle}</div> : null}</td><td>{fmtDateTime(r.received_at)}</td>
              <td>{r.result ? <StatusBadge status={r.result} tone={r.result === "ACCEPTED" ? "green" : r.result === "PARTIALLY_ACCEPTED" ? "orange" : "red"}>{label(r.result)}</StatusBadge> : <StatusBadge status="PENDING">Pending</StatusBadge>}</td>
              <td>{r.grn_id ? <Link className="lnk num" href={`/procurement-print/grn/${r.grn_id}`} target="_blank">{r.grn}</Link> : "—"}</td><td>{r.dn_id ? <Link className="lnk num" href={`/procurement-print/dn/${r.dn_id}`} target="_blank">{r.dn}</Link> : "—"}</td></tr>)}</tbody></table></div>)}
      </Card>
    </div>
  );
}
