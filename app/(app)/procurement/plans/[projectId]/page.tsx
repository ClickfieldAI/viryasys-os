import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { procurementGate, requirementRows, costControl, projectImpacts, canSeeProject, itemLines, PRIORITIES } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, Track, EmptyState, Field, ProgressBar, Icon } from "@/components/ui";
import { ActionButton, ActionForm, ModalButton } from "@/components/client";
import { Select } from "@/components/forms";
import { LockedPanel, RiskBadge } from "@/components/proc";
import * as A from "@/app/actions/procurement";
import { inr, inrShort, fmtDate, fmtKw } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await guard("procurement");
  const pid = Number((await params).projectId);
  const viewer = { id: user.id, role: user.role };
  const db = getDb();
  const p = db.prepare("SELECT p.*, c.name customer_name FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?").get(pid) as any;
  if (!p || !canSeeProject(viewer, pid)) notFound();
  const w = can(user.role, "procurement", "w");
  const gate = procurementGate(pid);
  const plan = db.prepare("SELECT * FROM procurement_plans WHERE project_id = ?").get(pid) as any;

  const head = <PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }, { label: p.code }]} title={<span className="flex flex-wrap items-center gap-2.5">{p.customer_name}<span className="text-[15px] font-semibold text-muted">{fmtKw(p.capacity_kw)}</span>{plan ? <StatusBadge status="AUTHORIZED" /> : <StatusBadge status="LOCKED" tone={gate.ok ? "orange" : "red"}>{gate.ok ? "Ready to authorize" : "Locked"}</StatusBadge>}</span>} sub={`${p.name} · ${p.code}`} />;

  if (!plan) {
    return (
      <div>{head}
        {!gate.ok ? <LockedPanel gate={gate} /> : (
          <Card title="Authorize procurement" className="mx-auto max-w-[620px]">
            <p className="mb-3 text-[13.5px]">The customer order is approved and the advance is in ({gate.receivedPct}% of the {gate.requiredPct}% required). Authorizing creates the procurement plan from the approved BOQ, split into delivery stages.</p>
            {w ? <ActionForm action={A.authorizeProcurementAction.bind(null, pid)} submitLabel="Authorize procurement" className="space-y-3" resetOnSuccess={false}>
              <Field label="Stages"><Select name="template" options={[["3-stage", "3 stages — structure → panels & inverters → cables & electrical"], ["2-stage", "2 stages — structure/BOS → panels & inverters"], ["single", "Single delivery"]]} /></Field>
              <p className="hint">You can add or rename stages and move materials between them afterwards.</p></ActionForm> : <p className="text-[13px] text-muted">Procurement will authorize this project.</p>}
          </Card>)}
      </div>);
  }

  const reqs = requirementRows(pid);
  const stages = db.prepare("SELECT * FROM procurement_stages WHERE plan_id = ? ORDER BY sort").all(plan.id) as any[];
  const requests = db.prepare("SELECT q.*, v.name vname, u.name uname FROM purchase_requests q LEFT JOIN vendors v ON v.id = q.preferred_vendor_id LEFT JOIN users u ON u.id = q.created_by WHERE q.project_id = ? ORDER BY q.status = 'OPEN' DESC, q.id DESC").all(pid) as any[];
  const vendors = db.prepare("SELECT id, name FROM vendors WHERE active = 1 ORDER BY name").all() as any[];
  const pos = db.prepare("SELECT o.*, v.name vname FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id WHERE o.project_id = ? ORDER BY o.id").all(pid) as any[];
  const cost = costControl(pid)[0];
  const impacts = projectImpacts(pid);
  const lines = itemLines({ project_id: pid });
  const cur = (i: number) => stages[i];
  const stageState = (sid: number) => { const rs = reqs.filter((r) => r.stage_id === sid); if (!rs.length) return "NOT_STARTED"; if (rs.every((r) => r.status === "RECEIVED")) return "RECEIVED"; if (rs.some((r) => r.status === "DELAYED")) return "DELAYED"; if (rs.some((r) => r.received > 0)) return "PARTIALLY_RECEIVED"; if (rs.some((r) => r.ordered > 0)) return "ORDERED"; return "NOT_ORDERED"; };
  const anyReq = requests.length > 0, anyPo = pos.length > 0, anyConf = pos.some((x) => ["VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(x.status)), anyRecv = reqs.some((r) => r.received > 0), allRecv = reqs.length > 0 && reqs.every((r) => r.status === "RECEIVED");
  const steps = [["Customer order", true], ["Advance received", true], ["Procurement authorized", true], ["Procurement plan", true], ["Purchase request", anyReq || anyPo], ["Purchase order", anyPo], ["Vendor confirmed", anyConf], ["Material received", anyRecv], ["Fully received", allRecv], ["Issued / consumed", reqs.some((r) => r.issued > 0)]] as [string, boolean][];
  const fo = steps.findIndex((s) => !s[1]);
  const track = steps.map(([l, d], i) => ({ label: l, state: (d ? "done" : i === fo ? "current" : "todo") as any }));

  return (
    <div>{head}
      <div className="card mb-5 p-4"><Track steps={track} /></div>
      <div className="mb-5 grid gap-3 sm:grid-cols-4">{([["Project", p.name], ["Capacity", fmtKw(p.capacity_kw)], ["Start date", fmtDate(plan.start_date)], ["Target installation", fmtDate(plan.target_install)]] as [string, string][]).map(([k, v]) => <div key={k} className="card p-3.5"><div className="eyebrow">{k}</div><div className="mt-1 truncate text-[15px] font-extrabold">{v}</div></div>)}</div>

      {impacts.length > 0 && (
        <Card title="Project impact" className="mb-5" flush>
          <table className="tbl"><thead><tr><th>Material</th><th className="r">Delay</th><th>Affected milestone</th><th>Milestone due</th><th className="r">Potential impact</th><th>Risk</th></tr></thead><tbody>{impacts.map((im) => <tr key={im.line.id}><td className="font-semibold">{im.line.description}<div className="text-xs font-normal text-muted">{im.line.vendor_name} · <Link className="lnk" href={`/procurement/${im.line.po_id}`}>{im.line.po_code}</Link></div></td><td className="r num font-bold text-[var(--red)]">{im.delayDays}d</td><td>{im.milestone ?? "Project completion"}</td><td>{fmtDate(im.milestoneDue)}{im.daysToDeadline != null && <span className="ml-1 text-xs text-muted">({im.daysToDeadline}d)</span>}</td><td className="r num">{im.delayDays}d</td><td><RiskBadge risk={im.risk} /></td></tr>)}</tbody></table>
        </Card>)}

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between"><h2 className="text-[15px] font-extrabold">Procurement stages</h2>
            {w && <ModalButton label="Add stage" icon="plus" title="Add procurement stage" className="btn btn-sm" width={440}><ActionForm action={A.addStageAction.bind(null, plan.id)} submitLabel="Add stage" className="space-y-3"><Field label="Stage name *"><input name="name" required className="input" placeholder="e.g. Stage 4 — Monitoring & spares" /></Field><Field label="Required date"><input name="required_date" type="date" className="input" /></Field></ActionForm></ModalButton>}</div>
          {stages.map((s, i) => { const rs = reqs.filter((r) => r.stage_id === s.id); return (
            <Card key={s.id} title={<span className="flex flex-wrap items-center gap-2">{s.name}<StatusBadge status={stageState(s.id)} /></span>} actions={<>
              <span className="text-xs text-muted">Required {fmtDate(s.required_date)}{s.depends_on ? ` · after ${cur(i - 1)?.name.split("—")[0].trim()}` : ""}</span>
              {w && rs.some((r) => r.ordered + r.requested_open < r.qty) && <ActionButton action={A.createStageRequestsAction.bind(null, s.id)} className="btn btn-sm btn-primary">Request all</ActionButton>}</>} flush>
              {rs.length === 0 ? <EmptyState icon="layers" title="No materials in this stage" body="Move materials here from the table below." /> : (
                <ul>{rs.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0"><span className="min-w-0 truncate"><b>{r.name}</b> <span className="text-xs text-muted">{r.qty} {r.unit}</span></span><span className="flex items-center gap-2"><span className="num text-xs text-muted">{r.po_codes ?? "no PO"}</span><StatusBadge status={r.status} /></span></li>)}</ul>)}
            </Card>); })}
        </div>
        <div className="space-y-5">
          {cost && (
            <Card title="Procurement cost control">
              <dl className="space-y-1.5 text-[13px]">{([["Approved project value (pre-tax)", cost.approved], ["Estimated procurement (BOQ)", cost.estimated], ["Actual — committed POs", cost.actual]] as [string, number][]).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="num font-bold">{inr(v)}</dd></div>)}
                <div className="flex justify-between border-t border-line pt-1.5"><dt className="text-muted">Variance on ordered items</dt><dd className={`num font-extrabold ${cost.variance > 0.5 ? "text-[var(--red)]" : "text-[var(--green-700)]"}`}>{cost.variance > 0 ? "+" : ""}{inr(cost.variance)} ({cost.pct > 0 ? "+" : ""}{cost.pct}%)</dd></div></dl>
              <div className="mt-2"><StatusBadge status={cost.status} /></div>
              <p className="hint mt-2">Compares what has been ordered with the BOQ estimate for the same quantities. {inrShort(cost.uncovered)} of estimate is not yet ordered.</p>
            </Card>)}
          <Card title="Shortcuts" flush><ul className="text-[13px]">{[["Material ledger & stock", `/procurement/inventory/${pid}`], ["Create PO", `/procurement/new?project=${pid}`], ["Deliveries", "/procurement/deliveries"], ["Project", `/projects/${pid}`]].map(([l, h]) => <li key={h} className="border-b border-line last:border-0"><Link href={h} className="row-link flex items-center justify-between px-4 py-2.5">{l}<Icon name="arrow" size={13} className="text-faint" /></Link></li>)}</ul></Card>
        </div>
      </div>

      <Card title="Material requirements" className="mb-5" flush>
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 1250 }}>
          <thead><tr><th>Material</th><th>Category</th><th>Specification</th><th className="r">Required</th><th>Required date</th><th>Vendor</th><th>PO</th><th className="r">Ordered</th><th className="r">Received</th><th className="r">Issued</th><th className="r">Returned</th><th className="r">Balance</th><th>Status</th><th /></tr></thead>
          <tbody>{reqs.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold">{r.name}</td><td>{r.category}</td><td className="max-w-[160px] truncate text-muted">{r.spec}</td><td className="r num">{r.qty} {r.unit}</td><td>{fmtDate(r.required_date).replace(/ \d{4}$/, "")}</td><td className="max-w-[140px] truncate">{r.vendor_names ?? "—"}</td><td className="num text-xs">{r.po_codes ?? "—"}</td>
              <td className="r num">{r.ordered}</td><td className="r num">{r.received}</td><td className="r num">{r.issued}</td><td className="r num">{r.returned}</td><td className="r num font-semibold">{r.balance}</td><td><StatusBadge status={r.status} /></td>
              <td className="r whitespace-nowrap">{w && <span className="inline-flex gap-1.5">
                {r.ordered + r.requested_open < r.qty && <ModalButton label="Request" title={`Purchase request — ${r.name}`} className="btn btn-sm" width={500}>
                  <ActionForm action={A.createRequestAction} submitLabel="Create purchase request" className="space-y-3">
                    <input type="hidden" name="project_id" value={pid} /><input type="hidden" name="requirement_id" value={r.id} />
                    <div className="grid gap-3 sm:grid-cols-2"><Field label={`Quantity (left ${Math.round((r.qty - r.ordered - r.requested_open) * 100) / 100} ${r.unit})`}><input name="qty" type="number" step="any" min="0" required defaultValue={Math.round((r.qty - r.ordered - r.requested_open) * 100) / 100} className="input" /></Field><Field label="Required by"><input name="required_by" type="date" defaultValue={r.required_date ?? ""} className="input" /></Field>
                      <Field label="Priority"><Select name="priority" defaultValue="NORMAL" options={[...PRIORITIES]} /></Field><Field label="Preferred vendor"><Select name="preferred_vendor_id" placeholder="Any" options={vendors.map((v) => [String(v.id), v.name] as [string, string])} /></Field></div>
                    <Field label="Notes"><input name="notes" className="input" /></Field></ActionForm></ModalButton>}
                {stages.length > 1 && <ModalButton label="Stage" title={`Move — ${r.name}`} className="btn btn-sm btn-ghost" width={400}><ActionForm action={A.moveRequirementAction.bind(null, r.id)} submitLabel="Move" className="space-y-3"><Field label="Stage"><Select name="stage_id" defaultValue={r.stage_id} options={stages.map((s) => [String(s.id), s.name] as [string, string])} /></Field></ActionForm></ModalButton>}</span>}</td>
            </tr>))}</tbody>
        </table></div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Purchase requests" flush>{requests.length === 0 ? <EmptyState icon="file" title="No purchase requests" body="Request material from the requirements above." /> : (
          <ul>{requests.map((q) => <li key={q.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-[13px] last:border-0"><span className="min-w-0"><b className="num">{q.code}</b> · {q.qty} {q.unit} {q.material}<div className="text-xs text-muted">{q.priority} · by {fmtDate(q.required_by).replace(/ \d{4}$/, "")}{q.vname ? ` · ${q.vname}` : ""}</div></span><span className="flex items-center gap-2"><StatusBadge status={q.status} />{w && q.status === "OPEN" && <ActionButton action={A.cancelRequestAction.bind(null, q.id)} className="btn btn-ghost btn-sm">Cancel</ActionButton>}</span></li>)}</ul>)}
          {w && requests.some((q) => q.status === "OPEN") && <div className="border-t border-line p-3"><Link className="btn btn-primary btn-sm" href={`/procurement/new?project=${pid}`}>Create PO from requests</Link></div>}</Card>
        <Card title="Purchase orders" flush>{pos.length === 0 ? <EmptyState icon="truck" title="No purchase orders yet" /> : (
          <ul>{pos.map((o) => { const ls = lines.filter((l) => l.po_id === o.id); return <li key={o.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-[13px] last:border-0"><span><Link className="lnk num" href={`/procurement/${o.id}`}>{o.code}</Link> <span className="text-muted">· {o.vname}</span><div className="text-xs text-muted">{inr(o.total)} · {ls.filter((l) => ["INSPECTED", "ACKNOWLEDGED"].includes(l.status)).length}/{ls.length} lines delivered</div></span><StatusBadge status={o.status} /></li>; })}</ul>)}</Card>
      </div>
      <span className="hidden"><ProgressBar value={0} /></span>
    </div>
  );
}
