import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { getDb } from "@/lib/db";
import { deliveryFull, canSeeProject } from "@/lib/services/procurement";
import { PrintButton } from "@/components/print-button";
import { inr } from "@/lib/util";
import { fmtDateTime } from "@/lib/util";
import { PRINT_CSS } from "@/lib/print-css";

export const dynamic = "force-dynamic";
export const metadata = { title: "GRN" };

export default async function GrnPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!can(u.role, "procurement")) redirect("/forbidden");
  const g = getDb().prepare("SELECT * FROM grns WHERE id = ?").get(Number((await params).id)) as any;
  if (!g) notFound();
  const f = deliveryFull(g.delivery_id)!;
  if (!canSeeProject({ id: u.id, role: u.role }, f.d.project_id)) notFound();
  const photos = f.docs.filter((x: any) => /\.(png|jpe?g|webp)$/i.test(x.name));
  return (
    <div className="min-h-screen bg-white">
      <style>{PRINT_CSS}</style>
      <div className="no-print sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-2.5"><span className="text-[13px]"><b>{g.code}</b> · Goods / Material Receipt Note</span><PrintButton /></div>
      <div className="pdoc mx-auto max-w-[820px] px-8 py-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="head"><img src="/brand/logo.png" alt="ViryaSys Technologies" style={{ height: 44 }} /><div className="right"><div className="kicker">Goods / Material Receipt Note</div><h1>{g.code}</h1></div></div>
        <table className="kv"><tbody>
          <tr><th>Project</th><td>{f.d.project_name} ({f.d.project_code})</td><th>Date</th><td>{fmtDateTime(g.at)}</td></tr>
          <tr><th>Purchase order</th><td>{f.d.po_code}</td><th>Delivery</th><td>{f.d.code}</td></tr>
          <tr><th>Vendor</th><td>{f.d.vendor_name}</td><th>Inspector</th><td>{g.inspector_name}</td></tr>
          <tr><th>Customer</th><td>{f.d.customer_name}</td><th>Received by</th><td>{f.receipt?.received_by ?? "—"}{f.receipt?.vehicle ? ` · ${f.receipt.vehicle}` : ""}</td></tr></tbody></table>
        <table className="pt"><thead><tr><th>#</th><th>Item</th><th className="r">Ordered</th><th className="r">Received</th><th className="r">Accepted</th><th className="r">Rejected</th><th className="r">Damaged</th></tr></thead>
          <tbody>{f.items.map((i: any, n: number) => <tr key={i.id}><td>{n + 1}</td><td>{i.description}{i.spec ? <div className="sm">{i.spec}</div> : null}</td><td className="r">{i.ordered} {i.unit}</td><td className="r">{i.qty_received}</td><td className="r">{i.qty_accepted}</td><td className="r">{i.qty_rejected}</td><td className="r">{i.qty_damaged}</td></tr>)}</tbody></table>
        <p><b>Inspection result:</b> {f.inspection?.result.replace("_", " ")}{f.inspection?.remarks ? ` — ${f.inspection.remarks}` : ""}</p>
        {g.remarks && <p><b>Remarks:</b> {g.remarks}</p>}
        {photos.length > 0 && <div className="photos">{photos.slice(0, 6).map((x: any) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={x.id} src={`/api/files/${x.file_path}`} alt="Inspection" />)}</div>}
        <div className="sig"><div><div className="line" />Inspector — {g.inspector_name}</div><div><div className="line" />Store / Project manager</div></div>
        <p className="sm">Value at PO rates: {inr(f.items.reduce((a: number, i: any) => a + i.qty_accepted * i.rate, 0))} (accepted quantity).</p>
      </div>
    </div>
  );
}
