import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listLayouts } from "@/lib/services/layouts";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { createLayoutAction, createLayoutForProjectAction } from "@/app/actions/work";
import { fmtDateTime, fmtKw } from "@/lib/util";

export const metadata = { title: "Preliminary layouts" };
export const dynamic = "force-dynamic";

export default async function Layouts() {
  const user = await guard("design");
  const w = can(user.role, "design", "w");
  const rows = listLayouts();
  const db = getDb();
  const projects = w ? (db.prepare(
    `SELECT p.id, p.code, p.name, p.capacity_kw, (SELECT id FROM layouts x WHERE x.project_id = p.id) layout_id
     FROM projects p WHERE p.stage != 'COMPLETED' ORDER BY p.created_at DESC, p.id DESC LIMIT 40`
  ).all() as any[]) : [];
  const leads = w ? (db.prepare(
    `SELECT l.id, l.code, COALESCE(c.name, l.title) name FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
     WHERE l.status NOT IN ('LOST','DISQUALIFIED') AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id) ORDER BY l.id DESC LIMIT 40`
  ).all() as any[]) : [];
  return (
    <div>
      <PageHeader crumbs={[{ label: "Design", href: "/design" }, { label: "Preliminary layouts" }]} title="Preliminary layouts" sub="Roof plan sheets for the customer — PV arrays, dimensions, system information and title block, ready to print as PDF." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="All layouts" flush>
          {rows.length === 0 ? <EmptyState icon="panel" title="No layouts yet" body="Start one from a project or lead on the right — it pre-fills the customer, address, roof type and capacity from the site file." /> : (
            <table className="tbl"><thead><tr><th>Sheet</th><th>Customer</th><th>Project / lead</th><th>Rev</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id} className="row-link"><td><Link className="lnk num" href={`/design/layouts/${r.id}`}>{r.sheet_no ?? r.code}</Link><div className="text-xs text-faint">{r.code}</div></td><td className="font-semibold">{String(r.title).replace(" — preliminary layout", "")}</td><td className="num text-xs">{r.project_code ?? r.lead_code ?? "—"}</td><td>{r.rev}</td><td><StatusBadge status={r.status} tone={r.status === "ISSUED" ? "green" : "gray"} /></td><td className="text-xs text-muted">{fmtDateTime(r.updated_at)}</td></tr>)}</tbody></table>)}
        </Card>
        {w && (
          <div className="space-y-5">
            <Card title="From projects" flush actions={<span className="text-xs text-faint">new projects appear here</span>}>
              {projects.length === 0 ? <p className="p-4 text-[13px] text-muted">No active projects yet.</p> : (
                <ul className="max-h-[320px] overflow-y-auto">{projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 last:border-0">
                    <span className="min-w-0 text-[13px]"><b className="block truncate">{p.name}</b><span className="text-xs text-muted num">{p.code} · {fmtKw(p.capacity_kw)}</span></span>
                    {p.layout_id ? <Link href={`/design/layouts/${p.layout_id}`} className="btn btn-sm">Open</Link> : <ActionButton action={createLayoutForProjectAction.bind(null, p.id)} className="btn btn-sm btn-primary">Create</ActionButton>}
                  </li>))}</ul>)}
            </Card>
            <Card title="From leads (pre-sales)" flush actions={<span className="text-xs text-faint">no project yet</span>}>
              {leads.length === 0 ? <p className="p-4 text-[13px] text-muted">Nothing waiting.</p> : (
                <ul className="max-h-[320px] overflow-y-auto">{leads.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 last:border-0"><span className="min-w-0 text-[13px]"><b className="block truncate">{l.name}</b><span className="text-xs text-muted num">{l.code}</span></span><ActionButton action={createLayoutAction.bind(null, l.id)} className="btn btn-sm btn-primary">Create</ActionButton></li>)}</ul>)}
            </Card>
          </div>)}
      </div>
    </div>
  );
}
