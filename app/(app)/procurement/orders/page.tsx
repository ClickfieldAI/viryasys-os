import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, PO_STATUSES, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { itemLines, scopeSql, poPaid } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, EmptyState, Pagination, Icon } from "@/components/ui";
import { SearchBox } from "@/components/client";
import { inr, fmtDate } from "@/lib/util";

export const metadata = { title: "Purchase Orders" };
export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const viewer = { id: user.id, role: user.role };
  const page = Math.max(1, Number(sp.page) || 1);
  const sc = scopeSql(viewer, "o.project_id");
  const w = [sc.sql]; const a: any[] = [...sc.args];
  if (sp.status) { w.push("o.status = ?"); a.push(sp.status); }
  if (sp.q) { w.push("(o.code LIKE ? OR v.name LIKE ? OR p.code LIKE ? OR c.name LIKE ?)"); const q = `%${sp.q}%`; a.push(q, q, q, q); }
  const db = getDb();
  const from = `FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN projects p ON p.id = o.project_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = o.owner_id WHERE ${w.join(" AND ")}`;
  const total = (db.prepare(`SELECT COUNT(*) c ${from}`).get(...a) as any).c as number;
  const rows = db.prepare(`SELECT o.*, v.name vendor_name, p.code project_code, c.name customer_name, u.name owner_name, (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = o.id) n_items ${from} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...a, PAGE, (page - 1) * PAGE) as any[];
  const lines = itemLines({ viewer });
  const prog = new Map<number, { done: number; delayed: number }>();
  lines.forEach((l) => { const p = prog.get(l.po_id) ?? { done: 0, delayed: 0 }; if (["INSPECTED", "ACKNOWLEDGED"].includes(l.status)) p.done++; if (l.status === "DELAYED") p.delayed++; prog.set(l.po_id, p); });
  const counts = Object.fromEntries((db.prepare("SELECT status, COUNT(*) c FROM purchase_orders GROUP BY status").all() as any[]).map((r) => [r.status, r.c]));
  const href = (o: Record<string, string | undefined>) => { const p = new URLSearchParams({ ...(sp.status && { status: sp.status }), ...(sp.q && { q: sp.q }), ...(o as any) }); [...p.keys()].forEach((k) => !p.get(k) && p.delete(k)); return `/procurement/orders?${p}`; };
  return (
    <div>
      <PageHeader title="Purchase orders" sub="Drafted by procurement, approved by the MD or Finance, released to the vendor, confirmed, delivered in stages."
        actions={<><SearchBox defaultValue={sp.q} placeholder="Search POs…" />{can(user.role, "procurement", "w") && <Link className="btn btn-primary" href="/procurement/new"><Icon name="plus" size={14} /> Create PO</Link>}</>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href={href({ status: undefined, page: undefined })} className={`btn btn-sm ${!sp.status ? "btn-dark" : ""}`}>All</Link>
        {PO_STATUSES.map((s) => <Link key={s} href={href({ status: s, page: undefined })} className={`btn btn-sm ${sp.status === s ? "btn-dark" : ""}`}>{label(s)} <span className="opacity-60">{counts[s] ?? 0}</span></Link>)}
      </div>
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="truck" title="No purchase orders match" body="Raise a PO from the approved project requirements." /> : (
          <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 960 }}>
            <thead><tr><th>PO</th><th>Project</th><th>Vendor</th><th className="r">Lines</th><th className="r">Total</th><th className="r">Paid</th><th>Required</th><th>Progress</th><th>Status</th><th>Owner</th></tr></thead>
            <tbody>{rows.map((o) => { const pg = prog.get(o.id); const paid = poPaid(o.id); return (
              <tr key={o.id}>
                <td><Link className="lnk num" href={`/procurement/${o.id}`}>{o.code}</Link><div className="text-[11px] text-faint">{fmtDate(o.po_date)}</div></td>
                <td>{o.project_code}<div className="text-xs text-muted">{o.customer_name}</div></td><td>{o.vendor_name ?? "—"}</td><td className="r num">{o.n_items}</td><td className="r num font-semibold">{inr(o.total)}</td>
                <td className="r num">{paid > 0 ? inr(paid) : <span className="text-faint">—</span>}</td><td>{fmtDate(o.required_date)}</td>
                <td className="text-xs">{["VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(o.status) ? <>{pg?.done ?? 0}/{o.n_items} delivered{pg?.delayed ? <b className="ml-1 text-[var(--red)]">· {pg.delayed} delayed</b> : null}</> : <span className="text-faint">—</span>}</td>
                <td><StatusBadge status={o.status} /></td><td>{o.owner_name ?? "—"}</td>
              </tr>); })}</tbody>
          </table></div>)}
        <Pagination page={page} pages={Math.max(1, Math.ceil(total / PAGE))} total={total} href={(p) => href({ page: String(p) })} />
      </Card>
    </div>
  );
}
