import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, LEAD_STAGES, LEAD_SOURCES, VERTICALS, label } from "@/lib/config";
import { getLead, slaInfo, slaTick } from "@/lib/services/leads";
import { readiness } from "@/lib/services/proposals";
import { pmOptions } from "@/lib/services/projects";
import { siteFile, designers } from "@/lib/services/handoff";
import { SiteInputsForm } from "@/components/site-form";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, Tabs, Track, Timeline, EmptyState, Field, Icon } from "@/components/ui";
import { ModalButton, ActionForm, ActionButton, SlaTimer, ToggleCheck } from "@/components/client";
import { Select } from "@/components/forms";
import * as A from "@/app/actions/crm";
import { createLayoutAction, saveSiteInputsAction, addSiteNoteAction, uploadSiteFilesAction, sendToDesignerAction, generateProposalAction, startSurveyAction, assignProjectManagerAction, createProjectForLeadAction } from "@/app/actions/work";
import { fmtKw, inr, fmtDateTime, fmtDate, timeAgo } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await guard("crm");
  const id = Number((await params).id);
  const tab = (await searchParams).tab ?? "overview";
  slaTick();
  const lead = getLead(id);
  if (!lead) notFound();
  const db = getDb();
  const w = can(user.role, "crm", "w");
  const sla = slaInfo(lead);
  const q = lead.qualification ? (JSON.parse(lead.qualification) as Record<string, string>) : {};
  const ai = lead.ai_summary ? (JSON.parse(lead.ai_summary) as { summary: string; recommendation: string }) : null;
  const acts = db.prepare("SELECT a.*, u.name uname FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id WHERE lead_id = ? ORDER BY a.id DESC").all(id) as any[];
  const tasks = db.prepare("SELECT t.*, u.name uname FROM lead_tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE lead_id = ? ORDER BY t.status, t.due_at").all(id) as any[];
  const visits = db.prepare("SELECT v.*, p.name pm, d.name designer FROM site_visits v LEFT JOIN users p ON p.id = v.pm_id LEFT JOIN users d ON d.id = v.designer_id WHERE lead_id = ? ORDER BY v.id DESC").all(id) as any[];
  const survey = db.prepare("SELECT id, status FROM site_surveys WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(id) as any;
  const docs = db.prepare("SELECT * FROM documents WHERE lead_id = ? ORDER BY id DESC").all(id) as any[];
  const proposal = db.prepare("SELECT p.*, v.total, v.approval_status FROM proposals p JOIN proposal_versions v ON v.proposal_id = p.id AND v.version = p.current_version WHERE p.lead_id = ?").get(id) as any;
  const project = db.prepare("SELECT id, code, stage, health FROM projects WHERE lead_id = ?").get(id) as any;
  const msgs = db.prepare("SELECT * FROM inbound_messages WHERE linked_entity = ? ORDER BY id DESC").all(`lead:${lead.code}`) as any[];
  const comms = acts.filter((a) => ["call", "email", "whatsapp", "meeting", "message"].includes(a.type));
  const users = (r: string) => db.prepare("SELECT id, name FROM users WHERE role = ? AND active = 1").all(r) as { id: number; name: string }[];
  const ready = readiness(id);
  const idx = LEAD_STAGES.indexOf(lead.status as any);
  const nextStage = idx >= 0 && idx < LEAD_STAGES.length - 1 ? LEAD_STAGES[idx + 1] : undefined;
  const steps = LEAD_STAGES.map((s, i) => ({ label: label(s), state: (idx === -1 ? "todo" : i < idx ? "done" : i === idx ? (s === "WON" ? "done" : "current") : "todo") as any }));
  steps.push({ label: "Project", state: (project ? "done" : lead.status === "WON" ? "current" : "todo") as any });
  const pms = pmOptions();
  const projectPm = project ? (db.prepare("SELECT u.id, u.name FROM projects p LEFT JOIN users u ON u.id = p.pm_id WHERE p.id = ?").get(project.id) as any) : null;
  const canAssign = can(user.role, "proposals", "w");
  const slaBox = lead.status === "NEW" && !lead.first_response_at;

  const tabs = [
    { key: "overview", label: "Overview" }, { key: "activity", label: "Activity", count: acts.length }, { key: "comms", label: "Communication", count: comms.length + msgs.length },
    { key: "tasks", label: "Tasks", count: tasks.filter((t) => t.status === "open").length }, { key: "docs", label: "Documents", count: docs.length },
    { key: "visit", label: "Site Visit", count: visits.length }, { key: "sitefile", label: "Site file" }, { key: "proposal", label: "Proposal" }, { key: "project", label: "Project" },
  ];
  const base = `/crm/leads/${id}`;
  const val = (k: string) => q[k] ?? "";

  return (
    <div>
      <PageHeader crumbs={[{ label: "Leads", href: "/crm/leads" }, { label: lead.code }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{lead.customer_name}<StatusBadge status={lead.status} /></span>}
        sub={`${lead.code} · ${lead.city ?? "—"} · ${fmtKw(lead.capacity_kw)} ${lead.solar_type ?? ""} · ${lead.vertical ?? "—"}`}
        actions={w ? <>
          <ModalButton label="Log contact" icon="phone" title="Log contact" className="btn btn-primary" width={460}>
            <ActionForm action={A.logContactAction.bind(null, id)} submitLabel="Log contact" className="space-y-3">
              <Field label="Type"><Select name="kind" required options={[["call", "Call"], ["email", "Email"], ["whatsapp", "WhatsApp"], ["meeting", "Meeting"]]} /></Field>
              <Field label="Notes"><textarea name="note" rows={3} className="input" placeholder="What was discussed?" /></Field>
              {!lead.first_response_at && <p className="hint">This is the first contact — it stops the response-SLA clock.</p>}
            </ActionForm>
          </ModalButton>
          <ModalButton label="Move stage" title="Change lead status" className="btn" width={440}>
            <ActionForm action={async (fd) => { "use server"; return A.changeStatusAction(id, String(fd.get("status")), fd); }} submitLabel="Update status" className="space-y-3">
              <Field label="New status" hint={nextStage ? `Defaults to the next step — ${label(nextStage)}` : undefined}><Select name="status" required defaultValue={nextStage ?? lead.status} options={[...LEAD_STAGES, "LOST", "ON_HOLD", "DISQUALIFIED"].map((s) => [s, label(s)] as [string, string])} /></Field>
              <Field label="Reason" hint="Required for Lost / Disqualified"><input name="reason" className="input" /></Field>
            </ActionForm>
          </ModalButton>
        </> : undefined} />

      <div className="card mb-5 p-4"><Track steps={steps} /></div>

      {(project || !["LOST", "DISQUALIFIED"].includes(lead.status)) && (
        <div className="card mb-5 flex flex-wrap items-center justify-between gap-4 border-l-4 p-4" style={{ borderLeftColor: "var(--green-500)" }}>
          <div className="min-w-0">
            <div className="eyebrow !text-[var(--green-700)]">{project ? "Project" : lead.status === "WON" ? "Next step · create the project" : "Project manager & project"}</div>
            {project ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-2"><Link href={`/projects/${project.id}`} className="text-[16px] font-extrabold lnk">{project.code}</Link><StatusBadge status={project.stage} /><StatusBadge status={project.health} /></div>
            ) : <div className="mt-0.5 text-[14px] font-semibold">{lead.status === "WON" ? "This lead is won. " : ""}Choose the project manager and create the project — they’re notified immediately and build the project plan.</div>}
            <div className="mt-1 text-[13px] text-muted">Project manager: <b className="text-ink">{projectPm?.name ?? "not assigned"}</b></div>
          </div>
          {canAssign ? (
            <ActionForm action={project ? assignProjectManagerAction.bind(null, project.id) : createProjectForLeadAction.bind(null, id)} submitLabel={project ? (projectPm?.id ? "Change PM" : "Assign PM") : "Create project"} confirm={project ? undefined : "Create the project for this lead now? It will appear under Projects and the project manager will be notified."} className="flex flex-wrap items-end gap-2" resetOnSuccess={false}>
              <div><label className="label">Project manager</label>
                <select name="pm_id" required={!!project} className="input !w-[240px]" defaultValue=""><option value="">{project ? "Select project manager…" : "Auto — least loaded"}</option>{pms.filter((m) => m.id !== projectPm?.id).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.active} active</option>)}</select></div>
            </ActionForm>
          ) : project ? <Link href={`/projects/${project.id}`} className="btn btn-primary">Open project</Link> : null}
        </div>
      )}


      {slaBox && (
        <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 border-l-4 p-4" style={{ borderLeftColor: sla.state === "breached" ? "var(--red)" : "var(--green-500)" }}>
          <div>
            <div className="eyebrow">{sla.state === "breached" ? "Response SLA breached" : "New lead — respond now"}</div>
            <div className="mt-0.5 text-[13px] text-muted">Received {fmtDateTime(lead.received_at)} · Response SLA {Math.floor(sla.total / 60)}:{String(sla.total % 60).padStart(2, "0")} · Owner {lead.owner_name ?? "unassigned"}</div>
          </div>
          <SlaTimer deadline={sla.deadline} total={sla.total} state={sla.state} responseSeconds={sla.responseSeconds} />
        </div>
      )}

      <Tabs tabs={tabs} active={tab} base={base} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Lead details" actions={w && (
              <ModalButton label="Edit" icon="edit" title="Edit lead" className="btn btn-sm" width={560}>
                <ActionForm action={A.updateLeadAction.bind(null, id)} submitLabel="Save changes" className="grid gap-3 sm:grid-cols-2" resetOnSuccess={false}>
                  <Field label="Vertical"><Select name="vertical" defaultValue={lead.vertical} placeholder="—" options={[...VERTICALS]} /></Field>
                  <Field label="Solar type"><Select name="solar_type" defaultValue={lead.solar_type} placeholder="—" options={["Rooftop", "Ground mount", "Carport"]} /></Field>
                  <Field label="Capacity (kW)"><input name="capacity_kw" type="number" step="any" defaultValue={lead.capacity_kw ?? ""} className="input" /></Field>
                  <Field label="Estimated value (₹)"><input name="est_value" type="number" step="any" defaultValue={lead.est_value ?? ""} className="input" /></Field>
                  <Field label="Temperature"><Select name="temperature" defaultValue={lead.temperature} options={["hot", "warm", "cold"]} /></Field>
                  <Field label="Priority"><Select name="priority" defaultValue={lead.priority} options={["high", "medium", "low"]} /></Field>
                  <Field label="Expected close"><input name="expected_close" type="date" defaultValue={lead.expected_close ?? ""} className="input" /></Field>
                  <Field label="Owner"><Select name="owner_id" defaultValue={lead.owner_id} options={users("sales").map((u) => [String(u.id), u.name] as [string, string])} /></Field>
                </ActionForm>
              </ModalButton>)}>
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {([
                  ["Company", lead.customer_name], ["Contact", `${lead.contact_name ?? "—"}${lead.contact_phone ? ` · ${lead.contact_phone}` : ""}`], ["Email", lead.contact_email ?? "—"], ["Location", lead.city ?? "—"],
                  ["Industry / vertical", lead.vertical ?? "—"], ["Solar type", lead.solar_type ?? "—"], ["Capacity", fmtKw(lead.capacity_kw)], ["Source", LEAD_SOURCES[lead.source] ?? lead.source],
                  ["Owner", lead.owner_name ?? "Unassigned"], ["Status", label(lead.status)], ["Estimated value", inr(lead.est_value)], ["Expected close", fmtDate(lead.expected_close)],
                ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{v}</dd></div>)}
                <div><dt className="eyebrow">Temperature</dt><dd className="mt-0.5"><StatusBadge status={lead.temperature} /></dd></div>
                <div><dt className="eyebrow">Priority</dt><dd className="mt-0.5"><StatusBadge status={lead.priority} /></dd></div>
              </dl>
              {lead.customer_id && <div className="mt-4 border-t border-line pt-3 text-xs text-muted">Customer record <Link href={`/crm/customers/${lead.customer_id}`} className="lnk">{lead.customer_code}</Link></div>}
            </Card>

            <Card title="Qualification" actions={w && (
              <ModalButton label={ai ? "Update qualification" : "Start qualification"} icon="edit" title="Qualification call" className="btn btn-sm" width={680}>
                <ActionForm action={A.saveQualificationAction.bind(null, id)} submitLabel="Save & generate AI summary" className="space-y-3" resetOnSuccess={false}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="What is the requirement?" className="sm:col-span-2"><input name="requirement" defaultValue={val("requirement")} className="input" placeholder="e.g. Reduce grid power cost with rooftop solar" /></Field>
                    <Field label="Segment"><Select name="segment" defaultValue={val("segment")} placeholder="Select…" options={["Residential", "Commercial", "Industrial", "Institutional"]} /></Field>
                    <Field label="Solar type"><Select name="solar_type" defaultValue={val("solar_type")} placeholder="Select…" options={["Rooftop", "Ground mount", "Carport"]} /></Field>
                    <Field label="Monthly consumption (kWh)"><input name="monthly_units" type="number" defaultValue={val("monthly_units")} className="input" /></Field>
                    <Field label="Monthly electricity bill (₹)"><input name="monthly_bill" type="number" defaultValue={val("monthly_bill")} className="input" /></Field>
                    <Field label="Available roof / land area (sq m)"><input name="roof_area" type="number" defaultValue={val("roof_area")} className="input" /></Field>
                    <Field label="Existing solar?"><Select name="existing_solar" defaultValue={val("existing_solar")} placeholder="Select…" options={["No", "Yes"]} /></Field>
                    <Field label="Desired capacity (kW)"><input name="desired_capacity" type="number" defaultValue={val("desired_capacity") || lead.capacity_kw || ""} className="input" /></Field>
                    <Field label="Location"><input name="location" defaultValue={val("location") || lead.city || ""} className="input" /></Field>
                    <Field label="Timeline"><input name="timeline" defaultValue={val("timeline")} className="input" placeholder="e.g. Within 60 days" /></Field>
                    <Field label="Decision maker"><input name="decision_maker" defaultValue={val("decision_maker")} className="input" /></Field>
                    <Field label="Budget"><input name="budget" defaultValue={val("budget")} className="input" /></Field>
                    <Field label="Reason for requirement"><input name="reason" defaultValue={val("reason")} className="input" /></Field>
                    <Field label="Site visit requested?"><Select name="site_visit" defaultValue={val("site_visit")} placeholder="Select…" options={[["yes", "Yes"], ["no", "No"]]} /></Field>
                  </div>
                </ActionForm>
              </ModalButton>)}>
              {ai ? (
                <div>
                  <div className="eyebrow !text-[var(--green-700)]"><span className="mr-1 inline-block align-middle"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg></span>AI call summary</div>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed">{ai.summary}</p>
                  <div className="mt-3 flex items-center gap-2 text-[13px]"><span className="text-muted">Recommendation</span><StatusBadge status={ai.recommendation} tone={ai.recommendation === "QUALIFIED" ? "green" : ai.recommendation === "NURTURE" ? "orange" : "red"} />
                    {w && ai.recommendation === "QUALIFIED" && lead.status === "CONTACTED" && <ActionButton action={A.changeStatusAction.bind(null, id, "QUALIFIED", undefined)} className="btn btn-sm btn-primary">Mark qualified</ActionButton>}
                  </div>
                </div>
              ) : <EmptyState icon="phone" title="Not qualified yet" body="Capture the customer's requirement, consumption, timeline and decision-maker. AI turns it into a summary and recommendation." />}
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Next steps">
              <div className="space-y-2.5 text-[13px]">
                {!lead.first_response_at && <div className="flex gap-2"><span className="text-[var(--red)]">●</span> Make first contact to stop the SLA clock</div>}
                {lead.first_response_at && !ai && <div className="flex gap-2"><span className="text-[var(--solar-600)]">●</span> Run the qualification call</div>}
                {visits.length === 0 && ["QUALIFIED", "CONTACTED"].includes(lead.status) && <div className="flex gap-2"><span className="text-[var(--solar-600)]">●</span> Schedule a site visit</div>}
                {ready.designReady && !proposal && <div className="flex gap-2"><span className="text-[var(--green-600)]">●</span> Design is ready — generate the proposal</div>}
                {proposal && <div className="flex gap-2"><span className="text-[var(--green-600)]">●</span> Proposal {proposal.code} is {label(proposal.status)}</div>}
                {lead.status === "WON" && project && <div className="flex gap-2"><span className="text-[var(--green-600)]">●</span> Project {project.code} is live</div>}
              </div>
            </Card>
            {msgs[0] && (
              <Card title="Original message">
                <p className="whitespace-pre-line rounded-md bg-[var(--sunk)] p-3 text-[13px]">{msgs[0].body}</p>
                <p className="mt-2 text-xs text-faint">{label(msgs[0].source)} · {timeAgo(msgs[0].received_at)} · AI confidence {Math.round((msgs[0].confidence ?? 0) * 100)}%</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "activity" && (
        <Card>{acts.length === 0 ? <EmptyState title="No activity yet" /> : (
          <Timeline items={acts.map((a) => ({ title: a.summary, sub: a.uname ?? "Automation", at: `${fmtDateTime(a.created_at)} · ${timeAgo(a.created_at)}`, tone: a.type === "sla" ? "red" : ["status", "created", "proposal"].includes(a.type) ? "green" : "gray" }))} />)}
        </Card>
      )}

      {tab === "comms" && (
        <Card title="Communication history">
          {comms.length + msgs.length === 0 ? <EmptyState icon="chat" title="No communication logged" body="Log a call, email, WhatsApp or meeting from the button above." /> : (
            <Timeline items={[...msgs.map((m) => ({ title: `Inbound ${label(m.source)} message`, sub: m.body, at: fmtDateTime(m.received_at), tone: "solar" as const })), ...comms.map((c) => ({ title: c.summary, sub: c.uname, at: fmtDateTime(c.created_at), tone: "green" as const }))]} />)}
        </Card>
      )}

      {tab === "tasks" && (
        <Card title="Tasks & follow-ups" flush actions={w && (
          <ModalButton label="Add task" icon="plus" title="New follow-up task" className="btn btn-sm" width={460}>
            <ActionForm action={A.addTaskAction.bind(null, id)} submitLabel="Add task" className="space-y-3">
              <Field label="Task *"><input name="title" required className="input" placeholder="e.g. Send site visit slots" /></Field>
              <Field label="Due"><input name="due_at" type="datetime-local" className="input" /></Field>
              <Field label="Assignee"><Select name="assignee_id" defaultValue={user.id} options={users("sales").map((u) => [String(u.id), u.name] as [string, string])} /></Field>
            </ActionForm>
          </ModalButton>)}>
          {tasks.length === 0 ? <EmptyState icon="calendar" title="No tasks" /> : (
            <ul>{tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0">
                {w ? <ToggleCheck checked={t.status === "done"} action={A.completeTaskAction.bind(null, t.id)} label={t.title} /> : <span>{t.title}</span>}
                <span className="text-xs text-muted">{t.uname} · {t.due_at ? fmtDateTime(t.due_at) : "no due date"}</span>
              </li>))}</ul>)}
        </Card>
      )}

      {tab === "docs" && (
        <Card title="Documents" flush actions={<Link href="/documents" className="lnk text-xs">Document centre</Link>}>
          {docs.length === 0 ? <EmptyState icon="folder" title="No documents yet" body="Survey photos, EB bills, designs and proposals appear here automatically." /> : (
            <table className="tbl"><thead><tr><th>Name</th><th>Type</th><th>Added</th></tr></thead><tbody>{docs.map((d) => <tr key={d.id}><td className="font-semibold">{d.file_path ? <a className="lnk" href={`/api/files/${d.file_path}`} target="_blank">{d.name}</a> : d.name}</td><td>{d.doc_type}</td><td>{fmtDate(d.created_at)}</td></tr>)}</tbody></table>)}
        </Card>
      )}

      {tab === "visit" && (
        <Card title="Site visits & survey" flush actions={w && (
          <ModalButton label="Schedule visit" icon="calendar" title="Schedule site visit" className="btn btn-sm btn-primary" width={520}>
            <ActionForm action={A.scheduleVisitAction.bind(null, id)} submitLabel="Schedule" className="space-y-3">
              <Field label="Date & time *"><input name="scheduled_at" type="datetime-local" required className="input" /></Field>
              <Field label="Site location"><input name="location" defaultValue={lead.city ?? ""} className="input" /></Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Project manager"><Select name="pm_id" placeholder="—" options={users("pm").map((u) => [String(u.id), u.name] as [string, string])} /></Field>
                <Field label="Designer"><Select name="designer_id" placeholder="—" options={users("designer").map((u) => [String(u.id), u.name] as [string, string])} /></Field>
                <Field label="Site engineer"><Select name="engineer_id" placeholder="—" options={users("pm").map((u) => [String(u.id), u.name] as [string, string])} /></Field>
              </div>
              <Field label="Customer contact on site"><input name="contact" className="input" defaultValue={lead.contact_name ?? ""} /></Field>
            </ActionForm>
          </ModalButton>)}>
          {visits.length === 0 ? <EmptyState icon="map" title="No site visit scheduled" body="Once qualified, schedule a visit and assign the PM and designer." /> : (
            <table className="tbl"><thead><tr><th>When</th><th>Location</th><th>PM</th><th>Designer</th><th>Status</th></tr></thead><tbody>{visits.map((v) => <tr key={v.id}><td>{fmtDateTime(v.scheduled_at)}</td><td>{v.location}</td><td>{v.pm ?? "—"}</td><td>{v.designer ?? "—"}</td><td><StatusBadge status={v.status} /></td></tr>)}</tbody></table>)}
          {(visits.length > 0 || survey) && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px]">
              <span>Site survey: {survey ? <StatusBadge status={survey.status} /> : <span className="text-muted">not started</span>}</span>
              {survey ? <Link className="btn btn-sm" href={`/survey/${survey.id}`}>Open survey</Link> : can(user.role, "survey", "w") && <ActionButton action={startSurveyAction.bind(null, id)} className="btn btn-sm btn-primary">Start survey</ActionButton>}
            </div>)}
        </Card>
      )}

      {tab === "sitefile" && (() => {
        const sf = siteFile(id)!;
        const sv = sf.survey?.survey;
        const F: [string, string][] = [["site_address", "Site address"], ["site_type", "Site type"], ["roof_type", "Roof type"], ["roof_area_sqm", "Roof area (sq m)"], ["available_area_sqm", "Usable area (sq m)"], ["orientation", "Orientation"], ["shading", "Shading"], ["obstacles", "Obstacles"], ["structural", "Structure condition"], ["access", "Access"], ["safety", "Safety"], ["eb_connection", "EB connection"], ["sanctioned_load_kw", "Sanctioned load (kW)"], ["monthly_kwh", "Monthly units (kWh)"], ["annual_kwh", "Annual units (kWh)"], ["existing_infra", "Existing infrastructure"]];
        const ds = designers();
        const kv = (rows: [string, any][]) => <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="text-[13.5px] font-semibold">{String(v)}</dd></div>)}</dl>;
        return (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-5">
              <Card title="Lead & qualification">
                {kv([["Company", sf.lead.customer_name], ["Contact", [sf.lead.contact_name, sf.lead.contact_phone].filter(Boolean).join(" · ")], ["Location", sf.lead.city], ["Type", `${fmtKw(sf.lead.capacity_kw)} ${sf.lead.solar_type ?? ""}`], ["Industry", sf.lead.vertical], ...Object.entries(sf.qualification).map(([k, v]) => [label(k), v] as [string, any])])}
              </Card>
              <Card title="Site visits" flush>
                {sf.visits.length === 0 ? <p className="p-4 text-[13px] text-muted">No site visit yet.</p> : <table className="tbl"><thead><tr><th>When</th><th>Location</th><th>Contact on site</th><th>PM</th><th>Status</th></tr></thead><tbody>{sf.visits.map((v: any) => <tr key={v.id}><td>{fmtDateTime(v.scheduled_at)}</td><td>{v.location}</td><td>{v.contact ?? "—"}</td><td>{v.pm ?? "—"}</td><td><StatusBadge status={v.status} /></td></tr>)}</tbody></table>}
              </Card>
              <SiteInputsForm canEdit={w} save={saveSiteInputsAction.bind(null, id)} init={{
                fields: Object.fromEntries(["site_address", "gps", "site_type", "roof_type", "roof_area_sqm", "available_area_sqm", "orientation", "shading", "obstacles", "structural", "access", "safety", "eb_connection", "sanctioned_load_kw", "monthly_kwh", "annual_kwh", "existing_infra", "notes"].map((k) => [k, sv?.[k] ?? ""])),
                extras: sf.details.extras ?? {}, obstacles: sf.details.obstacles ?? [], measurements: sf.survey?.measurements ?? [] }} />
              <Card title="Site notes" actions={<span className="text-xs text-faint">{sf.notes.length} note{sf.notes.length === 1 ? "" : "s"}</span>}>
                {w && <ActionForm action={addSiteNoteAction.bind(null, id)} submitLabel="Add note" submitClass="btn btn-primary w-full" className="mb-3 space-y-2"><textarea name="note" rows={3} required className="input" placeholder="Anything learnt on site — roof condition, customer preferences, power cuts, access limits…" /></ActionForm>}
                {sf.notes.length === 0 ? <p className="text-[13px] text-muted">No notes yet.</p> : <ul className="space-y-2">{sf.notes.map((n: any) => <li key={n.id} className="rounded-lg border border-line p-3 text-[13px]"><div className="mb-0.5 text-xs text-faint">{n.uname} · {fmtDateTime(n.created_at)}</div>{n.summary}</li>)}</ul>}
              </Card>
            </div>

            <div className="min-w-0 space-y-5">
              <Card title="Preliminary layout" actions={can(user.role, "design", "w") ? <ActionButton action={createLayoutAction.bind(null, id)} className="btn btn-sm btn-primary">Create layout</ActionButton> : undefined}>
                {(() => { const ls = db.prepare("SELECT id, code, rev, status, json_extract(sheet,'$.sheet_no') sheet_no FROM layouts WHERE lead_id = ? ORDER BY id DESC").all(id) as any[];
                  return ls.length === 0 ? <p className="text-[13px] text-muted">Draw the roof plan sheet for the customer — pre-filled from this site file.</p> : <ul className="space-y-1.5">{ls.map((l) => <li key={l.id} className="flex items-center justify-between text-[13px]"><Link className="lnk" href={`/design/layouts/${l.id}`}>{l.sheet_no} · Rev {l.rev}</Link><StatusBadge status={l.status} tone={l.status === "ISSUED" ? "green" : "gray"} /></li>)}</ul>; })()}
              </Card>
              <Card title={`Photos & documents (${sf.files.length})`}>
                {w && <ActionForm action={uploadSiteFilesAction.bind(null, id)} submitLabel="Upload files" submitClass="btn btn-primary w-full" className="mb-3 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]"><input name="files" type="file" multiple accept="image/*,.pdf" required className="input !h-auto py-1.5 text-xs" /><select name="doc_type" className="input"><option>Site Photo</option><option>EB Bill</option><option>Drawing</option><option>Other</option></select></div>
                </ActionForm>}
                {sf.files.length === 0 ? <p className="text-[13px] text-muted">Nothing uploaded yet. Add site photos, the EB bill and drawings.</p> : <div className="grid grid-cols-3 gap-1.5">{sf.files.map((f: any) => f.image
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <a key={`${f.kind}${f.id}`} href={`/api/files/${f.path}`} target="_blank" title={f.name}><img src={`/api/files/${f.path}`} alt={f.name} className="aspect-square w-full rounded object-cover" /></a>
                  : <a key={`${f.kind}${f.id}`} href={`/api/files/${f.path}`} target="_blank" className="grid aspect-square place-items-center rounded bg-[var(--sunk)] p-1 text-center text-[10.5px] font-semibold">{f.name}</a>)}</div>}
              </Card>


            </div>

          <div className="grid gap-5 xl:col-span-2 xl:grid-cols-[minmax(0,1fr)_400px]">
            {w ? (
              <Card title="Send everything to the designer" actions={<span className="badge b-green">notifies immediately</span>}>
                {ds.length === 0 ? <p className="text-[13px] text-muted">No active designers.</p> : (
                  <ActionForm action={sendToDesignerAction.bind(null, id)} submitLabel="Send site file to designer" submitClass="btn btn-primary w-full" className="space-y-3" resetOnSuccess={false}>
                    <div className="rounded-lg bg-[var(--sunk)] p-3 text-[12.5px] text-muted">Sends the saved <b className="text-ink">lead details, qualification, site visits, all site inputs, measurements and notes</b>, plus the photos and documents ticked below. <b className="text-ink">Press “Save site inputs” first</b> if you changed anything above.</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Designer *"><select name="designer_id" required className="input" defaultValue=""><option value="">Select designer…</option>{ds.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.open} open</option>)}</select></Field>
                      <Field label="Message"><textarea name="message" rows={2} className="input" placeholder="e.g. Please size for full roof, prefer bifacial…" /></Field>
                    </div>
                    {sf.files.length > 0 ? <div><div className="label">Photos & documents to send ({sf.files.length})</div><div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">{sf.files.map((f: any) => <label key={`${f.kind}${f.id}`} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line p-1.5 text-xs"><input type="checkbox" name="pick" value={`${f.kind === "photo" ? "p" : "d"}:${f.id}`} defaultChecked className="accent-[var(--green-600)]" />{f.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/files/${f.path}`} alt="" className="h-10 w-10 rounded object-cover" /> : <Icon name="file" size={16} />}<span className="truncate">{f.name}</span></label>)}</div></div> : <p className="text-xs text-faint">No photos or documents uploaded yet — add them in “Photos & documents” above.</p>}
                  </ActionForm>)}
              </Card>) : <div />}
            <Card title="Sent to design" flush>
                {sf.handoffs.length === 0 ? <p className="p-4 text-[13px] text-muted">Nothing sent yet.</p> : <ul>{sf.handoffs.map((h: any) => <li key={h.id} className="border-b border-line px-4 py-2.5 text-[13px] last:border-0"><b>{h.designer}</b> <span className="text-xs text-faint">· {fmtDateTime(h.sent_at)} · by {h.sender}</span>{h.message && <div className="text-muted">{h.message}</div>}<div className="text-xs text-faint">{JSON.parse(h.attachments).length} file(s) attached</div></li>)}</ul>}
              </Card>
          </div>
          </div>);
      })()}

      {tab === "proposal" && (
        <Card title="Proposal">
          {proposal ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-[15px] font-extrabold">{proposal.code} · V{proposal.current_version}</div><div className="text-[13px] text-muted">{inr(proposal.total)} · <StatusBadge status={proposal.status} /></div></div>
              <Link href={`/proposals/${proposal.id}`} className="btn btn-primary">Open proposal</Link>
            </div>
          ) : ready.designReady ? (
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-muted">Design and BOQ ({ready.boqCount} lines) are complete. Generate the proposal from survey, design, BOQ, pricing and payment terms.</p>
              {can(user.role, "proposals", "w") && <ActionButton action={generateProposalAction.bind(null, id, undefined)} className="btn btn-primary">Generate proposal</ActionButton>}</div>
          ) : <EmptyState icon="file" title="Proposal not ready" body="A proposal can be generated once the site survey is submitted and the designer completes the design and BOQ." />}
        </Card>
      )}

      {tab === "project" && (
        <Card title="Project">
          {project ? <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[15px] font-extrabold">{project.code}</div><div className="mt-1 flex gap-2"><StatusBadge status={project.stage} /><StatusBadge status={project.health} /></div></div><Link href={`/projects/${project.id}`} className="btn btn-primary">Open project</Link></div>
            : <EmptyState icon="layers" title="No project yet" body="A project is created automatically the moment the proposal is accepted — nothing is re-entered." />}
        </Card>
      )}
    </div>
  );
}
