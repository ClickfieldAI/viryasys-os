import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, VERTICALS, label } from "@/lib/config";
import { listInbox, inboxCounts, duplicatesFor, learned, REVIEW_THRESHOLD } from "@/lib/services/inbox";
import { getDb, getSetting } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, Icon, Field } from "@/components/ui";
import { ActionForm, ActionButton, ModalButton, AutoRefresh } from "@/components/client";
import { Select } from "@/components/forms";
import { createFromMessageAction, ignoreMessageAction, ingestManualAction, reprocessMessageAction } from "@/app/actions/crm";
import { fmtKw, timeAgo } from "@/lib/util";

export const metadata = { title: "AI Inbox" };
export const dynamic = "force-dynamic";

const ICON: Record<string, string> = { telegram: "chat", google_chat: "chat", email: "mail", website: "map", voice: "phone", manual: "edit", upload: "upload" };
const TABS: [string, string][] = [["ACTIVE", "Needs action"], ["REVIEW", "Review queue"], ["READY", "Ready"], ["LEAD_CREATED", "Converted"], ["IGNORED", "Ignored"], ["ALL", "All"]];

export default async function AiInbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("ai");
  const sp = await searchParams;
  const tab = sp.tab ?? "ACTIVE";
  const counts = inboxCounts();
  const all = listInbox("ALL");
  const rows = all.filter((m) => (tab === "ALL" ? true : tab === "ACTIVE" ? ["REVIEW", "READY"].includes(m.processing_status) : m.processing_status === tab));
  const w = can(user.role, "ai", "w");
  const auto = getSetting("ai_auto_create", false);
  const teach = learned();
  const reviewOpen = (getDb().prepare("SELECT COUNT(*) c FROM ai_reviews WHERE status='OPEN'").get() as any).c;

  return (
    <div>
      <AutoRefresh seconds={20} />
      <PageHeader title="AI Inbox" sub="Unstructured messages become structured leads. Every original message is stored, never discarded."
        actions={w && (
          <ModalButton label="Simulate incoming message" icon="plus" title="Feed a message to the AI" width={560}>
            <ActionForm action={ingestManualAction} submitLabel="Process message" className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Source"><Select name="source" options={[["telegram", "Telegram"], ["google_chat", "Google Chat"], ["email", "Email"], ["voice", "Voice transcript"], ["upload", "Uploaded message / document"]]} /></Field>
                <Field label="Sender"><input name="sender" className="input" placeholder="Name or handle" /></Field>
              </div>
              <Field label="Message *"><textarea name="body" required rows={5} className="input" placeholder={"New warehouse lead.\nChennai.\n500kw.\nRavi contact.\nNeed rooftop solar."} /></Field>
              <p className="hint">Live channels post to <code>/api/webhooks/telegram</code>, <code>/google_chat</code> and <code>/website</code> with the shared secret header. This form runs the same pipeline.</p>
            </ActionForm>
          </ModalButton>)} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[["Needs review", counts.REVIEW ?? 0, "orange"], ["Ready to convert", counts.READY ?? 0, "green"], ["Converted to leads", counts.LEAD_CREATED ?? 0, "navy"], ["Learned from corrections", Object.keys(teach).length, "solar"]].map(([l, v, t]) => (
          <div key={l as string} className="card p-3.5"><div className="eyebrow">{l}</div><div className="mt-1 text-2xl font-extrabold num">{v}</div></div>))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(([k, l]) => <Link key={k} href={`/ai-inbox?tab=${k}`} className={`btn btn-sm ${tab === k ? "btn-dark" : ""}`}>{l}</Link>)}
        </div>
        <div className="text-xs text-muted">Confidence below {Math.round(REVIEW_THRESHOLD * 100)}% or ambiguous → review queue · {reviewOpen} open review item{reviewOpen === 1 ? "" : "s"} · Auto-create {auto ? "ON" : "off"} (Settings)</div>
      </div>

      {rows.length === 0 ? <Card><EmptyState icon="inbox" title="Inbox is clear" body="New Telegram, Google Chat, email, website and voice messages will land here for AI understanding." /></Card> : (
        <div className="space-y-4">
          {rows.map((m) => {
            const ex = m.extraction;
            const f = ex?.fields;
            const conf = Math.round((m.confidence ?? 0) * 100);
            const open = ["REVIEW", "READY"].includes(m.processing_status);
            const dups = open && ex ? duplicatesFor(m.id) : [];
            const amb = ex?.ambiguities ?? [];
            return (
              <Card key={m.id} className="overflow-hidden" flush>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[var(--sunk)] px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold"><Icon name={ICON[m.source] ?? "chat"} size={15} className="text-muted" />{label(m.source)}<span className="font-normal text-muted">· {m.sender ?? "unknown"}{m.subject ? ` · ${m.subject}` : ""}</span></div>
                  <div className="flex items-center gap-2"><span className="text-xs text-faint">{timeAgo(m.received_at)}</span><StatusBadge status={m.processing_status} />{m.linked_entity && <span className="badge b-navy">{m.linked_entity.replace("lead:", "")}</span>}</div>
                </div>
                <div className="grid gap-0 lg:grid-cols-[1fr_1.15fr]">
                  <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
                    <div className="eyebrow mb-1.5">Incoming message</div>
                    <p className="whitespace-pre-line rounded-md bg-[var(--sunk)] p-3 text-[13.5px] leading-relaxed">“{m.body}”</p>
                  </div>
                  <div className="p-4">
                    {m.processing_status === "NOT_A_LEAD" ? <p className="text-[13px] text-muted">AI did not find a solar requirement in this message. It’s stored for reference.</p> : f ? (
                      <>
                        <div className="mb-2 flex items-center justify-between"><div className="eyebrow !text-[var(--green-700)]">AI interpretation</div>
                          <span className={`badge num ${conf >= 90 ? "b-green" : conf >= 75 ? "b-solar" : "b-orange"}`}>{conf}% confidence</span></div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                          {([["Company", f.company ?? "Unknown"], ["Vertical", f.vertical ?? "—"], ["Location", f.location ?? "—"], ["Capacity", fmtKw(f.capacity_kw)], ["Contact", f.contact ?? "—"], ["Intent", f.intent ?? "—"]] as [string, string][]).map(([k, v]) => (
                            <div key={k}><dt className="text-[11px] font-semibold text-faint">{k}</dt><dd className={`font-semibold ${v === "Unknown" || v === "—" ? "text-faint" : ""}`}>{v}</dd></div>))}
                        </dl>
                        {amb.length > 0 && open && w && (
                          <div className="mt-3 rounded-md border border-[#f0d9a8] bg-[var(--solar-50)] p-3">
                            <div className="eyebrow !text-[#8a6a00]">AI review required</div>
                            <p className="mt-1 text-[13px]">{amb[0].reason}. Which is it?</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {amb[0].options.map((o: string) => (
                                <ActionForm key={o} action={createFromMessageAction.bind(null, m.id)} className="inline" resetOnSuccess={false}>
                                  <input type="hidden" name="vertical" value={o === "College" ? "Other" : o} />
                                  <button className="btn btn-sm" type="submit">{o}</button>
                                </ActionForm>))}
                            </div>
                            <p className="hint">Your choice creates the lead and teaches the AI for next time.</p>
                          </div>)}
                        {dups.length > 0 && w && (
                          <div className="mt-3 rounded-md border border-[#e7c3c0] bg-[var(--red-50)] p-3">
                            <div className="eyebrow !text-[var(--red)]">Possible duplicate detected</div>
                            <p className="mt-1 text-[13px] font-semibold">{dups[0].customer} <span className="font-normal text-muted">· existing lead {dups[0].code} · {dups[0].confidence}% match ({dups[0].reasons.join(", ")})</span></p>
                            <div className="mt-2 flex gap-2">
                              <ActionForm action={createFromMessageAction.bind(null, m.id)} resetOnSuccess={false}><input type="hidden" name="use_existing" value={dups[0].lead_id} /><button className="btn btn-sm btn-dark" type="submit">Use existing lead</button></ActionForm>
                              <ActionForm action={createFromMessageAction.bind(null, m.id)} resetOnSuccess={false}><button className="btn btn-sm" type="submit">Create new</button></ActionForm>
                            </div>
                          </div>)}
                      </>) : null}
                  </div>
                </div>
                {open && w && f && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                    {dups.length === 0 && amb.length === 0 && (
                      <ActionForm action={createFromMessageAction.bind(null, m.id)} resetOnSuccess={false}><button className="btn btn-sm btn-primary" type="submit">Create lead</button></ActionForm>)}
                    <ModalButton label="Edit" icon="edit" title="Review & edit before creating" className="btn btn-sm" width={620}>
                      <ActionForm action={createFromMessageAction.bind(null, m.id)} submitLabel="Create lead" className="space-y-3" resetOnSuccess={false}>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Company"><input name="company" defaultValue={f.company ?? ""} className="input" /></Field>
                          <Field label="Contact"><input name="contact" defaultValue={f.contact ?? ""} className="input" /></Field>
                          <Field label="Phone"><input name="phone" defaultValue={f.phone ?? ""} className="input" /></Field>
                          <Field label="Email"><input name="email" defaultValue={f.email ?? ""} className="input" /></Field>
                          <Field label="Vertical"><Select name="vertical" defaultValue={f.vertical} placeholder="Select…" options={[...VERTICALS]} /></Field>
                          <Field label="Solar type"><Select name="solar_type" defaultValue={f.solar_type} placeholder="Select…" options={["Rooftop", "Ground mount", "Carport"]} /></Field>
                          <Field label="Location"><input name="location" defaultValue={f.location ?? ""} className="input" /></Field>
                          <Field label="Capacity (kW)"><input name="capacity_kw" type="number" step="any" defaultValue={f.capacity_kw ?? ""} className="input" /></Field>
                        </div>
                        <p className="hint">Anything you change is stored as a correction for the AI.</p>
                      </ActionForm>
                    </ModalButton>
                    <ActionButton action={reprocessMessageAction.bind(null, m.id)} className="btn btn-sm">Re-run AI</ActionButton>
                    <ActionButton action={ignoreMessageAction.bind(null, m.id)} className="btn btn-sm btn-ghost" confirm="Ignore this message?" confirmLabel="Ignore">Ignore</ActionButton>
                  </div>)}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
