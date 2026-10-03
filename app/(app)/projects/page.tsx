import Link from "next/link";
import { guard } from "@/lib/auth";
import { PROJECT_STAGES, label } from "@/lib/config";
import { listProjects, refreshAllHealth } from "@/lib/services/projects";
import { PageHeader, Card, StatusBadge, EmptyState, ProgressBar, Pagination } from "@/components/ui";
import { SearchBox } from "@/components/client";
import { fmtKw, inrShort, fmtDate } from "@/lib/util";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("projects");
  const sp = await searchParams;
  refreshAllHealth();
  const all = listProjects({ q: sp.q, stage: sp.stage, health: sp.health === "DELAYED" ? undefined : sp.health, pm: sp.mine ? user.id : undefined });
  const rows = sp.health === "DELAYED" ? all.filter((p) => ["DELAYED", "BLOCKED"].includes(p.health)) : all;
  const page = Math.max(1, Number(sp.page) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice((page - 1) * PAGE, page * PAGE);
  const href = (o: Record<string, string | undefined>) => { const p = new URLSearchParams({ ...(sp.q && { q: sp.q }), ...(sp.stage && { stage: sp.stage }), ...(sp.health && { health: sp.health }), ...(sp.mine && { mine: "1" }), ...(o as any) }); [...p.keys()].forEach((k) => !p.get(k) && p.delete(k)); return `/projects?${p}`; };
  return (
    <div>
      <PageHeader title="Projects" sub={`${rows.length} project${rows.length === 1 ? "" : "s"}${sp.health ? ` · ${label(sp.health)}` : ""}${sp.stage ? ` · ${label(sp.stage)}` : ""}`} actions={<SearchBox defaultValue={sp.q} placeholder="Search projects…" />} />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link href={href({ stage: undefined, health: undefined, page: undefined })} className={`btn btn-sm ${!sp.stage && !sp.health ? "btn-dark" : ""}`}>All</Link>
        {["ON_TRACK", "AT_RISK", "DELAYED", "BLOCKED"].map((h) => <Link key={h} href={href({ health: h, stage: undefined, page: undefined })} className={`btn btn-sm ${sp.health === h ? "btn-dark" : ""}`}>{label(h)}</Link>)}
        <span className="mx-1 h-5 w-px bg-line" />
        {PROJECT_STAGES.filter((s) => s !== "PROJECT_CREATED").map((s) => <Link key={s} href={href({ stage: s, health: undefined, page: undefined })} className={`btn btn-sm ${sp.stage === s ? "btn-dark" : ""}`}>{label(s)}</Link>)}
        <Link href={href({ mine: sp.mine ? undefined : "1", page: undefined })} className={`btn btn-sm ${sp.mine ? "btn-dark" : ""}`}>My projects</Link>
      </div>
      <Card flush>
        {view.length === 0 ? <EmptyState icon="layers" title="No projects match" body="Projects are created automatically when a proposal is accepted." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Project</th><th>Customer</th><th className="r">Capacity</th><th>Stage</th><th>Health</th><th style={{ width: 130 }}>Installation</th><th>PM</th><th className="r">Value</th><th>Target</th></tr></thead>
            <tbody>{view.map((p) => (
              <tr key={p.id}>
                <td><Link className="lnk num" href={`/projects/${p.id}`}>{p.code}</Link></td><td className="font-semibold">{p.customer_name}</td><td className="r num">{fmtKw(p.capacity_kw)}</td>
                <td><StatusBadge status={p.stage} tone={p.stage === "COMPLETED" ? "green" : "navy"} /></td><td><StatusBadge status={p.health} /></td>
                <td>{p.install_progress > 0 ? <div className="flex items-center gap-2"><div className="flex-1"><ProgressBar value={p.install_progress} /></div><span className="num text-xs text-muted">{p.install_progress}%</span></div> : <span className="text-faint">—</span>}</td>
                <td>{p.pm_name ?? "—"}</td><td className="r num">{inrShort(p.value)}</td><td>{fmtDate(p.target_end)}</td>
              </tr>))}</tbody>
          </table></div>)}
        <Pagination page={page} pages={pages} total={rows.length} href={(n) => href({ page: String(n) })} />
      </Card>
    </div>
  );
}
