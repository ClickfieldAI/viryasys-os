import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PROJECT_STAGES, label } from "@/lib/config";
import { Card, StatusBadge, EmptyState, Track, ProgressBar, Timeline, Field } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { portalQueryAction } from "@/app/actions/ops";
import { portalAcknowledgeAction } from "@/app/actions/procurement";
import { SignaturePad } from "@/components/proc-client";
import { fmtKw, inr, fmtDate, fmtDateTime } from "@/lib/util";

export const metadata = { title: "My project" };
export const dynamic = "force-dynamic";

// Customer-safe view: never selects internal fields (costs, vendors, health reasons, internal notes, internal docs).
export default async function Portal({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await getUser();
  if (!u || u.role !== "customer" || !u.customer_id) redirect("/login");
  const db = getDb();
  const projects = db.prepare("SELECT id, code, name FROM projects WHERE customer_id = ? ORDER BY id").all(u.customer_id) as any[];
  if (projects.length === 0) return <Card><EmptyState icon="layers" title="No active project yet" body="Your project will appear here once your proposal is confirmed." /></Card>;
  const sp = await searchParams;
  const pid = projects.find((p) => p.id === Number(sp.p))?.id ?? projects[0].id;
  const p = db.prepare("SELECT p.id, p.code, p.name, p.stage, p.capacity_kw, p.site, p.city, p.start_date, p.target_end, p.install_progress, p.equipment, u.name pm FROM projects p LEFT JOIN users u ON u.id = p.pm_id WHERE p.id = ? AND p.customer_id = ?").get(pid, u.customer_id) as any;
  const milestones = db.prepare("SELECT stage, name, due_date, done_at, status FROM project_milestones WHERE project_id = ? ORDER BY sort").all(pid) as any[];
  const survey = db.prepare("SELECT s.status, s.submitted_at, s.roof_type, s.available_area_sqm FROM site_surveys s WHERE s.lead_id = (SELECT lead_id FROM projects WHERE id = ?) ORDER BY s.id DESC LIMIT 1").get(pid) as any;
  const design = db.prepare("SELECT d.capacity_kw, d.panel_brand, d.panel_wp, d.panel_count, d.inverter_brand, d.inverter_kw, d.inverter_count, d.est_annual_kwh FROM designs d WHERE d.lead_id = (SELECT lead_id FROM projects WHERE id = ?) AND d.status = 'COMPLETED' ORDER BY d.id DESC LIMIT 1").get(pid) as any;
  const steps = db.prepare("SELECT name, pct FROM install_steps WHERE project_id = ? ORDER BY sort").all(pid) as any[];
  const pays = db.prepare("SELECT m.name, m.pct, m.amount, m.status, i.code invoice_code, i.status invoice_status, i.due_on FROM payment_milestones m LEFT JOIN invoices i ON i.id = m.invoice_id AND i.status != 'DRAFT' WHERE m.project_id = ? ORDER BY m.sort").all(pid) as any[];
  const docs = db.prepare("SELECT name, doc_type, file_path, created_at FROM documents WHERE project_id = ? AND customer_visible = 1 ORDER BY id DESC").all(pid) as any[];
  const queries = db.prepare("SELECT code, subject, status, resolution, created_at FROM customer_queries WHERE project_id = ? ORDER BY id DESC").all(pid) as any[];
  const updates = db.prepare("SELECT summary, created_at FROM project_activities WHERE project_id = ? AND customer_visible = 1 ORDER BY id DESC LIMIT 12").all(pid) as any[];
  const eq = p.equipment ? JSON.parse(p.equipment) : null;
  // Customer-safe delivery view: what arrived and what needs the customer's acknowledgement (no vendor, PO or cost data).
  const deliveries = db.prepare(`SELECT d.id, d.code, d.status, d.expected_date, d.received_at, n.code dn_code,
      (SELECT GROUP_CONCAT(i.description || ' × ' || di.qty_accepted, ', ') FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = d.id AND di.qty_accepted > 0) accepted_items,
      (SELECT GROUP_CONCAT(i.description, ', ') FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = d.id) all_items,
      (SELECT customer_name || '|' || ack_at FROM customer_acknowledgements WHERE delivery_id = d.id) ack
    FROM deliveries d LEFT JOIN delivery_notes n ON n.delivery_id = d.id WHERE d.project_id = ? AND d.status IN ('IN_TRANSIT','RECEIVED','INSPECTED','ACKNOWLEDGED') ORDER BY d.id DESC LIMIT 12`).all(pid) as any[];
  const curIdx = PROJECT_STAGES.indexOf(p.stage);
  const steps2 = PROJECT_STAGES.filter((s) => s !== "PROJECT_CREATED").map((s) => { const i = PROJECT_STAGES.indexOf(s); return { label: label(s), state: (i < curIdx || p.stage === "COMPLETED" ? "done" : i === curIdx ? "current" : "todo") as any }; });
  const paid = pays.filter((x) => x.status === "PAID").reduce((a, x) => a + x.amount, 0);
  const total = pays.reduce((a, x) => a + x.amount, 0);

  return (
    <div className="space-y-5">
      {projects.length > 1 && <div className="flex gap-1.5">{projects.map((x) => <Link key={x.id} href={`/portal?p=${x.id}`} className={`btn btn-sm ${x.id === pid ? "btn-dark" : ""}`}>{x.code}</Link>)}</div>}
      <div>
        <div className="eyebrow">Your solar project</div>
        <h1 className="mt-1 flex flex-wrap items-center gap-2.5 text-[26px] font-extrabold tracking-tight">{p.name}<StatusBadge status={p.stage} tone={p.stage === "COMPLETED" ? "green" : "navy"} /></h1>
        <p className="text-[13px] text-muted">{p.code} · {p.site ?? p.city} · {fmtKw(p.capacity_kw)} · Project manager {p.pm ?? "—"}</p>
      </div>

      <Card title="Project progress"><Track steps={steps2} /><div className="mt-3 text-xs text-muted">Started {fmtDate(p.start_date)} · Target completion {fmtDate(p.target_end)}</div></Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Site survey & design">
          <dl className="space-y-2 text-[13px]">
            <div className="flex justify-between"><dt className="text-muted">Site survey</dt><dd className="font-semibold">{survey?.status === "SUBMITTED" ? `Completed ${fmtDate(survey.submitted_at)}` : "Pending"}</dd></div>
            {design && <>
              <div className="flex justify-between"><dt className="text-muted">System size</dt><dd className="font-semibold">{fmtKw(design.capacity_kw)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Solar panels</dt><dd className="font-semibold">{design.panel_count} × {design.panel_wp} Wp {design.panel_brand}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Inverters</dt><dd className="font-semibold">{design.inverter_count} × {design.inverter_kw} kW {design.inverter_brand}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Expected generation</dt><dd className="font-semibold">{new Intl.NumberFormat("en-IN").format(Math.round(design.est_annual_kwh ?? 0))} kWh / year</dd></div></>}
            {!design && eq && <div className="flex justify-between"><dt className="text-muted">Equipment</dt><dd className="text-right font-semibold">{eq.panels}<br />{eq.inverters}</dd></div>}
          </dl>
        </Card>
        <Card title="Installation">
          <div className="mb-1 flex items-end justify-between"><span className="text-3xl font-extrabold num">{p.install_progress}%</span><span className="text-xs text-muted">{p.install_progress >= 100 ? "Complete" : p.install_progress > 0 ? "In progress" : "Not started"}</span></div>
          <ProgressBar value={p.install_progress} />
          <ul className="mt-3 space-y-1.5 text-[13px]">{steps.map((s) => <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className={s.pct >= 100 ? "font-semibold text-[var(--green-700)]" : "text-muted"}>{s.pct >= 100 ? "✓ Done" : s.pct > 0 ? `${s.pct}%` : "Pending"}</span></li>)}</ul>
        </Card>
      </div>

      {deliveries.length > 0 && (
        <Card title="Material deliveries" flush>
          <ul>{deliveries.map((d) => (
            <li key={d.id} className="border-b border-line px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[13.5px] font-bold">{d.code}</div><div className="text-xs text-muted">{d.accepted_items ?? d.all_items}</div></div>
                <StatusBadge status={d.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : d.status === "INSPECTED" ? "PENDING" : d.status === "IN_TRANSIT" ? "IN_TRANSIT" : "RECEIVED"}>{d.status === "ACKNOWLEDGED" ? "Acknowledged" : d.status === "INSPECTED" ? "Awaiting your acknowledgement" : d.status === "IN_TRANSIT" ? `On the way${d.expected_date ? ` · ${fmtDate(d.expected_date)}` : ""}` : "Received — being checked"}</StatusBadge></div>
              {d.status === "INSPECTED" && d.dn_code && (
                <ActionForm action={portalAcknowledgeAction.bind(null, d.id)} submitLabel="Accept delivery" className="mt-3 space-y-2.5 rounded-lg bg-[var(--sunk)] p-3" resetOnSuccess={false}>
                  <p className="text-[13px] font-semibold">Material received at site — delivery note {d.dn_code}</p>
                  <Field label="Your name"><input name="customer_name" required className="input" /></Field>
                  <Field label="Signature"><SignaturePad /></Field>
                  <Field label="Remarks"><input name="remarks" className="input" /></Field>
                </ActionForm>)}
              {d.ack && <div className="mt-1 text-xs text-muted">Acknowledged by {String(d.ack).split("|")[0]} · {fmtDateTime(String(d.ack).split("|")[1])}</div>}
            </li>))}</ul>
        </Card>)}

      <Card title="Milestones" flush>
        <table className="tbl"><thead><tr><th>Milestone</th><th>Planned</th><th>Status</th></tr></thead><tbody>{milestones.filter((m) => m.stage !== "PROJECT_CREATED").map((m) => <tr key={m.stage}><td className="font-semibold">{m.name}</td><td>{fmtDate(m.due_date)}</td><td>{m.status === "DONE" ? <span className="badge b-green"><i />Done {fmtDate(m.done_at)}</span> : m.status === "CURRENT" ? <span className="badge b-orange"><i />In progress</span> : <span className="badge">Upcoming</span>}</td></tr>)}</tbody></table>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Payments" flush actions={<span className="text-xs text-muted">{inr(paid)} of {inr(total)} paid</span>}>
          <ul>{pays.map((x) => <li key={x.name} className="flex items-center justify-between border-b border-line px-4 py-3 text-[13px] last:border-0"><div><div className="font-semibold">{x.name} <span className="font-normal text-faint">· {x.pct}%</span></div>{x.invoice_code && <div className="text-xs text-muted">{x.invoice_code}{x.due_on ? ` · due ${fmtDate(x.due_on)}` : ""}</div>}</div><div className="text-right"><div className="num font-bold">{inr(x.amount)}</div><StatusBadge status={x.status === "PAID" ? "PAID" : x.invoice_code ? "INVOICED" : "PENDING"} /></div></li>)}</ul>
        </Card>
        <Card title="Documents" flush>
          {docs.length === 0 ? <EmptyState icon="folder" title="No documents shared yet" /> : <ul>{docs.map((d) => <li key={d.name + d.created_at} className="flex items-center justify-between border-b border-line px-4 py-3 text-[13px] last:border-0"><div><div className="font-semibold">{d.file_path ? <a className="lnk" href={`/api/files/${d.file_path}`} target="_blank">{d.name}</a> : d.name}</div><div className="text-xs text-muted">{d.doc_type} · {fmtDate(d.created_at)}</div></div></li>)}</ul>}
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Project updates">{updates.length === 0 ? <EmptyState title="No updates yet" /> : <Timeline items={updates.map((u2) => ({ title: u2.summary, at: fmtDateTime(u2.created_at) }))} />}</Card>
        <Card title="Queries">
          <ActionForm action={portalQueryAction} submitLabel="Send to project team" className="mb-4 space-y-2.5">
            <input type="hidden" name="project_id" value={pid} />
            <Field label="Subject"><input name="subject" required className="input" placeholder="What do you need help with?" /></Field>
            <Field label="Details"><textarea name="description" rows={2} className="input" /></Field>
          </ActionForm>
          {queries.length === 0 ? <p className="text-[13px] text-muted">No queries yet.</p> : <ul className="space-y-2">{queries.map((q) => <li key={q.code} className="rounded-md border border-line p-2.5 text-[13px]"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{q.subject}</span><StatusBadge status={q.status} /></div>{q.resolution && <div className="mt-1 text-xs text-muted">{q.resolution}</div>}</li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
