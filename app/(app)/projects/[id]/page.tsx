import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, PROJECT_STAGES, label } from "@/lib/config";
import { projectFull, refreshHealth } from "@/lib/services/projects";
import { itemLines, requirementRows } from "@/lib/services/procurement";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, Tabs, Track, Timeline, EmptyState, ProgressBar, Field } from "@/components/ui";
import { ActionButton, ActionForm, ToggleCheck, ModalButton } from "@/components/client";
import { addPlanTaskAction, removePlanTaskAction, setMilestoneDueAction, createLayoutForProjectAction } from "@/app/actions/work";
import { advanceStageAction, toggleProjectTaskAction, toggleHandoverAction, logInstallAction, createQueryAction, createInvoiceAction } from "@/app/actions/ops";
import { fmtKw, inr, fmtDate, fmtDateTime, dateOnly } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await guard("projects");
  const id = Number((await params).id);
  const tab = (await searchParams).tab ?? "overview";
  refreshHealth(id);
  const d = projectFull(id);
  if (!d) notFound();
  const { p, milestones, tasks, activities, installLogs, steps, handover, payments, health, gate } = d;
  const w = can(user.role, "projects", "w");
  const db = getDb();
  const layout = db.prepare("SELECT id, json_extract(sheet,'$.sheet_no') sheet_no FROM layouts WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(id) as any;
  const today = dateOnly(new Date());
  const staff = db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role IN ('pm','site_engineer','designer','procurement','warehouse') ORDER BY name").all() as any[];
  const plines = itemLines({ project_id: id });
  const preqs = requirementRows(id);
  const poIds = [...new Set(plines.map((l) => l.po_id))];
  const pos = poIds.map((pid) => ({ po: (db.prepare("SELECT o.*, v.name vendor_name FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id WHERE o.id = ?").get(pid) as any), items: plines.filter((l) => l.po_id === pid) }));
  const invoices = db.prepare("SELECT i.*, (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = i.id) paid FROM invoices i WHERE project_id = ? ORDER BY id").all(id) as any[];
  const docs = db.prepare("SELECT * FROM documents WHERE project_id = ? ORDER BY id DESC").all(id) as any[];
  const queries = db.prepare("SELECT * FROM customer_queries WHERE project_id = ? ORDER BY id DESC").all(id) as any[];
  const equipment = p.equipment ? JSON.parse(p.equipment) : null;
  const curIdx = PROJECT_STAGES.indexOf(p.stage);
  const track = PROJECT_STAGES.map((s, i) => {
    const m = milestones.find((x: any) => x.stage === s);
    const late = m && m.status !== "DONE" && m.due_date < today && i <= curIdx;
    return { label: label(s), state: (i < curIdx || s === "COMPLETED" && p.stage === "COMPLETED" ? "done" : late ? "late" : i === curIdx ? "current" : "todo") as any };
  });
  const tabs = [{ key: "overview", label: "Job card" }, { key: "stages", label: "Stages & tasks" }, { key: "install", label: "Installation" }, { key: "procure", label: "Procurement", count: pos.length }, { key: "money", label: "Payments" }, { key: "docs", label: "Documents", count: docs.length }, { key: "queries", label: "Queries", count: queries.length }, { key: "activity", label: "Activity" }];
  const base = `/projects/${id}`;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Projects", href: "/projects" }, { label: p.code }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{p.name}<StatusBadge status={p.stage} tone={p.stage === "COMPLETED" ? "green" : "navy"} /><StatusBadge status={health.health} /></span>}
        sub={`${p.code} · ${p.customer_name} · ${p.city ?? ""} · PM ${p.pm_name ?? "—"}`}
        actions={w && p.stage !== "COMPLETED" ? (
          gate.ok
            ? <ActionButton action={advanceStageAction.bind(null, id)} className="btn btn-primary" confirm={`Move to ${label(gate.next)}?`} confirmLabel="Advance">Advance to {label(gate.next)}</ActionButton>
            : <ModalButton label={`Advance to ${label(gate.next)}`} title="Can't advance yet" className="btn" width={460}><ul className="space-y-2 text-[13px]">{gate.blockers.map((b) => <li key={b} className="flex gap-2"><span className="text-[var(--red)]">●</span>{b}</li>)}</ul></ModalButton>
        ) : undefined} />

      <div className="card mb-5 p-4"><Track steps={track} /></div>
      {health.reasons.length > 0 && (
        <div className={`mb-5 rounded-lg border p-3 text-[13px] ${["DELAYED", "BLOCKED"].includes(health.health) ? "border-[#e7c3c0] bg-[var(--red-50)]" : "border-[#f0d9a8] bg-[var(--solar-50)]"}`}>
          <b>Why {label(health.health).toLowerCase()}:</b> {health.reasons.join(" · ")}
        </div>)}

      <Tabs tabs={tabs} active={tab} base={base} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Digital job card" className="lg:col-span-2">
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {([["Project ID", p.code], ["Customer", p.customer_name], ["Site", p.site], ["Capacity", fmtKw(p.capacity_kw)], ["Project manager", p.pm_name ?? "—"], ["Designer", p.designer_name ?? "—"], ["Site engineer", p.engineer_name ?? "—"], ["Current stage", label(p.stage)], ["Start", fmtDate(p.start_date)], ["Target completion", fmtDate(p.target_end)], ["Contract value", inr(p.value)]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{v}</dd></div>)}
              {equipment && <><div className="sm:col-span-2"><dt className="eyebrow">Equipment</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{equipment.panels} · {equipment.inverters}{equipment.structure ? ` · ${equipment.structure}` : ""}</dd></div></>}
            </dl>
            <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 text-xs">
              {p.lead_id && <Link className="lnk" href={`/crm/leads/${p.lead_id}`}>Lead {p.lead_code}</Link>}
              {p.proposal_id && <Link className="lnk" href={`/proposals/${p.proposal_id}`}>Proposal {p.proposal_code}</Link>}
              {p.customer_id && <Link className="lnk" href={`/crm/customers/${p.customer_id}`}>Customer {p.customer_code}</Link>}
              {layout ? <Link className="lnk" href={`/design/layouts/${layout.id}`}>Preliminary layout {layout.sheet_no}</Link> : can(user.role, "design", "w") && <ActionButton action={createLayoutForProjectAction.bind(null, id)} className="lnk">Create preliminary layout</ActionButton>}
            </div>
          </Card>
          <div className="space-y-5">
            <Card title="Installation"><div className="mb-2 flex justify-between text-[13px]"><span className="text-muted">Overall</span><span className="num font-bold">{p.install_progress}%</span></div><ProgressBar value={p.install_progress} /></Card>
            <Card title="Payments" flush>
              {payments.length === 0 ? <EmptyState title="No schedule" /> : <ul>{payments.map((m: any) => <li key={m.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px] last:border-0"><span>{m.name} <span className="text-faint">· {m.pct}%</span></span><span className="flex items-center gap-2"><span className="num font-semibold">{inr(m.amount)}</span><StatusBadge status={m.status} /></span></li>)}</ul>}
            </Card>
          </div>
        </div>
      )}

      {tab === "stages" && (
        <div className="space-y-4">
          {w && <div className="rounded-xl bg-[var(--green-50)] p-3 text-[13px] text-[var(--green-700)]"><b>Project plan.</b> Add your own tasks to any stage, assign them to the team, and adjust stage due dates. Everyone assigned is notified.</div>}
          {PROJECT_STAGES.filter((s) => s !== "PROJECT_CREATED" && s !== "COMPLETED").map((s) => {
            const m = milestones.find((x: any) => x.stage === s);
            const ts = tasks.filter((t: any) => t.stage === s);
            const late = m && m.status !== "DONE" && m.due_date < today;
            return (
              <Card key={s} title={<span className="flex items-center gap-2">{m?.name ?? label(s)} <StatusBadge status={m?.status} tone={m?.status === "DONE" ? "green" : late ? "red" : m?.status === "CURRENT" ? "orange" : "gray"}>{late ? "Delayed" : label(m?.status)}</StatusBadge></span>} actions={<span className="text-xs text-muted">Owner {m?.owner ?? "—"} · Due <b className={late ? "text-[var(--red)]" : ""}>{fmtDate(m?.due_date)}</b>{m?.done_at ? ` · Done ${fmtDate(m.done_at)}` : ""}</span>}>
                {ts.length === 0 ? <p className="text-[13px] text-muted">No tasks for this stage.</p> : <div className="space-y-2.5">{ts.map((t: any) => w ? <div key={t.id} className="flex items-center justify-between gap-2"><ToggleCheck checked={t.status === "done"} action={toggleProjectTaskAction.bind(null, t.id)} label={t.title} />{t.status !== "done" && <ActionButton action={removePlanTaskAction.bind(null, t.id)} className="text-xs text-faint hover:text-[var(--red)]" confirm="Remove this task from the plan?" confirmLabel="Remove">Remove</ActionButton>}</div> : <div key={t.id} className="text-[13px]">{t.status === "done" ? "✓" : "○"} {t.title}</div>)}</div>}
                {w && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    <ModalButton label="Add task" icon="plus" title={`Add task — ${m?.name ?? label(s)}`} className="btn btn-sm" width={460}>
                      <ActionForm action={addPlanTaskAction.bind(null, id)} submitLabel="Add task" className="space-y-3">
                        <input type="hidden" name="stage" value={s} />
                        <Field label="Task *"><input name="title" required className="input" placeholder="e.g. Confirm roof load-bearing report" /></Field>
                        <Field label="Due date"><input name="due" type="date" defaultValue={m?.due_date ?? ""} className="input" /></Field>
                        <Field label="Assign to"><select name="assignee_id" className="input" defaultValue=""><option value="">Project manager (default)</option>{staff.map((u: any) => <option key={u.id} value={u.id}>{u.name} · {label(u.role)}</option>)}</select></Field>
                      </ActionForm>
                    </ModalButton>
                    {m && m.status !== "DONE" && (
                      <ModalButton label="Change due date" icon="edit" title={`${m.name} — due date`} className="btn btn-sm" width={380}>
                        <ActionForm action={setMilestoneDueAction.bind(null, m.id)} submitLabel="Save date" className="space-y-3" resetOnSuccess={false}><Field label="Due date"><input name="due" type="date" required defaultValue={m.due_date} className="input" /></Field></ActionForm>
                      </ModalButton>)}
                  </div>)}
              </Card>);
          })}
          <Card title="Handover checklist" actions={<span className="text-xs text-muted">{handover.filter((h: any) => h.done).length} / {handover.length} complete</span>}>
            <div className="grid gap-2.5 sm:grid-cols-2">{handover.map((h: any) => w ? <ToggleCheck key={h.id} checked={!!h.done} action={toggleHandoverAction.bind(null, h.id)} label={h.label} /> : <div key={h.id} className="text-[13px]">{h.done ? "✓" : "○"} {h.label}</div>)}</div>
            <p className="hint mt-3">The project becomes COMPLETED only when every handover item is checked.</p>
          </Card>
        </div>
      )}

      {tab === "install" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Installation progress" className="lg:col-span-1">
            <div className="mb-1 text-3xl font-extrabold num">{p.install_progress}%</div>
            <ProgressBar value={p.install_progress} />
            <ul className="mt-4 space-y-3">{steps.map((s: any) => <li key={s.id}><div className="mb-1 flex justify-between text-[13px]"><span className="font-semibold">{s.name} {s.pct >= 100 && <span className="text-[var(--green-600)]">✓</span>}</span><span className="num text-muted">{s.pct >= 100 ? "Done" : s.pct === 0 ? "Pending" : `${s.pct}%`}</span></div><ProgressBar value={s.pct} /></li>)}</ul>
            {!["INSTALLATION", "COMMISSIONING", "METERING", "HANDOVER", "COMPLETED"].includes(p.stage) && (
              <p className="mt-4 rounded-lg bg-[var(--sunk)] p-3 text-xs text-muted">
                Daily progress logging opens once this project reaches <b className="text-ink">Installation</b>. It's currently at <b className="text-ink">{label(p.stage)}</b>
                {" — "}{PROJECT_STAGES.slice(PROJECT_STAGES.indexOf(p.stage) + 1, PROJECT_STAGES.indexOf("INSTALLATION")).map((s) => label(s)).join(" → ") || "one step"} to go.
                {w && <> See <a className="lnk" href={`${base}?tab=stages`}>Stages &amp; tasks</a> for what's blocking the advance.</>}
              </p>)}
            {w && ["INSTALLATION", "COMMISSIONING"].includes(p.stage) && (
              <ModalButton label="Log today's progress" icon="plus" title="Daily installation log" className="btn btn-primary mt-4 w-full" width={560}>
                <ActionForm action={logInstallAction.bind(null, id)} submitLabel="Save log" className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Date"><input name="log_date" type="date" defaultValue={today} className="input" /></Field>
                    <Field label="Team"><input name="team" defaultValue="Team A" className="input" /></Field>
                    <Field label="Workers"><input name="workers" type="number" min="0" defaultValue={10} className="input" /></Field>
                  </div>
                  <Field label="Work completed *"><textarea name="work_done" required rows={2} className="input" /></Field>
                  <div className="grid gap-2 sm:grid-cols-2">{steps.map((s: any) => <Field key={s.id} label={`${s.name} (%)`}><input name={`step_${s.id}`} type="number" min="0" max="100" defaultValue={s.pct} className="input" /></Field>)}</div>
                  <Field label="Issues / delays"><input name="issues" className="input" /></Field>
                </ActionForm>
              </ModalButton>)}
          </Card>
          <Card title="Daily log" className="lg:col-span-2" flush>
            {installLogs.length === 0 ? <EmptyState icon="tool" title="No installation logs yet" body="Site teams log daily progress once installation begins." /> : (
              <table className="tbl"><thead><tr><th>Date</th><th>Team</th><th className="r">Workers</th><th>Work completed</th><th className="r">Progress</th><th>Issues</th></tr></thead><tbody>{installLogs.map((l: any) => <tr key={l.id}><td>{fmtDate(l.log_date)}</td><td>{l.team}</td><td className="r num">{l.workers}</td><td>{l.work_done}</td><td className="r num font-semibold">{l.progress_pct}%</td><td className="text-[var(--orange)]">{l.issues ?? ""}</td></tr>)}</tbody></table>)}
          </Card>
        </div>
      )}

      {tab === "procure" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between"><p className="text-[13px] text-muted">Procurement is authorized once the customer order is approved and the required advance is received.</p><Link className="btn btn-sm" href={`/procurement/plans/${id}`}>Open procurement plan</Link></div>
          {pos.length === 0 ? <Card><EmptyState icon="truck" title="No purchase orders yet" body={preqs.length ? "Procurement is authorized — purchase orders will appear as procurement raises them." : "Procurement is locked until the customer advance is received."} /></Card> : (
            pos.map((x) => (
              <Card key={x.po.id} title={<span className="flex items-center gap-2"><Link className="lnk num" href={`/procurement/${x.po.id}`}>{x.po.code}</Link><span className="font-normal text-muted">{x.po.vendor_name ?? "No vendor"}</span></span>} actions={<StatusBadge status={x.po.status} />} flush>
                <table className="tbl"><thead><tr><th>Item</th><th className="r">Qty</th><th>Expected</th><th className="r">Received</th><th>Status</th></tr></thead><tbody>{x.items.map((i) => (
                  <tr key={i.id}><td>{i.description}</td><td className="r num">{i.qty} {i.unit}</td>
                    <td>{i.promise_count > 1 ? <span><s className="text-faint">{fmtDate(i.original_expected)}</s> <b className={i.status === "DELAYED" ? "text-[var(--red)]" : ""}>{fmtDate(i.expected_date)}</b></span> : fmtDate(i.expected_date)}</td>
                    <td className="r num">{i.accepted + i.pending_inspection}/{i.target}</td><td><StatusBadge status={i.status === "DELAYED" ? "delayed" : i.status}>{i.status === "DELAYED" ? `Delayed ${i.delay_days}d` : undefined}</StatusBadge></td></tr>))}</tbody></table>
              </Card>)))}
        </div>
      )}

      {tab === "money" && (
        <Card title="Payment milestones & invoices" flush>
          <table className="tbl"><thead><tr><th>Milestone</th><th className="r">Share</th><th className="r">Amount</th><th>Invoice</th><th className="r">Paid</th><th>Status</th><th /></tr></thead><tbody>{payments.map((m: any) => {
            const inv = invoices.find((i) => i.id === m.invoice_id);
            return <tr key={m.id}><td className="font-semibold">{m.name}</td><td className="r num">{m.pct}%</td><td className="r num">{inr(m.amount)}</td><td>{inv ? <><span className="num">{inv.code}</span> <StatusBadge status={inv.status} /></> : <span className="text-faint">—</span>}</td><td className="r num">{inv ? inr(inv.paid) : "—"}</td><td><StatusBadge status={m.status} /></td>
              <td className="r"></td></tr>; })}</tbody></table>
        </Card>
      )}

      {tab === "docs" && (
        <Card title="Documents" flush actions={<Link className="lnk text-xs" href={`/documents?project=${id}`}>Document centre</Link>}>
          {docs.length === 0 ? <EmptyState icon="folder" title="No documents" /> : <table className="tbl"><thead><tr><th>Name</th><th>Type</th><th>Customer portal</th><th>Added</th></tr></thead><tbody>{docs.map((x: any) => <tr key={x.id}><td className="font-semibold">{x.file_path ? <a className="lnk" href={`/api/files/${x.file_path}`} target="_blank">{x.name}</a> : x.name}</td><td>{x.doc_type}</td><td>{x.customer_visible ? <span className="badge b-green">Visible</span> : <span className="badge">Internal</span>}</td><td>{fmtDate(x.created_at)}</td></tr>)}</tbody></table>}
        </Card>
      )}

      {tab === "queries" && (
        <Card title="Customer queries" flush actions={can(user.role, "queries", "w") && (
          <ModalButton label="Log query" icon="plus" title="Log a customer query" className="btn btn-sm" width={480}>
            <ActionForm action={createQueryAction} submitLabel="Log query" className="space-y-3">
              <input type="hidden" name="project_id" value={id} />
              <Field label="Subject *"><input name="subject" required className="input" /></Field>
              <Field label="Description"><textarea name="description" rows={3} className="input" /></Field>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Priority"><select name="priority" className="input" defaultValue="medium"><option>high</option><option>medium</option><option>low</option></select></Field><Field label="Due"><input name="due_date" type="date" className="input" /></Field></div>
            </ActionForm>
          </ModalButton>)}>
          {queries.length === 0 ? <EmptyState icon="chat" title="No queries" /> : <table className="tbl"><thead><tr><th>ID</th><th>Subject</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead><tbody>{queries.map((q: any) => <tr key={q.id}><td className="num">{q.code}</td><td className="font-semibold">{q.subject}</td><td><StatusBadge status={q.priority} /></td><td><StatusBadge status={q.status} /></td><td>{fmtDate(q.due_date)}</td></tr>)}</tbody></table>}
        </Card>
      )}

      {tab === "activity" && (
        <Card>{activities.length === 0 ? <EmptyState title="No activity" /> : <Timeline items={activities.map((a: any) => ({ title: a.summary, sub: a.user ?? "System", at: fmtDateTime(a.created_at), tone: ["stage", "payment", "delivery"].includes(a.type) ? "green" : "gray" }))} />}</Card>
      )}
    </div>
  );
}
