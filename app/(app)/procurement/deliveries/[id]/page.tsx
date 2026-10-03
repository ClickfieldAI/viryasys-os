import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { deliveryFull, canSeeProject } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, Track, Timeline, EmptyState, Field, Icon } from "@/components/ui";
import { ActionButton, ActionForm, ModalButton } from "@/components/client";
import * as A from "@/app/actions/procurement";
import { fmtDate, fmtDateTime } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard("procurement");
  const id = Number((await params).id);
  const f = deliveryFull(id);
  if (!f) notFound();
  const viewer = { id: user.id, role: user.role };
  if (!canSeeProject(viewer, f.d.project_id)) notFound();
  const { d, items, receipt, inspection, inspectionItems, grn, dn, ack, docs, serials, log } = f;
  const wp = can(user.role, "procurement", "w");
  const wr = can(user.role, "receiving", "w");
  const st = d.status;
  const order = ["PLANNED", "READY_FOR_DISPATCH", "IN_TRANSIT", "RECEIVED", "INSPECTED", "ACKNOWLEDGED"];
  const idx = Math.max(0, order.indexOf(st));
  const track = [["Planned", 0], ["Ready", 1], ["In transit", 2], ["Received", 3], ["Inspected", 4], ["GRN", 4], ["Acknowledged", 5]].map(([l, at], i) => ({ label: l as string, state: (l === "GRN" ? (grn ? "done" : "todo") : (at as number) < idx || st === "ACKNOWLEDGED" ? "done" : (at as number) === idx ? "current" : "todo") as any }));
  const totals = items.reduce((a: any, i: any) => ({ disp: a.disp + i.qty_dispatched, recv: a.recv + i.qty_received, acc: a.acc + i.qty_accepted, dmg: a.dmg + i.qty_damaged, rej: a.rej + i.qty_rejected, short: a.short + i.qty_short }), { disp: 0, recv: 0, acc: 0, dmg: 0, rej: 0, short: 0 });

  return (
    <div>
      <PageHeader crumbs={[{ label: "Deliveries", href: "/procurement/deliveries" }, { label: d.code }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{d.code}<StatusBadge status={st}>{label(st)}</StatusBadge></span>}
        sub={<><Link className="lnk" href={`/procurement/${d.po_id}`}>{d.po_code}</Link> · {d.customer_name} · {d.project_code} · from {d.vendor_name}</>}
        actions={<>
          {wp && st === "PLANNED" && <ActionButton action={A.markReadyAction.bind(null, id)} className="btn">Mark ready for dispatch</ActionButton>}
          {wp && ["PLANNED", "READY_FOR_DISPATCH"].includes(st) && (
            <ModalButton label="Dispatch" title="Dispatch — in transit" className="btn btn-primary" width={420}><ActionForm action={A.dispatchAction.bind(null, id)} submitLabel="Mark in transit" className="space-y-3"><Field label="Vehicle no."><input name="vehicle" className="input" placeholder="TN 09 AB 1234" /></Field><Field label="Driver"><input name="driver" className="input" /></Field></ActionForm></ModalButton>)}
          {wr && ["PLANNED", "READY_FOR_DISPATCH", "IN_TRANSIT"].includes(st) && <Link className="btn btn-primary" href={`/procurement/deliveries/${id}/receive`}><Icon name="cube" size={14} /> Receive material</Link>}
          {wr && st === "RECEIVED" && <Link className="btn btn-primary" href={`/procurement/deliveries/${id}/receive`}><Icon name="tool" size={14} /> Inspect material</Link>}
          {wr && st === "INSPECTED" && dn && <Link className="btn btn-primary" href={`/procurement/deliveries/${id}/receive`}><Icon name="check" size={14} /> Customer acknowledgement</Link>}
          {wr && st === "INSPECTED" && !grn && <ActionButton action={A.generateGrnAction.bind(null, id)} className="btn">Generate GRN</ActionButton>}
          {grn && <Link className="btn" href={`/procurement-print/grn/${grn.id}`} target="_blank">GRN {grn.code}</Link>}
          {dn && <Link className="btn" href={`/procurement-print/dn/${dn.id}`} target="_blank">Delivery note {dn.code}</Link>}
        </>} />
      <div className="card mb-5 p-4"><Track steps={track} /></div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Items" flush>
            <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 720 }}><thead><tr><th>Material</th><th className="r">Ordered</th><th className="r">Dispatched</th><th className="r">Received</th><th className="r">Accepted</th><th className="r">Damaged</th><th className="r">Rejected</th><th className="r">Short</th></tr></thead>
              <tbody>{items.map((i: any) => <tr key={i.id}><td className="font-semibold">{i.description}<div className="text-xs font-normal text-muted">{i.category}{i.spec ? ` · ${i.spec}` : ""}</div></td><td className="r num">{i.ordered} {i.unit}</td><td className="r num">{i.qty_dispatched}</td><td className="r num">{i.qty_received || "—"}</td><td className="r num text-[var(--green-700)]">{i.qty_accepted || "—"}</td><td className={`r num ${i.qty_damaged ? "font-bold text-[var(--red)]" : ""}`}>{i.qty_damaged || "—"}</td><td className={`r num ${i.qty_rejected ? "font-bold text-[var(--red)]" : ""}`}>{i.qty_rejected || "—"}</td><td className={`r num ${i.qty_short ? "font-bold text-[var(--red)]" : ""}`}>{i.qty_short || "—"}</td></tr>)}</tbody>
              <tfoot><tr><td className="font-bold" style={{ padding: "8px 14px" }}>Total</td><td /><td className="r num font-bold">{totals.disp}</td><td className="r num font-bold">{totals.recv}</td><td className="r num font-bold">{totals.acc}</td><td className="r num font-bold">{totals.dmg}</td><td className="r num font-bold">{totals.rej}</td><td className="r num font-bold">{totals.short}</td></tr></tfoot></table></div>
          </Card>
          {inspection && (
            <Card title="Inspection" actions={<StatusBadge status={inspection.result} tone={inspection.result === "ACCEPTED" ? "green" : inspection.result === "PARTIALLY_ACCEPTED" ? "orange" : "red"}>{label(inspection.result)}</StatusBadge>} flush>
              <div className="border-b border-line px-4 py-2.5 text-xs text-muted">Inspector {inspection.inspector_name} · {fmtDateTime(inspection.at)}{inspection.remarks ? ` · ${inspection.remarks}` : ""}</div>
              <table className="tbl"><thead><tr><th>Item</th><th>Spec</th><th>Qty</th><th>Condition</th><th>Packaging</th><th>Serials</th><th>Result</th></tr></thead><tbody>{inspectionItems.map((x: any) => <tr key={x.id}><td className="font-semibold">{x.description}{x.remarks && <div className="text-xs font-normal text-muted">{x.remarks}</div>}</td><td>{x.spec_match ? "Match" : <b className="text-[var(--red)]">Mismatch</b>}</td><td>{x.qty_match ? "Match" : <b className="text-[var(--red)]">Short {x.qty_short}</b>}</td><td>{x.condition}</td><td>{x.packaging}</td><td className="max-w-[160px] truncate text-xs">{x.serials ?? "—"}</td><td><StatusBadge status={x.result} tone={x.result === "ACCEPTED" ? "green" : x.result === "PARTIALLY_ACCEPTED" ? "orange" : "red"}>{label(x.result)}</StatusBadge></td></tr>)}</tbody></table>
            </Card>)}
          {serials.length > 0 && <Card title={`Serial numbers (${serials.length})`} flush><div className="flex flex-wrap gap-1.5 p-3">{serials.map((s: any) => <span key={s.id} className="badge b-navy num">{s.serial}</span>)}</div></Card>}
          <Card title="Activity">{log.length === 0 ? <EmptyState title="No activity" /> : <Timeline items={log.map((a: any) => ({ title: a.summary, sub: a.user_name ?? "System", at: fmtDateTime(a.at), tone: ["material_received", "grn", "customer_ack", "delivery_closed"].includes(a.type) ? "green" : "gray" }))} />}</Card>
        </div>
        <div className="space-y-5">
          <Card title="Delivery">
            <dl className="space-y-2 text-[13px]">{([["Expected", fmtDate(d.expected_date)], ["Dispatched", d.dispatched_at ? fmtDateTime(d.dispatched_at) : "—"], ["Vehicle", d.vehicle ?? "—"], ["Driver", d.driver ?? "—"], ["Site", d.site ?? "—"], ["Received", d.received_at ? fmtDateTime(d.received_at) : "—"], ["Received by", receipt?.received_by ?? "—"], ["Receipt", receipt?.code ?? "—"]] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}</dl>
          </Card>
          <Card title="Customer acknowledgement">
            {!ack ? <p className="text-[13px] text-muted">{st === "INSPECTED" ? "Waiting for the customer to acknowledge this delivery." : "Available once the material is inspected."}</p> : (
              <div className="text-[13px]"><div className="mb-1 flex items-center gap-1.5 font-bold text-[var(--green-700)]"><Icon name="check" size={14} /> Delivery accepted</div><div>{ack.customer_name} · {fmtDateTime(ack.ack_at)} · via {ack.via}</div>{ack.remarks && <div className="text-muted">{ack.remarks}</div>}
                {ack.signature && /* eslint-disable-next-line @next/next/no-img-element */ <img src={ack.signature} alt="Customer signature" className="mt-2 max-h-24 rounded border border-line bg-white p-1" />}</div>)}
          </Card>
          <Card title="Photos & documents" flush actions={wr && <ModalButton label="Attach" icon="upload" title="Attach to delivery" className="btn btn-sm" width={440}><ActionForm action={A.uploadProcDocAction} submitLabel="Upload" className="space-y-3"><input type="hidden" name="delivery_id" value={id} /><Field label="Type"><select name="doc_type" className="input"><option>Inspection Photos</option><option>Vendor Invoice</option><option>Delivery Note</option><option>Other</option></select></Field><Field label="File *"><input name="file" type="file" required className="input !h-auto py-1.5 text-xs" /></Field></ActionForm></ModalButton>}>
            {docs.length === 0 ? <EmptyState icon="camera" title="No photos yet" body="Delivery and inspection photos are stored here." /> : (
              <div className="grid grid-cols-3 gap-1.5 p-3">{docs.map((x: any) => /\.(png|jpe?g|webp)$/i.test(x.name) ? <a key={x.id} href={`/api/files/${x.file_path}`} target="_blank">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/files/${x.file_path}`} alt={x.doc_type} className="aspect-square w-full rounded object-cover" loading="lazy" /></a> : <a key={x.id} className="lnk text-xs" href={`/api/files/${x.file_path}`} target="_blank">{x.name}</a>)}</div>)}
          </Card>
          {wp && ["PLANNED", "READY_FOR_DISPATCH"].includes(st) && items.filter((i: any) => i.qty_dispatched > 1).length > 0 && (
            <Card title="Split this delivery" flush>{items.filter((i: any) => i.qty_dispatched > 1).map((i: any) => (
              <div key={i.id} className="border-b border-line px-4 py-2.5 last:border-0"><div className="mb-1.5 text-[13px] font-semibold">{i.description} <span className="font-normal text-muted">({i.qty_dispatched} {i.unit})</span></div>
                <ActionForm action={A.splitItemAction.bind(null, i.id)} className="flex flex-wrap items-end gap-2" resetOnSuccess><div className="w-[90px]"><label className="label">Move qty</label><input name="qty" type="number" step="any" min="0" max={i.qty_dispatched - 0.01} required className="input !h-8" /></div><div><label className="label">To date</label><input name="expected" type="date" required className="input !h-8" /></div><button className="btn btn-sm" type="submit">Split</button></ActionForm></div>))}</Card>)}
        </div>
      </div>
    </div>
  );
}
