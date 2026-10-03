import { guard } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PageHeader, Card, EmptyState, Pagination } from "@/components/ui";
import { SearchBox } from "@/components/client";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";
const PAGE = 30;

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard("system");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q ? `%${sp.q}%` : null;
  const where = q ? "WHERE user_name LIKE ? OR action LIKE ? OR entity_id LIKE ? OR entity LIKE ?" : "";
  const args = q ? [q, q, q, q] : [];
  const total = (getDb().prepare(`SELECT COUNT(*) c FROM audit_logs ${where}`).get(...args) as any).c as number;
  const rows = getDb().prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, PAGE, (page - 1) * PAGE) as any[];
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div>
      <PageHeader title="Audit log" sub="Every important change: who, what, from → to, when." actions={<SearchBox defaultValue={sp.q} placeholder="Search audit log…" />} />
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="shield" title="No entries" /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Change</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="whitespace-nowrap text-muted">{fmtDateTime(r.at)}</td><td className="font-semibold">{r.user_name}</td><td>{r.action}</td><td><span className="text-muted">{r.entity}</span> <span className="num">{r.entity_id}</span></td>
                <td>{r.old_value || r.new_value ? <span className="num">{r.old_value && <span className="text-faint">{r.old_value}</span>}{r.old_value && r.new_value && " → "}{r.new_value && <b>{r.new_value}</b>}</span> : ""}</td></tr>))}</tbody>
          </table></div>)}
        <Pagination page={page} pages={pages} total={total} href={(p) => `/system/audit?${new URLSearchParams({ ...(sp.q && { q: sp.q }), page: String(p) })}`} />
      </Card>
    </div>
  );
}
