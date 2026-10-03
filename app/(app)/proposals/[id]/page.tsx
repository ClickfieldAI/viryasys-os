import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { pmOptions } from "@/lib/services/projects";
import { getProposal, prepareEmail, planViews, outboxFor } from "@/lib/services/proposals";
import { settings } from "@/lib/db";
import { PageHeader, Card, StatusBadge, Field } from "@/components/ui";
import { ActionButton, ActionForm, ModalButton } from "@/components/client";
import { Select } from "@/components/forms";
import { ProposalEditor } from "@/components/proposal-editor";
import * as W from "@/app/actions/work";
import { inr, fmtDateTime } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await guard("proposals");
  const id = Number((await params).id);
  const sp = await searchParams;
  const cur = getProposal(id, sp.v ? Number(sp.v) : undefined);
  if (!cur) notFound();
  const { proposal: p, version: v } = cur;
  const w = can(user.role, "proposals", "w");
  const isCurrent = v.version === p.current_version;
  const st = v.approval_status;
  const email = ["APPROVED", "SENT", "ACCEPTED"].includes(st) && isCurrent ? prepareEmail(id) : null;
  const plans = planViews(p.lead_id);
  const outbox = outboxFor(id);
  const project = p.status === "ACCEPTED" ? (await import("@/lib/db")).getDb().prepare("SELECT id, code FROM projects WHERE proposal_id = ?").get(id) as any : null;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Proposals", href: "/proposals" }, { label: p.code }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{p.customer_name} <span className="text-faint font-semibold">V{v.version}</span><StatusBadge status={st} /></span>}
        sub={<>{p.code} · <Link className="lnk" href={`/crm/leads/${p.lead_id}`}>{p.lead_code}</Link> · {inr(cur.pricing.total)} incl. tax{!isCurrent && <span className="ml-2 badge b-orange">Viewing older version</span>}</>}
        actions={<>
          <a className="btn" href={`/api/proposals/${id}/docx?v=${v.version}`}><span>Download Word (editable)</span></a>
          <Link className="btn" href={`/proposals/${id}/print?v=${v.version}`} target="_blank"><span>Generate PDF</span></Link>
          {w && isCurrent && st === "DRAFT" && <ActionButton action={W.approveProposalAction.bind(null, id)} className="btn btn-primary" confirm="Approve this proposal? It will be emailed to the customer automatically if auto-send is on in Settings." confirmLabel="Approve">Approve</ActionButton>}
          {w && email && (
            <ModalButton label={st === "APPROVED" ? "Send to customer" : "Email to customer"} icon="mail" title="Email proposal to customer" width={640} className={st === "APPROVED" ? "btn btn-primary" : "btn"}>
              <div className="space-y-3 text-[13px]">
                {!email.configured && <p className="rounded-md bg-[var(--orange-50)] p-2.5 text-[var(--orange)]">Outgoing email (SMTP) isn’t configured on this server yet, so “Send now” can’t deliver. Use “Open in email app”, or set the SMTP_* variables (see Settings).</p>}
                <Field label="To"><input readOnly value={email.to || "(no email on file — add one to the contact)"} className="input" /></Field>
                <Field label="Subject"><input readOnly value={email.subject} className="input" /></Field>
                <Field label="Message"><textarea readOnly rows={12} value={email.body} className="input" /></Field>
                <Field label="Attachments"><ul className="list-disc pl-5">{email.attachmentNames.map((n: string) => <li key={n}>{n}</li>)}</ul>{email.plan.length === 0 && <p className="hint">No plan view uploaded — the email mentions one. Upload it under “Plan view” below first.</p>}</Field>
                <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                  <a className="btn" href={email.mailto}><span>Open in email app</span></a>
                  {st === "APPROVED" && <ActionButton action={W.markSentAction.bind(null, id)} className="btn">Mark as sent</ActionButton>}
                  <ActionButton action={W.sendProposalNowAction.bind(null, id)} className="btn btn-primary" confirm={`Send to ${email.to}?`} confirmLabel="Send email">Send now</ActionButton>
                </div>
              </div>
            </ModalButton>)}
          {w && isCurrent && ["SENT", "NEGOTIATION"].includes(p.status) && (
            <>
              <ModalButton label="Log negotiation" title="Log customer request" className="btn" width={480}>
                <ActionForm action={W.logNegotiationAction.bind(null, id)} submitLabel="Log" className="space-y-3">
                  <Field label="Type"><Select name="kind" options={["Price revision request", "Scope change", "Added service", "Removed service", "Terms change", "Note"]} /></Field>
                  <Field label="Details *"><textarea name="note" required rows={3} className="input" /></Field>
                </ActionForm>
              </ModalButton>
              <ModalButton label="Revise" title="Create revised proposal" className="btn" width={460}>
                <ActionForm action={W.reviseProposalAction.bind(null, id)} submitLabel="Create revision" className="space-y-3">
                  <Field label="What changed?" hint={`Creates V${p.current_version + 1}; V${p.current_version} is preserved.`}><input name="note" className="input" placeholder="e.g. 3% discount, added monitoring" /></Field>
                </ActionForm>
              </ModalButton>
              <ModalButton label="Customer accepted" title="Accept proposal & create project" className="btn btn-primary" width={460}>
                <ActionForm action={W.acceptProposalAction.bind(null, id)} submitLabel="Accept & create project" className="space-y-3">
                  <p className="text-[13px] text-muted">The lead is marked won and the project is created with its stages, tasks and procurement plan.</p>
                  <Field label="Project manager" hint="They are notified immediately. Leave on Auto to pick the least-loaded PM."><select name="pm_id" className="input" defaultValue=""><option value="">Auto — least loaded</option>{pmOptions().map((m) => <option key={m.id} value={m.id}>{m.name} · {m.active} active</option>)}</select></Field>
                </ActionForm>
              </ModalButton>
              <ModalButton label="Lost" title="Mark proposal lost" className="btn btn-danger" width={420}>
                <ActionForm action={W.rejectProposalAction.bind(null, id)} submitLabel="Mark lost" danger className="space-y-3"><Field label="Reason"><input name="reason" className="input" /></Field></ActionForm>
              </ModalButton>
            </>)}
          {w && isCurrent && st === "APPROVED" && (
            <ModalButton label="Revise" title="Create revised proposal" className="btn" width={460}>
              <ActionForm action={W.reviseProposalAction.bind(null, id)} submitLabel="Create revision" className="space-y-3"><Field label="What changed?"><input name="note" className="input" /></Field></ActionForm>
            </ModalButton>)}
          {w && isCurrent && p.status === "ACCEPTED" && (
            <ModalButton label="New revision" icon="edit" title="Create revision of accepted proposal" className="btn" width={480}>
              <ActionForm action={W.reviseProposalAction.bind(null, id)} submitLabel="Create editable revision" className="space-y-3">
                <p className="text-[13px] text-muted">This creates V{p.current_version + 1} as an editable draft. The accepted V{p.current_version} stays untouched, and the project, payment schedule and invoices already created are not changed.</p>
                <Field label="What are you changing?"><input name="note" className="input" placeholder="e.g. corrected BOM, updated warranty" /></Field>
              </ActionForm>
            </ModalButton>)}
          {project && <Link className="btn btn-primary" href={`/projects/${project.id}`}>Open project {project.code}</Link>}
        </>} />

      <ProposalEditor key={`${id}-${v.version}-${v.total}`} mode="proposal" editable={w && cur.editable} liveNote={cur.version.approval_status !== "DRAFT" ? `Editing ${label(cur.version.approval_status)} version — project & invoices unchanged` : undefined} doc={cur.doc} vars={cur.vars} items={cur.pricing.items} discount={cur.pricing.discount} taxes={cur.taxes} terms={cur.terms}
        paymentTemplates={settings().payment_templates} plan={plans.filter((x) => /\.(png|jpe?g)$/i.test(x.name)).map((x) => `/api/files/${x.file_path}`)} save={W.saveProposalAction.bind(null, id)} />

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card title="Plan view / single line diagram" flush actions={w && (
          <ModalButton label="Upload" icon="upload" title="Upload plan view" className="btn btn-sm" width={460}>
            <ActionForm action={W.uploadPlanViewAction.bind(null, id)} submitLabel="Upload" className="space-y-3">
              <Field label="File (PNG, JPG or PDF)" hint="Shown in “Solar plant layout”, embedded in the Word file, and attached to the email."><input name="file" type="file" accept=".png,.jpg,.jpeg,.pdf" required className="input !h-auto py-1.5 text-xs" /></Field>
            </ActionForm>
          </ModalButton>)}>
          {plans.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">Nothing uploaded yet. The customer email says a plan view is attached, so add one before sending.</p> : (
            <ul>{plans.map((x) => <li key={x.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px] last:border-0"><a className="lnk" href={`/api/files/${x.file_path}`} target="_blank">{x.name}</a>{w && <ActionButton action={W.removePlanViewAction.bind(null, x.id)} className="btn btn-ghost btn-sm" confirm={`Remove ${x.name}?`} confirmLabel="Remove" danger>Remove</ActionButton>}</li>)}</ul>)}
        </Card>
        <Card title="Emails sent" flush>
          {outbox.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">No emails yet. When the proposal is approved it is emailed automatically (Settings → Email).</p> : (
            <ul>{outbox.map((o) => <li key={o.id} className="border-b border-line px-4 py-2.5 text-[13px] last:border-0"><div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{o.to_addr || "no recipient"}</span><StatusBadge status={o.status === "SENT" ? "DONE" : o.status === "FAILED" ? "delayed" : "PENDING"}>{o.status === "NOT_CONFIGURED" ? "Not sent · SMTP off" : o.status === "NO_RECIPIENT" ? "Not sent · no email" : label(o.status)}</StatusBadge></div><div className="text-xs text-muted">{fmtDateTime(o.created_at)} · {o.trigger} · {(JSON.parse(o.attachments ?? "[]") as string[]).length} attachment(s){o.error ? ` · ${o.error}` : ""}</div></li>)}</ul>)}
        </Card>
      </div>

      <Card title="Version history" className="mt-6" flush>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Version</th><th className="r">Amount</th><th>Change</th><th>Created by</th><th>Date</th><th>Approval</th><th /></tr></thead>
          <tbody>{cur.versions.map((x: any) => (
            <tr key={x.version} className={x.version === v.version ? "bg-[var(--green-50)]" : ""}>
              <td className="font-bold">V{x.version}</td><td className="r num font-semibold">{inr(x.total)}</td><td className="text-muted">{x.note}</td><td>{x.created_by ?? "—"}</td><td>{fmtDateTime(x.created_at)}</td>
              <td><StatusBadge status={x.approval_status} /></td>
              <td className="r">{x.version === v.version ? <span className="text-xs text-faint">Viewing</span> : <Link className="btn btn-sm" href={`/proposals/${id}?v=${x.version}`}>View</Link>}</td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      <p className="mt-3 text-xs text-faint">Status: {label(p.status)}. Approved and sent versions are locked; revisions never overwrite earlier versions.</p>
    </div>
  );
}
