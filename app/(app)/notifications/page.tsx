import Link from "next/link";
import { guard } from "@/lib/auth";
import { notificationsFor } from "@/lib/services/core";
import { PageHeader, Card, EmptyState, Icon } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { markNotificationsReadAction } from "@/app/actions/ops";
import { timeAgo, fmtDateTime } from "@/lib/util";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
const ICON: Record<string, string> = { new_lead: "funnel", sla_warning: "clock", sla_breach: "alert", task_assigned: "list", site_survey_scheduled: "calendar", design_ready: "layers", proposal_ready: "file", proposal_approved: "check", payment_received: "wallet", procurement_delay: "truck", material_received: "cube", installation_milestone: "tool", customer_query: "chat", project_delay: "alert", ai_review: "sparkle" };
const BAD = new Set(["sla_breach", "procurement_delay", "project_delay"]);

export default async function Notifications() {
  const user = await guard("dashboard");
  const rows = notificationsFor(user, 100);
  return (
    <div>
      <PageHeader title="Notifications" sub={`${rows.filter((r) => !r.is_read).length} unread`} actions={rows.some((r) => !r.is_read) ? <ActionButton action={markNotificationsReadAction.bind(null, undefined)} className="btn">Mark all read</ActionButton> : undefined} />
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="bell" title="You’re all caught up" body="Lead alerts, SLA warnings, delays, payments and assignments show up here." /> : (
          <ul>{rows.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 border-b border-line px-4 py-3 last:border-0 ${n.is_read ? "" : "bg-[#f7fbf8]"}`}>
              <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${BAD.has(n.type) ? "bg-[var(--red-50)] text-[var(--red)]" : "bg-[var(--green-50)] text-[var(--green-700)]"}`}><Icon name={ICON[n.type] ?? "bell"} size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2"><div className={`text-[13.5px] ${n.is_read ? "font-semibold" : "font-extrabold"}`}>{n.link ? <Link className="hover:underline" href={n.link}>{n.title}</Link> : n.title}</div><span className="shrink-0 text-[11px] text-faint" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</span></div>
                {n.body && <div className="text-xs text-muted">{n.body}</div>}
              </div>
              {!n.is_read && <ActionButton action={markNotificationsReadAction.bind(null, n.id)} className="btn btn-ghost btn-sm" title="Mark read"><Icon name="check" size={14} /></ActionButton>}
            </li>))}</ul>)}
      </Card>
    </div>
  );
}
