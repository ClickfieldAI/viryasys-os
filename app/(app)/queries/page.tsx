import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { listQueries } from "@/lib/services/misc";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, Field } from "@/components/ui";
import { ModalButton, ActionForm } from "@/components/client";
import { Select } from "@/components/forms";
import { updateQueryAction, createQueryAction } from "@/app/actions/ops";
import { fmtDate, dateOnly } from "@/lib/util";

export const metadata = { title: "Customer Queries" };
export const dynamic = "force-dynamic";
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"];

export default async function Queries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("queries");
  const sp = await searchParams;
  const rows = listQueries({ status: sp.status });
  const w = can(user.role, "queries", "w");
  const today = dateOnly(new Date());
  const projects = getDb().prepare("SELECT id, code, name FROM projects WHERE stage != 'COMPLETED' ORDER BY id DESC LIMIT 100").all() as any[];
  return (
    <div>
      <PageHeader title="Customer queries" sub="Raised by customers in the portal or logged by the team."
        actions={w && (
          <ModalButton label="Log query" icon="plus" title="Log a customer query" width={500}>
            <ActionForm action={createQueryAction} submitLabel="Log query" className="space-y-3">
              <Field label="Project *"><Select name="project_id" required placeholder="Select…" options={projects.map((p) => [String(p.id), `${p.code} — ${p.name}`] as [string, string])} /></Field>
              <Field label="Subject *"><input name="subject" required className="input" /></Field>
              <Field label="Description"><textarea name="description" rows={3} className="input" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Priority"><Select name="priority" defaultValue="medium" options={["high", "medium", "low"]} /></Field><Field label="Due"><input name="due_date" type="date" className="input" /></Field></div>
            </ActionForm>
          </ModalButton>)} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/queries" className={`btn btn-sm ${!sp.status ? "btn-dark" : ""}`}>All</Link>
        {STATUSES.map((s) => <Link key={s} href={`/queries?status=${s}`} className={`btn btn-sm ${sp.status === s ? "btn-dark" : ""}`}>{s.replace("_", " ")}</Link>)}
      </div>
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="chat" title="No queries" /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>ID</th><th>Subject</th><th>Customer / project</th><th>Priority</th><th>Assigned</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.code}</td><td className="font-semibold">{q.subject}{q.resolution && <div className="text-xs font-normal text-muted">Resolution: {q.resolution}</div>}</td>
                <td>{q.customer_name}<div className="text-xs text-muted">{q.project_code}</div></td><td><StatusBadge status={q.priority} /></td><td>{q.assignee ?? "—"}</td>
                <td className={q.due_date && q.due_date < today && !["RESOLVED", "CLOSED"].includes(q.status) ? "font-bold text-[var(--red)]" : ""}>{fmtDate(q.due_date)}</td><td><StatusBadge status={q.status} /></td>
                <td className="r">{w && !["CLOSED"].includes(q.status) && (
                  <ModalButton label="Update" title={`${q.code} — ${q.subject}`} className="btn btn-sm" width={460}>
                    <ActionForm action={updateQueryAction.bind(null, q.id)} submitLabel="Update" className="space-y-3" resetOnSuccess={false}>
                      <p className="text-[13px] text-muted">{q.description}</p>
                      <Field label="Status"><Select name="status" defaultValue={q.status} options={STATUSES} /></Field>
                      <Field label="Resolution" hint="Required to resolve or close"><textarea name="resolution" rows={2} defaultValue={q.resolution ?? ""} className="input" /></Field>
                    </ActionForm>
                  </ModalButton>)}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
