import Link from "next/link";
import { guard } from "@/lib/auth";
import { label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { scopeSql } from "@/lib/services/procurement";
import { today } from "@/lib/clock";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { DeliveryCard } from "@/components/proc";
import { SearchBox } from "@/components/client";
import { fmtDate, fmtDateTime } from "@/lib/util";

export const metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

const COLS = [["ORDERED", "Ordered"], ["CONFIRMED", "Confirmed"], ["READY", "Ready for dispatch"], ["TRANSIT", "In transit"], ["TODAY", "Arriving today"], ["RECEIVED", "Received"], ["INSPECTION", "Inspection"], ["ACCEPTED", "Accepted"]] as const;

export default async function Deliveries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const db = getDb();
  const t = today();
  const sc = scopeSql({ id: user.id, role: user.role }, "d.project_id");
  const dels = db.prepare(`SELECT d.*, o.code po_code, p.code pcode, c.name cname, v.name vname,
      (SELECT GROUP_CONCAT(i.description, ' + ') FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = d.id) items
    FROM deliveries d JOIN purchase_orders o ON o.id = d.po_id LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN vendors v ON v.id = d.vendor_id
    WHERE ${sc.sql} AND (d.status != 'ACKNOWLEDGED' OR d.closed_at >= datetime('now','-14 days')) AND d.status != 'CLOSED' ORDER BY d.expected_date, d.id`).all(...sc.args) as any[];
  const sc2 = scopeSql({ id: user.id, role: user.role }, "o.project_id");
  const sentPos = db.prepare(`SELECT o.*, p.code pcode, c.name cname, v.name vname, (SELECT GROUP_CONCAT(description, ' + ') FROM purchase_order_items WHERE po_id = o.id) items FROM purchase_orders o LEFT JOIN projects p ON p.id = o.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN vendors v ON v.id = o.vendor_id WHERE o.status = 'SENT' AND ${sc2.sql} ORDER BY o.sent_at`).all(...sc2.args) as any[];

  const card = (d: any) => ({ code: d.code, customer: d.cname, project: d.pcode, vendor: d.vname, items: d.items, expected: d.expected_date, status: d.status, late: !!d.expected_date && d.expected_date < t && ["PLANNED", "READY_FOR_DISPATCH", "IN_TRANSIT"].includes(d.status), href: `/procurement/deliveries/${d.id}` });
  const board: Record<string, any[]> = Object.fromEntries(COLS.map(([k]) => [k, []]));
  sentPos.forEach((o) => board.ORDERED.push({ code: o.code, customer: o.cname, project: o.pcode, vendor: o.vname, items: o.items, expected: null, status: "AWAITING_CONFIRMATION", late: false, href: `/procurement/${o.id}` }));
  for (const d of dels) {
    const c = card(d);
    if (d.status === "PLANNED") board.CONFIRMED.push(c);
    else if (d.status === "READY_FOR_DISPATCH") (d.expected_date === t ? board.TODAY : board.READY).push(c);
    else if (d.status === "IN_TRANSIT") (d.expected_date === t ? board.TODAY : board.TRANSIT).push(c);
    else if (d.status === "RECEIVED") board.RECEIVED.push(c);
    else if (d.status === "INSPECTED") board.INSPECTION.push(c);
    else if (d.status === "ACKNOWLEDGED") board.ACCEPTED.push(c);
  }
  let list = dels;
  if (sp.status) list = list.filter((d) => d.status === sp.status);
  if (sp.q) { const q = sp.q.toLowerCase(); list = list.filter((d) => [d.code, d.po_code, d.pcode, d.cname, d.vname, d.items].some((s) => String(s ?? "").toLowerCase().includes(q))); }

  return (
    <div>
      <PageHeader title="Deliveries" sub="Every PO can have several deliveries — each with its own items, quantities, dates and status." actions={<SearchBox defaultValue={sp.q} placeholder="Search deliveries…" />} />
      <div className="-mx-4 mb-6 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
        <div className="flex gap-3" style={{ minWidth: COLS.length * 232 }}>
          {COLS.map(([k, l]) => (
            <div key={k} className="w-[220px] shrink-0">
              <div className="mb-2 flex items-center justify-between px-1"><div className="text-[11.5px] font-extrabold uppercase tracking-wider">{l}</div><span className="rounded-full bg-[#eef1f4] px-1.5 text-[11px] font-bold text-muted">{board[k].length}</span></div>
              <div className="space-y-2 rounded-lg bg-[#eaeef2] p-2" style={{ minHeight: 100 }}>
                {board[k].length === 0 && <div className="py-6 text-center text-xs text-faint">None</div>}
                {board[k].slice(0, 8).map((c) => <DeliveryCard key={c.code + c.href} d={c} />)}
                {board[k].length > 8 && <div className="text-center text-xs text-muted">+{board[k].length - 8} more</div>}
              </div>
            </div>))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">{[["", "All open"], ["PLANNED", "Planned"], ["READY_FOR_DISPATCH", "Ready"], ["IN_TRANSIT", "In transit"], ["RECEIVED", "Received"], ["INSPECTED", "Inspected"], ["ACKNOWLEDGED", "Acknowledged"]].map(([k, l]) => <Link key={k} href={k ? `/procurement/deliveries?status=${k}` : "/procurement/deliveries"} className={`btn btn-sm ${(sp.status ?? "") === k ? "btn-dark" : ""}`}>{l}</Link>)}</div>
      <Card flush>{list.length === 0 ? <EmptyState icon="truck" title="No deliveries in this view" body="All current procurement commitments are on schedule." /> : (
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 900 }}><thead><tr><th>Delivery</th><th>PO</th><th>Project</th><th>Vendor</th><th>Items</th><th>Expected</th><th>Received</th><th>Status</th></tr></thead>
          <tbody>{list.map((d) => <tr key={d.id}><td><Link className="lnk num" href={`/procurement/deliveries/${d.id}`}>{d.code}</Link></td><td><Link className="lnk num" href={`/procurement/${d.po_id}`}>{d.po_code}</Link></td><td>{d.pcode}<div className="text-xs text-muted">{d.cname}</div></td><td>{d.vname}</td><td className="max-w-[260px] truncate">{d.items}</td>
            <td className={d.expected_date && d.expected_date < t && ["PLANNED", "READY_FOR_DISPATCH", "IN_TRANSIT"].includes(d.status) ? "font-bold text-[var(--red)]" : ""}>{fmtDate(d.expected_date)}</td><td>{d.received_at ? fmtDateTime(d.received_at) : "—"}</td><td><StatusBadge status={d.status}>{label(d.status)}</StatusBadge></td></tr>)}</tbody></table></div>)}</Card>
    </div>
  );
}
