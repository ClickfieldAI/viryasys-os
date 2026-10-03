import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { rules, recentRuns, TRIGGERS, ACTION_LABELS } from "@/lib/services/automation";
import { PageHeader, Card, EmptyState, Icon } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { toggleRuleAction } from "@/app/actions/system";
import { timeAgo } from "@/lib/util";

export const metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

export default async function Automation() {
  const user = await guard("automation");
  const rs = rules();
  const runs = recentRuns(12);
  const w = can(user.role, "automation", "w");
  return (
    <div>
      <PageHeader title="Automation" sub="Trigger → condition → action. The business services fire these rules; switching one off really stops that step." />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          {rs.map((r) => {
            const actions = JSON.parse(r.actions) as any[];
            const conds = JSON.parse(r.conditions) as any[];
            return (
              <div key={r.id} className={`card p-4 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><div className="text-[14px] font-extrabold">{r.name}</div><div className="mt-0.5 text-xs text-muted">{r.runs} runs{r.last_run_at ? ` · last ${timeAgo(r.last_run_at)}` : ""}</div></div>
                  {w ? <ActionButton action={toggleRuleAction.bind(null, r.id, !r.enabled)} className={`btn btn-sm ${r.enabled ? "btn-primary" : ""}`}>{r.enabled ? "On" : "Off"}</ActionButton> : <span className={`badge ${r.enabled ? "b-green" : ""}`}>{r.enabled ? "On" : "Off"}</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="badge b-blue">WHEN {TRIGGERS[r.trigger] ?? r.trigger}</span>
                  {conds.length > 0 && <><Icon name="arrow" size={12} className="text-faint" /><span className="badge b-solar">IF {conds.map((c) => `${c.field} ${c.op} ${c.value}`).join(" and ")}</span></>}
                  {actions.map((a, i) => <span key={i} className="flex items-center gap-2"><Icon name="arrow" size={12} className="text-faint" /><span className="badge b-green">{ACTION_LABELS[a.type] ?? a.type}</span></span>)}
                </div>
              </div>);
          })}
        </div>
        <Card title="Recent runs" flush>
          {runs.length === 0 ? <EmptyState icon="bolt" title="No runs yet" /> : <ul>{runs.map((x) => <li key={x.id} className="border-b border-line px-4 py-2.5 last:border-0"><div className="flex justify-between gap-2 text-[13px]"><span className="font-semibold">{x.rule_name}</span><span className="text-xs text-faint">{timeAgo(x.at)}</span></div><div className="mt-0.5 break-words text-xs text-muted">{x.result}</div></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
