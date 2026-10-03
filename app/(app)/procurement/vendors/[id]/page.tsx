import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { getDb } from "@/lib/db";
import { vendorStats, itemLines } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { VendorFormModal } from "@/components/vendor-form";
import { inr, inrShort, fmtDate } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard("procurement");
  const id = Number((await params).id);
  const raw = getDb().prepare("SELECT * FROM vendors WHERE id = ?").get(id) as any;
  if (!raw) notFound();
  const lines = itemLines({ vendor_id: id });
  const v = vendorStats(itemLines()).find((x) => x.id === id)!;
  const pos = getDb().prepare("SELECT o.*, p.code pcode FROM purchase_orders o LEFT JOIN projects p ON p.id = o.project_id WHERE o.vendor_id = ? ORDER BY o.id DESC LIMIT 25").all(id) as any[];
  const slips = lines.filter((l) => l.promise_count > 1).slice(0, 8);
  const metrics: [string, string][] = [["POs", String(v.pos)], ["On-time deliveries", v.onTimePct == null ? "—" : `${v.onTimePct}%`], ["Delayed deliveries", String(lines.filter((l) => l.total_delay > 0 && l.first_received).length)], ["Average delay", v.avgDelay == null ? "—" : `${v.avgDelay} days`], ["Average delivery time", v.avgDeliveryDays == null ? "—" : `${v.avgDeliveryDays} days`], ["Promised vs original date", v.avgDateShift == null ? "—" : `${v.avgDateShift > 0 ? "+" : ""}${v.avgDateShift} days`], ["Rejected items", String(v.rejectedQty)], ["Damaged items", String(v.damagedQty)], ["Quality issues", v.qualityPct == null ? "—" : `${v.qualityPct}%`], ["Total purchase value", inrShort(v.value)]];
  return (
    <div>
      <PageHeader crumbs={[{ label: "Vendors", href: "/procurement/vendors" }, { label: raw.code }]} title={<span className="flex flex-wrap items-center gap-2.5">{raw.name}<StatusBadge status={v.health} /></span>} sub={`${raw.city ?? ""} · ${(raw.categories ?? "").replace(/,/g, ", ")}`} actions={can(user.role, "procurement", "w") ? <VendorFormModal vendor={raw} label="Edit" className="btn" /> : undefined} />
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card title="Profile"><dl className="space-y-2 text-[13px]">{([["Vendor code", raw.code], ["Contact", raw.contact ?? "—"], ["Phone", raw.phone ?? "—"], ["Email", raw.email ?? "—"], ["Address", raw.address ?? "—"], ["GSTIN", raw.gstin ?? "—"], ["Products", raw.products ?? "—"], ["Payment terms", raw.payment_terms ?? "—"], ["Active POs", String(v.activePos)], ["Pending confirmation", String(v.pendingPos)], ["Delayed POs", String(v.delayedPos)]] as [string, string][]).map(([k, val]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{val}</dd></div>)}</dl></Card>
        <Card title="Performance (derived)" className="lg:col-span-2"><dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{metrics.map(([k, val]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5 text-xl font-extrabold num">{val}</dd></div>)}</dl><p className="hint mt-3">On-time = first receipt on or before the <b>original</b> promised date, so a vendor can’t improve its score by revising dates. Health: GOOD ≥85% on-time and ≤3% quality issues; FAIR ≥65% / ≤8%.</p></Card>
      </div>
      {slips.length > 0 && <Card title="Date changes" className="mb-5" flush><table className="tbl"><thead><tr><th>PO</th><th>Item</th><th>Original</th><th>Now</th><th className="r">Changes</th></tr></thead><tbody>{slips.map((l) => <tr key={l.id}><td><Link className="lnk num" href={`/procurement/${l.po_id}`}>{l.po_code}</Link></td><td>{l.description}</td><td>{fmtDate(l.original_expected)}</td><td className="font-bold">{fmtDate(l.expected_date)}</td><td className="r num">{l.promise_count - 1}</td></tr>)}</tbody></table></Card>}
      <Card title="Purchase orders" flush>{pos.length === 0 ? <EmptyState icon="truck" title="No purchase orders with this vendor" /> : <table className="tbl"><thead><tr><th>PO</th><th>Project</th><th>Date</th><th className="r">Total</th><th>Status</th></tr></thead><tbody>{pos.map((o) => <tr key={o.id}><td><Link className="lnk num" href={`/procurement/${o.id}`}>{o.code}</Link></td><td>{o.pcode}</td><td>{fmtDate(o.po_date)}</td><td className="r num">{inr(o.total)}</td><td><StatusBadge status={o.status} /></td></tr>)}</tbody></table>}</Card>
    </div>
  );
}
