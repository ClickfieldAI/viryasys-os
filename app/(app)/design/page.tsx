import Link from "next/link";
import { guard } from "@/lib/auth";
import { designTasks } from "@/lib/services/design";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDate, fmtKw } from "@/lib/util";

export const metadata = { title: "Design" };
export const dynamic = "force-dynamic";

export default async function DesignQueue() {
  const user = await guard("design");
  let tasks = designTasks();
  if (user.role === "designer") tasks = tasks.filter((t) => t.designer_id === user.id);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader title="Design" sub={user.role === "designer" ? "Your assigned design tasks." : "Design tasks created automatically when a site survey is submitted."}
        actions={<Link href="/design/calculator" className="btn">Solar calculator</Link>} />
      <Card flush>
        {tasks.length === 0 ? <EmptyState icon="layers" title="No design tasks" body="A task appears here the moment a site survey is submitted." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Lead</th><th>Designer</th><th className="r">Requested</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id}>
                <td><Link className="lnk" href={`/design/${t.id}`}>{t.lead_code}</Link><div className="text-xs text-muted">{t.lead_title}</div></td>
                <td>{t.designer_name ?? "Unassigned"}</td>
                <td className="r num">{fmtKw(t.capacity_kw)}</td>
                <td className={t.status !== "COMPLETED" && t.due_at?.slice(0, 10) < today ? "font-bold text-[var(--red)]" : ""}>{fmtDate(t.due_at)}</td>
                <td><StatusBadge status={t.status} tone={t.status === "COMPLETED" ? "green" : t.status === "IN_PROGRESS" ? "orange" : "gray"} /></td>
                <td className="r"><Link className="btn btn-sm" href={`/design/${t.id}`}>{t.status === "COMPLETED" ? "View" : "Open"}</Link></td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
