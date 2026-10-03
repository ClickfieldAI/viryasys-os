import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { followUps, slaTick } from "@/lib/services/leads";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ToggleCheck } from "@/components/client";
import { completeTaskAction } from "@/app/actions/crm";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

export default async function FollowUps() {
  const user = await guard("crm");
  slaTick();
  const f = followUps();
  const w = can(user.role, "crm", "w");
  const group = (title: string, rows: any[], tone?: string) => (
    <Card title={<span className="flex items-center gap-2">{title}<span className="rounded-full bg-[#eef1f4] px-1.5 text-[11px] text-muted">{rows.length}</span></span>} flush>
      {rows.length === 0 ? <EmptyState icon="check" title="Nothing here" /> : (
        <ul>{rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-0">
            <div className="min-w-0">
              {w ? <ToggleCheck checked={false} action={completeTaskAction.bind(null, t.id)} label={t.title} /> : <span className="text-[13px]">{t.title}</span>}
              <div className="ml-6 text-xs text-muted">{t.kind === "proposal_idle" && <span className="badge b-orange mr-1.5">Proposal idle</span>}<Link className="lnk" href={`/crm/leads/${t.lead_id}`}>{t.lead_code}</Link> · {t.lead_title}</div>
            </div>
            <div className="text-right text-xs"><div className={tone === "bad" ? "font-bold text-[var(--red)]" : "text-muted"}>{t.due_at ? fmtDateTime(t.due_at) : "No due date"}</div><div className="text-faint">{t.assignee}</div></div>
          </li>))}</ul>)}
    </Card>
  );
  return (
    <div>
      <PageHeader title="Follow-ups" sub="Everything the sales team has promised — in one queue." />
      <div className="grid gap-5 lg:grid-cols-3">{group("Overdue", f.overdue, "bad")}{group("Today", f.today)}{group("Upcoming", f.upcoming)}</div>
    </div>
  );
}
