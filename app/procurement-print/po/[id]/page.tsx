import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { getDb } from "@/lib/db";
import { poFull, canSeeProject } from "@/lib/services/procurement";
import { PrintButton } from "@/components/print-button";
import { inr, fmtDate } from "@/lib/util";
import { PRINT_CSS } from "@/lib/print-css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase Order" };

export default async function PoPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!can(u.role, "procurement")) redirect("/forbidden");
  const id = Number((await params).id);
  const f = poFull(id);
  if (!f) notFound();
  const po = f.po;
  if (!canSeeProject({ id: u.id, role: u.role }, po.project_id)) notFound();
  const db = getDb();
  const org = db.prepare("SELECT * FROM organizations LIMIT 1").get() as any;
  const items = db.prepare("SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id").all(id) as any[];
  const draft = ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(po.status);
  const gst = items.reduce((a, i) => a + (i.qty * i.rate * i.tax_pct) / 100, 0);
  return (
    <div className="min-h-screen bg-white">
      <style>{PRINT_CSS + ".pdoc .wm{position:fixed;top:40%;left:18%;font-size:90px;font-weight:800;color:rgba(200,50,50,.10);transform:rotate(-24deg);pointer-events:none}.pdoc .band{background:#1A2A36;color:#fff;padding:6px 10px;font-weight:700;letter-spacing:.08em;font-size:11px;text-transform:uppercase}.pdoc .box{border:1px solid #E3E8ED;padding:10px 12px;flex:1}.pdoc .foot{margin-top:28px;padding-top:8px;border-top:3px solid #32C36C;font-size:11px;color:#6B7A87;display:flex;justify-content:space-between}@media print{@page{size:A4;margin:14mm}}"}</style>
      <div className="no-print sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-2.5"><span className="text-[13px]"><b>{po.code}</b> · Purchase Order · choose “Save as PDF” in the print dialog</span><PrintButton /></div>
      <div className="pdoc mx-auto max-w-[820px] px-8 py-8">
        {draft && <div className="wm">{po.status === "DRAFT" ? "DRAFT" : "NOT APPROVED"}</div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="head"><div><img src="/brand/logo.png" alt="ViryaSys Technologies" style={{ height: 46 }} /><div className="sm" style={{ marginTop: 6 }}>{org?.name}<br />{org?.address}<br />{org?.gstin ? `GSTIN ${org.gstin} · ` : ""}{org?.phone} · {org?.email}</div></div>
          <div className="right"><div className="kicker">Purchase Order</div><h1>{po.code}</h1><div className="sm">Version {po.version} · {po.status.replaceAll("_", " ")}</div></div></div>
        <table className="kv"><tbody>
          <tr><th>PO date</th><td>{po.po_date ? fmtDate(po.po_date) : "—"}</td><th>Required by</th><td>{po.required_date ? fmtDate(po.required_date) : "—"}</td></tr>
          <tr><th>Project</th><td>{po.project_name} ({po.project_code})</td><th>Customer</th><td>{po.customer_name ?? "—"}</td></tr>
          <tr><th>Payment terms</th><td>{po.payment_terms}</td><th>Delivery terms</th><td>{po.delivery_terms}</td></tr></tbody></table>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="box"><div className="kicker">Vendor</div><b>{po.vendor_name}</b><div className="sm">{[po.vendor_phone, po.vendor_email].filter(Boolean).join(" · ")}</div></div>
          <div className="box"><div className="kicker">Bill to</div><div className="sm" style={{ color: "#1A2A36" }}>{po.billing_address}</div></div>
          <div className="box"><div className="kicker">Deliver to</div><div className="sm" style={{ color: "#1A2A36" }}>{po.delivery_address}</div></div>
        </div>
        <table className="pt"><thead><tr><th>#</th><th>Description</th><th className="r">Qty</th><th className="r">Rate (₹)</th><th className="r">Tax</th><th>Deliver by</th><th className="r">Amount (₹)</th></tr></thead>
          <tbody>{items.map((i, n) => <tr key={i.id}><td>{n + 1}</td><td><b>{i.description}</b>{i.spec ? <div className="sm">{i.spec}</div> : null}</td><td className="r">{i.qty} {i.unit}</td><td className="r">{new Intl.NumberFormat("en-IN").format(i.rate)}</td><td className="r">{i.tax_pct}%</td><td>{i.required_date ? fmtDate(i.required_date) : "—"}</td><td className="r">{new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(i.qty * i.rate)}</td></tr>)}</tbody></table>
        <table style={{ width: 300, marginLeft: "auto" }}><tbody>
          <tr><td>Subtotal</td><td className="r">{inr(po.subtotal)}</td></tr>
          <tr><td>GST</td><td className="r">{inr(gst)}</td></tr>
          <tr><td><b>Grand total</b></td><td className="r"><b>{inr(po.total)}</b></td></tr></tbody></table>
        {po.notes && <p><b>Notes:</b> {po.notes}</p>}
        <p className="sm">Please acknowledge this order, confirm quantities and committed delivery dates, and quote the PO number on all invoices and delivery challans.</p>
        <div className="sig"><div><div className="line" />Prepared by — {po.owner_name}</div><div><div className="line" />Authorised signatory{po.approver_name ? ` — ${po.approver_name}` : ""}</div></div>
        <div className="foot"><span>ViryaSys Technologies · Accelerating Green</span><span>{po.code} · generated {new Date().toLocaleDateString("en-IN")}</span></div>
      </div>
    </div>
  );
}
