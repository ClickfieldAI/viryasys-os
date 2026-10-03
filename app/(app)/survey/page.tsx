import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { startSurveyAction } from "@/app/actions/work";
import { fmtDateTime, fmtKw } from "@/lib/util";

export const metadata = { title: "Site Surveys" };
export const dynamic = "force-dynamic";

export default async function SurveyList() {
  const user = await guard("survey");
  const db = getDb();
  const w = can(user.role, "survey", "w");
  const visits = db.prepare(
    `SELECT v.*, l.code lead_code, l.title, l.capacity_kw, p.name pm_name, (SELECT id FROM site_surveys s WHERE s.lead_id = v.lead_id ORDER BY id DESC LIMIT 1) survey_id
     FROM site_visits v JOIN leads l ON l.id = v.lead_id LEFT JOIN users p ON p.id = v.pm_id WHERE v.status = 'SCHEDULED' ORDER BY v.scheduled_at`
  ).all() as any[];
  const surveys = db.prepare(
    `SELECT s.*, l.code lead_code, l.title, l.capacity_kw, u.name pm_name FROM site_surveys s JOIN leads l ON l.id = s.lead_id LEFT JOIN users u ON u.id = s.pm_id ORDER BY s.status = 'SUBMITTED', s.id DESC LIMIT 60`
  ).all() as any[];
  return (
    <div>
      <PageHeader title="Site Surveys" sub="Scheduled visits and digital surveys. The PM captures everything on site, from a phone." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Upcoming site visits" flush>
          {visits.length === 0 ? <EmptyState icon="calendar" title="No visits scheduled" body="Schedule a site visit from a qualified lead." /> : (
            <ul>{visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-0">
                <div className="min-w-0"><Link className="lnk text-[13.5px]" href={`/crm/leads/${v.lead_id}?tab=visit`}>{v.title}</Link><div className="text-xs text-muted">{fmtDateTime(v.scheduled_at)} · {v.location} · PM {v.pm_name ?? "—"}</div></div>
                {w && (v.survey_id ? <Link className="btn btn-sm" href={`/survey/${v.survey_id}`}>Open survey</Link> : <ActionButton action={startSurveyAction.bind(null, v.lead_id)} className="btn btn-sm btn-primary">Start survey</ActionButton>)}
              </li>))}</ul>)}
        </Card>
        <Card title="Surveys" flush>
          {surveys.length === 0 ? <EmptyState icon="file" title="No surveys yet" /> : (
            <ul>{surveys.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-0">
                <div className="min-w-0"><Link className="lnk text-[13.5px]" href={`/survey/${s.id}`}>{s.lead_code} · {s.title}</Link><div className="text-xs text-muted">{s.pm_name ?? "—"} · {s.site_address ?? "address pending"}</div></div>
                <StatusBadge status={s.status} tone={s.status === "SUBMITTED" ? "green" : "orange"}>{label(s.status)}</StatusBadge>
              </li>))}</ul>)}
        </Card>
      </div>
    </div>
  );
}
