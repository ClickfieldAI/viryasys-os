import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { poFull, itemLines, promiseHistory, impactOf, projectImpacts, unassignedQty, APPROVER_ROLES, canSeeProject, type Line } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, Tabs, Track, Timeline, EmptyState, Field, Icon } from "@/components/ui";
import { ActionButton, ActionForm, ModalButton } from "@/components/client";
import { Select } from "@/components/forms";
import { RiskBadge } from "@/components/proc";
import * as A from "@/app/actions/procurement";
import { inr, fmtDate, fmtDateTime, dateOnly } from "@/lib/util";
import { today } from "@/lib/clock";

export const dynamic = "force-dynamic";

const DOC_TYPES = ["Customer Order", "BOQ", "Purchase Order", "Vendor Quotation", "Vendor Invoice", "Payment Proof", "Delivery Note", "GRN", "Inspection Photos", "Customer Acknowledgement", "Material Issue", "Material Return"];

export default async function PoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const id = Number((await params).id);
  const tab = (await searchParams).tab ?? "overview";
  const d = poFull(id);
  if (!d) notFound();
  const viewer = { id: user.id, role: user.role };
  if (!canSeeProject(viewer, d.po.project_id)) notFound();
  const { po } = d;
  const db = getDb();
  const w = can(user.role, "procurement", "w");
  const approver = APPROVER_ROLES.includes(user.role) && (po.owner_id !== user.id || user.role === "md");
  const lines = itemLines({ po_id: id });
  const deliveries = db.prepare(`SELECT d.*, (SELECT GROUP_CONCAT(i.description, ', ') FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = d.id) items,
    (SELECT result FROM material_inspections WHERE delivery_id = d.id) inspection, (SELECT code FROM grns WHERE delivery_id = d.id) grn, (SELECT id FROM grns WHERE delivery_id = d.id) grn_id, (SELECT code FROM delivery_notes WHERE delivery_id = d.id) dn, (SELECT id FROM delivery_notes WHERE delivery_id = d.id) dn_id
    FROM deliveries d WHERE d.po_id = ? ORDER BY d.id`).all(id) as any[];
  const docs = db.prepare("SELECT * FROM procurement_documents WHERE po_id = ? OR delivery_id IN (SELECT id FROM deliveries WHERE po_id = ?) ORDER BY id DESC").all(id, id) as any[];
  const activity = db.prepare("SELECT * FROM procurement_activity_logs WHERE po_id = ? ORDER BY id DESC").all(id) as any[];
  const audit = db.prepare("SELECT * FROM audit_logs WHERE entity = 'purchase_order' AND entity_id = ? ORDER BY id DESC").all(po.code) as any[];
  const reqIds = lines.map((l) => l.requirement_id).filter(Boolean);
  const ledgerRows = reqIds.length ? db.prepare(`SELECT t.*, u.name by_name FROM inventory_transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.requirement_id IN (${reqIds.map(() => "?").join(",")}) ORDER BY t.id DESC LIMIT 60`).all(...reqIds) as any[] : [];
  const impacts = projectImpacts(po.project_id).filter((i) => i.line.po_id === id);
  const projHealth = (db.prepare("SELECT health FROM projects WHERE id = ?").get(po.project_id) as any)?.health;
  const insp = db.prepare("SELECT mi.*, d.code dcode FROM material_inspections mi JOIN deliveries d ON d.id = mi.delivery_id WHERE d.po_id = ? ORDER BY mi.id DESC").all(id) as any[];

  const anyDispatch = deliveries.some((x) => x.dispatched_at), anyRecv = deliveries.some((x) => x.received_at), anyInsp = insp.length > 0, anyGrn = deliveries.some((x) => x.grn), anyAck = deliveries.some((x) => x.status === "ACKNOWLEDGED");
  const anyLate = lines.some((l) => l.status === "DELAYED");
  const confirmed = d.confirmations.length > 0;
  const steps = [
    { label: "Customer order", done: true }, { label: "Advance received", done: true }, { label: "Procurement authorized", done: true }, { label: "PO created", done: true },
    { label: "PO approved", done: !!po.approved_at }, { label: "Released to vendor", done: !!po.sent_at }, { label: "Vendor confirmed", done: confirmed && po.status !== "REJECTED" },
    { label: "Vendor payment", done: d.paid >= po.total - 0.5 }, { label: "Dispatch", done: anyDispatch }, { label: "Delivery", done: anyRecv && lines.every((l) => l.remaining <= 1e-9) },
    { label: "Inspection", done: anyInsp }, { label: "GRN", done: anyGrn }, { label: "Acknowledgement", done: anyAck },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  const track = steps.map((s, i) => ({ label: s.label, state: (s.done ? "done" : i === firstOpen ? (anyLate && s.label === "Delivery" ? "late" : "current") : "todo") as any }));

  const tabs = [{ key: "overview", label: "Overview" }, { key: "items", label: "Items", count: lines.length }, { key: "vendor", label: "Vendor" }, { key: "delivery", label: "Delivery", count: deliveries.length }, { key: "inspection", label: "Inspection", count: insp.length },
    { key: "docs", label: "Documents", count: docs.length }, { key: "movement", label: "Material movement" }, { key: "impact", label: "Project impact", count: impacts.length }, { key: "activity", label: "Activity", count: activity.length }, { key: "audit", label: "Audit log" }];
  const base = `/procurement/${id}`;
  const lineOf = (itemId: number) => lines.find((l) => l.id === itemId) as Line | undefined;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Purchase orders", href: "/procurement/orders" }, { label: po.code }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{po.code}<span className="text-[15px] font-semibold text-muted">V{po.version}</span><StatusBadge status={po.status} /></span>}
        sub={<><Link className="lnk" href={`/procurement/plans/${po.project_id}`}>{po.customer_name} · {po.project_code}</Link> · {po.capacity_kw} kW · {po.vendor_name}</>}
        actions={<>
          <Link className="btn" href={`/procurement-print/po/${id}`} target="_blank"><Icon name="file" size={14} /> Download PDF</Link>
          {w && ["DRAFT", "REJECTED"].includes(po.status) && <Link className="btn" href={`/procurement/new?edit=${id}`}><Icon name="edit" size={14} /> Edit</Link>}
          {w && po.status === "DRAFT" && <ActionButton action={A.submitPOAction.bind(null, id)} className="btn btn-primary" confirm="Submit this PO for approval?" confirmLabel="Submit">Submit for approval</ActionButton>}
          {po.status === "PENDING_APPROVAL" && approver && <>
            <ActionButton action={A.approvePOAction.bind(null, id)} className="btn btn-primary" confirm={`Approve ${po.code} for ${inr(po.total)}? It will be released to ${po.vendor_name}.`} confirmLabel="Approve">Approve</ActionButton>
            <ModalButton label="Reject" title="Reject PO" className="btn btn-danger" width={420}><ActionForm action={A.rejectPOAction.bind(null, id)} submitLabel="Reject PO" danger className="space-y-3"><Field label="Reason *"><input name="reason" required className="input" /></Field></ActionForm></ModalButton></>}
          {po.status === "PENDING_APPROVAL" && !approver && <span className="badge b-orange"><Icon name="lock" size={11} /> Awaiting MD / Finance approval</span>}
          {w && po.status === "APPROVED" && <ActionButton action={A.releasePOAction.bind(null, id)} className="btn btn-primary" confirm={`Release ${po.code} to ${po.vendor_name}?`} confirmLabel="Release">Release to vendor</ActionButton>}
          {w && ["SENT", "VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(po.status) && (
            <ModalButton label={po.status === "SENT" ? "Record vendor confirmation" : "Update confirmation"} title="Vendor confirmation" className={po.status === "SENT" ? "btn btn-primary" : "btn"} width={860}>
              <ActionForm action={A.confirmPOAction.bind(null, id)} submitLabel="Save confirmation" className="space-y-3" resetOnSuccess={false}>
                <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 760 }}><thead><tr><th>Item</th><th className="r">Ordered</th><th>Vendor says</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 140 }}>Expected date</th><th style={{ width: 100 }}>Time</th><th>Remarks</th></tr></thead>
                  <tbody>{lines.map((l) => <tr key={l.id}><td className="font-semibold">{l.description}</td><td className="r num">{l.qty} {l.unit}</td>
                    <td><Select name={`status_${l.id}`} defaultValue="ACCEPTED" options={[["ACCEPTED", "Accepted"], ["PARTIAL", "Partially accepted"], ["REJECTED", "Rejected"]]} className="!h-8" /></td>
                    <td><input name={`qty_${l.id}`} type="number" step="any" min="0" max={l.qty} defaultValue={l.target || l.qty} className="input !h-8" /></td>
                    <td><input name={`date_${l.id}`} type="date" defaultValue={l.expected_date ?? ""} className="input !h-8" /></td><td><input name={`time_${l.id}`} type="time" defaultValue="10:00" className="input !h-8" /></td><td><input name={`remarks_${l.id}`} className="input !h-8" /></td></tr>)}</tbody></table></div>
                <p className="hint">Accepted/partial lines need an expected date. A changed date on an already-confirmed line is kept as a new promise — the original is never overwritten.</p>
              </ActionForm>
            </ModalButton>)}
          {["SENT", "VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(po.status) && d.balance > 0.5 && ["finance", "procurement", "md"].includes(user.role) && (
            <ModalButton label="Record payment" title={`Vendor payment — ${po.code}`} className="btn" width={440}>
              <ActionForm action={A.vendorPaymentAction.bind(null, id)} submitLabel="Record payment" className="space-y-3">
                <Field label={`Amount (payable ${inr(d.balance)})`}><input name="amount" type="number" step="any" required defaultValue={d.balance} className="input" /></Field>
                <Field label="Mode"><Select name="mode" options={["NEFT", "RTGS", "UPI", "Cheque", "Cash"]} /></Field>
                <Field label="Reference / UTR"><input name="reference" className="input" /></Field><Field label="Note"><input name="note" className="input" /></Field>
              </ActionForm></ModalButton>)}
          {w && ["VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED"].includes(po.status) && lines.some((l) => unassignedQty(l.id) > 0) && (
            <ModalButton label="Plan delivery" title="Plan a delivery" className="btn" width={560}>
              <ActionForm action={A.createDeliveryAction.bind(null, id)} submitLabel="Plan delivery" className="space-y-3">
                <Field label="Expected date" hint="Blank → latest vendor promise of the chosen items"><input name="expected" type="date" className="input" /></Field>
                <div className="space-y-2">{lines.map((l) => { const free = unassignedQty(l.id); return <div key={l.id} className="flex items-center justify-between gap-3 text-[13px]"><span>{l.description}<span className="ml-1 text-xs text-muted">(left {free} {l.unit})</span></span><input name={`qty_${l.id}`} type="number" step="any" min="0" max={free} defaultValue={0} disabled={free <= 0} className="input !h-8 !w-[100px]" /></div>; })}</div>
              </ActionForm></ModalButton>)}
          {w && !["CANCELLED", "REJECTED"].includes(po.status) && !anyRecv && (
            <ModalButton label="Cancel PO" title="Cancel PO" className="btn btn-danger" width={420}><ActionForm action={A.cancelPOAction.bind(null, id)} submitLabel="Cancel PO" danger className="space-y-3"><Field label="Reason *"><input name="reason" required className="input" /></Field></ActionForm></ModalButton>)}
        </>} />

      <div className="card mb-5 p-4"><Track steps={track} /></div>
      {lines.some((l) => l.status === "DELAYED") && <div className="mb-5 rounded-lg border border-[#e7c3c0] bg-[var(--red-50)] p-3 text-[13px]"><b>Delayed:</b> {lines.filter((l) => l.status === "DELAYED").map((l) => `${l.description} (${l.delay_days}d)`).join(" · ")}</div>}
      <Tabs tabs={tabs} active={tab} base={base} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Purchase order" className="lg:col-span-2">
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {([["PO number", po.code], ["Project", `${po.project_name}`], ["Customer", po.customer_name], ["Vendor", po.vendor_name], ["PO date", fmtDate(po.po_date)], ["Required delivery", fmtDate(po.required_date)], ["Payment terms", po.payment_terms ?? "—"], ["Delivery terms", po.delivery_terms ?? "—"], ["Billing address", po.billing_address ?? "—"], ["Delivery address", po.delivery_address ?? "—"], ["Owner", po.owner_name ?? "—"], ["Approved by", po.approver_name ? `${po.approver_name} · ${fmtDateTime(po.approved_at)}` : "—"], ["Notes", po.notes ?? "—"]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{v}</dd></div>)}
            </dl>
          </Card>
          <div className="space-y-5">
            <Card title="Value" flush><table className="tbl"><tbody>
              <tr><td className="text-muted">Subtotal</td><td className="r num">{inr(po.subtotal)}</td></tr><tr><td className="text-muted">Tax</td><td className="r num">{inr(po.tax)}</td></tr>
              <tr><td className="font-bold">Total</td><td className="r num font-extrabold">{inr(po.total)}</td></tr><tr><td className="text-muted">Paid to vendor</td><td className="r num text-[var(--green-700)]">{inr(d.paid)}</td></tr>
              <tr><td className="text-muted">Payable</td><td className={`r num font-bold ${d.balance > 0.5 ? "text-[var(--orange)]" : ""}`}>{inr(d.balance)}</td></tr></tbody></table></Card>
            <Card title="Progress">
              <div className="space-y-1.5 text-[13px]">{(["ACKNOWLEDGED", "INSPECTED", "RECEIVED", "IN_TRANSIT", "ORDERED", "DELAYED", "AWAITING_CONFIRMATION"] as const).map((s) => { const c = lines.filter((l) => l.status === s).length; return c ? <div key={s} className="flex items-center justify-between"><StatusBadge status={s === "DELAYED" ? "delayed" : s}>{label(s)}</StatusBadge><b className="num">{c} line{c > 1 ? "s" : ""}</b></div> : null; })}</div>
            </Card>
          </div>
        </div>)}

      {tab === "items" && (
        <Card title="Items — each tracked on its own dates" flush>
          <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 1000 }}>
            <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th><th className="r">Confirmed</th><th>Promised</th><th className="r">Received / accepted</th><th>Status</th><th /></tr></thead>
            <tbody>{lines.map((l) => { const h = promiseHistory(l.id); return (
              <tr key={l.id}>
                <td className="font-semibold">{l.description}<div className="text-xs font-normal text-muted">{l.category}{l.spec ? ` · ${l.spec}` : ""}</div></td>
                <td className="r num">{l.qty} {l.unit}</td><td className="r num">{inr(l.rate)}</td><td className="r num font-semibold">{inr(l.qty * l.rate)}</td>
                <td className="r num">{l.conf_status == null ? <span className="text-faint">—</span> : l.conf_status === "REJECTED" ? <span className="text-[var(--red)]">Rejected</span> : `${l.target}`}</td>
                <td>{h.promises.length === 0 ? <span className="text-faint">—</span> : (
                  <details><summary className="cursor-pointer list-none">{h.promises.length > 1 ? <span><s className="text-faint">{fmtDate(h.original).replace(/ \d{4}$/, "")}</s> <b className={l.status === "DELAYED" ? "text-[var(--red)]" : ""}>{fmtDate(h.current).replace(/ \d{4}$/, "")}</b></span> : <b>{fmtDate(h.current).replace(/ \d{4}$/, "")}</b>} {h.totalDelay > 0 && <span className="badge b-red ml-1">+{h.totalDelay}d</span>}</summary>
                    <ol className="mt-1.5 space-y-0.5 text-xs text-muted">{h.promises.map((p: any) => <li key={p.seq}>Promise #{p.seq}: <b className="text-ink">{fmtDate(p.promised_date)}</b>{p.reason ? ` — ${p.reason}` : ""} <span className="text-faint">({fmtDateTime(p.at)})</span></li>)}{h.actual && <li>Actual: <b className="text-ink">{fmtDate(h.actual)}</b></li>}<li className="font-bold text-ink">Total delay: {h.totalDelay} day{h.totalDelay === 1 ? "" : "s"}</li></ol></details>)}</td>
                <td className="r num">{l.accepted + l.pending_inspection}/{l.target}{l.short > 0 && <div className="text-xs text-[var(--red)]">short {l.short}</div>}{l.damaged > 0 && <div className="text-xs text-[var(--red)]">damaged {l.damaged}</div>}</td>
                <td><StatusBadge status={l.status === "DELAYED" ? "delayed" : l.status}>{l.status === "DELAYED" ? `Delayed ${l.delay_days}d` : undefined}</StatusBadge></td>
                <td className="r">{w && h.promises.length > 0 && l.remaining > 0 && (
                  <ModalButton label="New date" title={`Vendor changed the date — ${l.description}`} className="btn btn-sm" width={440}>
                    <ActionForm action={A.updatePromiseAction.bind(null, l.id)} submitLabel="Record new promise" className="space-y-3">
                      <p className="text-[13px] text-muted">Current promise {fmtDate(h.current)}. The original ({fmtDate(h.original)}) is always kept.</p>
                      <Field label="New promised date *"><input name="date" type="date" required className="input" min={dateOnly(new Date(0))} defaultValue={h.current ?? today()} /></Field>
                      <Field label="Time"><input name="time" type="time" className="input" /></Field><Field label="Reason"><input name="reason" className="input" placeholder="e.g. stock delay at vendor" /></Field>
                    </ActionForm></ModalButton>)}</td>
              </tr>); })}</tbody>
          </table></div>
        </Card>)}

      {tab === "vendor" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Vendor"><dl className="space-y-2 text-[13.5px]"><div><dt className="eyebrow">Name</dt><dd className="font-bold">{po.vendor_name}</dd></div><div><dt className="eyebrow">Contact</dt><dd>{po.vendor_phone ?? "—"} · {po.vendor_email ?? "—"}</dd></div><Link className="lnk text-xs" href={`/procurement/vendors/${po.vendor_id}`}>Vendor profile & performance →</Link></dl></Card>
          <Card title="Vendor payments" flush>{d.payments.length === 0 ? <EmptyState icon="wallet" title="No payment yet" body={po.status === "SENT" ? "Payment follows the vendor’s confirmation." : undefined} /> : <table className="tbl"><tbody>{d.payments.map((p: any) => <tr key={p.id}><td>{fmtDate(p.paid_on)}</td><td>{p.mode}<div className="text-xs text-muted">{p.reference}</div></td><td className="text-xs text-muted">{p.by_name}</td><td className="r num font-semibold">{inr(p.amount)}</td></tr>)}</tbody></table>}</Card>
          <Card title="Confirmation history (append-only)" flush className="lg:col-span-2">{d.confirmations.length === 0 ? <EmptyState icon="check" title="Not confirmed yet" body="Record the vendor’s confirmation once they reply." /> : (
            <table className="tbl"><thead><tr><th>When</th><th>Item</th><th>Vendor said</th><th className="r">Qty</th><th>Expected</th><th>Remarks</th><th>Recorded by</th></tr></thead><tbody>{d.confirmations.map((c: any) => <tr key={c.id}><td>{fmtDateTime(c.at)}</td><td>{c.description}</td><td><StatusBadge status={c.status === "PARTIAL" ? "PARTIALLY_CONFIRMED" : c.status === "ACCEPTED" ? "VENDOR_CONFIRMED" : "REJECTED"}>{label(c.status)}</StatusBadge></td><td className="r num">{c.confirmed_qty}</td><td>{fmtDate(c.expected_date)}{c.expected_time ? ` · ${c.expected_time}` : ""}</td><td className="text-muted">{c.remarks}</td><td>{c.by_name}</td></tr>)}</tbody></table>)}</Card>
        </div>)}

      {tab === "delivery" && (
        <Card title="Deliveries against this PO" flush>{deliveries.length === 0 ? <EmptyState icon="truck" title="No delivery planned yet" body="Deliveries are created automatically when the vendor confirms, grouped by promised date." /> : (
          <table className="tbl"><thead><tr><th>Delivery</th><th>Items</th><th>Expected</th><th>Dispatched</th><th>Received</th><th>Status</th><th /></tr></thead><tbody>{deliveries.map((x) => <tr key={x.id}><td><Link className="lnk num" href={`/procurement/deliveries/${x.id}`}>{x.code}</Link></td><td className="max-w-[280px] truncate">{x.items}</td><td>{fmtDate(x.expected_date)}</td><td>{x.dispatched_at ? fmtDateTime(x.dispatched_at) : "—"}</td><td>{x.received_at ? fmtDateTime(x.received_at) : "—"}</td><td><StatusBadge status={x.status} /></td><td className="r"><Link className="btn btn-sm" href={`/procurement/deliveries/${x.id}`}>Open</Link></td></tr>)}</tbody></table>)}</Card>)}

      {tab === "inspection" && (
        <Card title="Inspections, GRNs and delivery notes" flush>{insp.length === 0 ? <EmptyState icon="tool" title="No inspection yet" body="The site engineer inspects each delivery on arrival." /> : (
          <table className="tbl"><thead><tr><th>Delivery</th><th>Inspector</th><th>When</th><th>Result</th><th>GRN</th><th>Delivery note</th></tr></thead><tbody>{insp.map((i) => { const dl = deliveries.find((x) => x.code === i.dcode); return <tr key={i.id}><td><Link className="lnk num" href={`/procurement/deliveries/${dl?.id}`}>{i.dcode}</Link></td><td>{i.inspector_name}</td><td>{fmtDateTime(i.at)}</td><td><StatusBadge status={i.result} tone={i.result === "ACCEPTED" ? "green" : i.result === "PARTIALLY_ACCEPTED" ? "orange" : "red"}>{label(i.result)}</StatusBadge></td><td>{dl?.grn_id ? <Link className="lnk num" href={`/procurement-print/grn/${dl.grn_id}`} target="_blank">{dl.grn}</Link> : "—"}</td><td>{dl?.dn_id ? <Link className="lnk num" href={`/procurement-print/dn/${dl.dn_id}`} target="_blank">{dl.dn}</Link> : "—"}</td></tr>; })}</tbody></table>)}</Card>)}

      {tab === "docs" && (
        <Card title="Documents" flush actions={w && <ModalButton label="Attach" icon="upload" title="Attach document" className="btn btn-sm" width={460}><ActionForm action={A.uploadProcDocAction} submitLabel="Upload" className="space-y-3"><input type="hidden" name="po_id" value={id} /><Field label="Type *"><Select name="doc_type" required options={DOC_TYPES} /></Field><Field label="File * (max 15 MB)"><input name="file" type="file" required className="input !h-auto py-1.5 text-xs" /></Field></ActionForm></ModalButton>}>
          {docs.length === 0 ? <EmptyState icon="folder" title="No documents attached" body="Vendor quotation, invoice, payment proof, delivery photos and more live here, linked to the project." /> : <table className="tbl"><thead><tr><th>Name</th><th>Type</th><th>Added</th></tr></thead><tbody>{docs.map((x) => <tr key={x.id}><td className="font-semibold">{x.file_path ? <a className="lnk" href={`/api/files/${x.file_path}`} target="_blank">{x.name}</a> : x.name}</td><td>{x.doc_type}</td><td>{fmtDateTime(x.created_at)}</td></tr>)}</tbody></table>}</Card>)}

      {tab === "movement" && (
        <Card title="Material movement (ledger)" flush>{ledgerRows.length === 0 ? <EmptyState icon="cube" title="No material has moved yet" body="Receipts, acceptances, issues, consumption and returns appear here as they happen." /> : (
          <table className="tbl"><thead><tr><th>When</th><th>Material</th><th>Movement</th><th className="r">Qty</th><th className="r">Store</th><th className="r">Site</th><th>Ref</th><th>By</th></tr></thead><tbody>{ledgerRows.map((t) => <tr key={t.id}><td>{fmtDateTime(t.at)}</td><td>{t.material}</td><td><StatusBadge status={t.type === "ACCEPTED" || t.type === "RECEIVED" ? "ACCEPTED" : t.type === "DAMAGED" || t.type === "REJECTED" ? "DAMAGED" : "ISSUED"}>{label(t.type)}</StatusBadge></td><td className="r num">{t.qty}</td><td className="r num">{t.store_delta ? (t.store_delta > 0 ? "+" : "") + t.store_delta : ""}</td><td className="r num">{t.site_delta ? (t.site_delta > 0 ? "+" : "") + t.site_delta : ""}</td><td className="num text-xs">{t.ref_code ?? ""}</td><td className="text-xs text-muted">{t.by_name}</td></tr>)}</tbody></table>)}</Card>)}

      {tab === "impact" && (
        impacts.length === 0 ? <Card><EmptyState icon="check" title="No project impact" body="No item on this PO is late or promised later than the project needs it." /></Card> : (
          <div className="grid gap-4 md:grid-cols-2">{impacts.map((im) => (
            <div key={im.line.id} className="card card-b">
              <div className="flex items-center justify-between"><div className="text-[14px] font-extrabold">{im.line.description}</div><RiskBadge risk={im.risk} /></div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]"><div><dt className="eyebrow">Delay</dt><dd className="font-bold">{im.delayDays} day{im.delayDays === 1 ? "" : "s"}</dd></div><div><dt className="eyebrow">Criticality</dt><dd className="font-bold">{label(im.criticality)}</dd></div>
                <div><dt className="eyebrow">Affected milestone</dt><dd className="font-bold">{im.milestone ?? "Project completion"}</dd></div><div><dt className="eyebrow">Milestone due</dt><dd className="font-bold">{fmtDate(im.milestoneDue)}{im.daysToDeadline != null && <span className="ml-1 text-xs font-normal text-muted">({im.daysToDeadline}d)</span>}</dd></div>
                <div><dt className="eyebrow">Potential project impact</dt><dd className="font-bold">{im.delayDays} day{im.delayDays === 1 ? "" : "s"}</dd></div><div><dt className="eyebrow">Project health</dt><dd><StatusBadge status={projHealth} /></dd></div></dl>
              <p className="hint mt-2">Risk = delay + material criticality + days to the milestone + dependency (score {im.score}).</p>
            </div>))}</div>))}

      {tab === "activity" && <Card>{activity.length === 0 ? <EmptyState title="No activity" /> : <Timeline items={activity.map((a) => ({ title: a.summary, sub: a.user_name ?? "System", at: fmtDateTime(a.at), tone: ["po_approved", "material_received", "vendor_confirmation", "grn"].includes(a.type) ? "green" : ["delivery_date_changed", "po_rejected", "po_cancelled"].includes(a.type) ? "red" : "gray" }))} />}</Card>}

      {tab === "audit" && <Card title="Audit log" flush>{audit.length === 0 ? <EmptyState icon="shield" title="No audit entries" /> : <table className="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Change</th></tr></thead><tbody>{audit.map((a) => <tr key={a.id}><td className="whitespace-nowrap text-muted">{fmtDateTime(a.at)}</td><td className="font-semibold">{a.user_name}</td><td>{a.action}</td><td className="num">{a.old_value && <span className="text-faint">{a.old_value}</span>}{a.old_value && a.new_value && " → "}{a.new_value && <b>{a.new_value}</b>}</td></tr>)}</tbody></table>}</Card>}
    </div>
  );
}
