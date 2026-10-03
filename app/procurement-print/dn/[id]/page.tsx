import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { getDb } from "@/lib/db";
import { deliveryFull, canSeeProject } from "@/lib/services/procurement";
import { PrintButton } from "@/components/print-button";
import { fmtDateTime } from "@/lib/util";
import { PRINT_CSS } from "@/lib/print-css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery note" };

export default async function DnPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!can(u.role, "procurement")) redirect("/forbidden");
  const n = getDb().prepare("SELECT * FROM delivery_notes WHERE id = ?").get(Number((await params).id)) as any;
  if (!n) notFound();
  const f = deliveryFull(n.delivery_id)!;
  if (!canSeeProject({ id: u.id, role: u.role }, f.d.project_id)) notFound();
  const acc = f.items.filter((i: any) => i.qty_accepted > 0);
  return (
    <div className="min-h-screen bg-white">
      <style>{PRINT_CSS}</style>
      <div className="no-print sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-2.5"><span className="text-[13px]"><b>{n.code}</b> · Delivery note</span><PrintButton /></div>
      <div className="pdoc mx-auto max-w-[820px] px-8 py-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="head"><img src="/brand/logo.png" alt="ViryaSys Technologies" style={{ height: 44 }} /><div className="right"><div className="kicker">Delivery note</div><h1>{n.code}</h1></div></div>
        <table className="kv"><tbody>
          <tr><th>Project</th><td>{f.d.project_name} ({f.d.project_code})</td><th>Date</th><td>{fmtDateTime(n.at)}</td></tr>
          <tr><th>Customer</th><td>{f.d.customer_name}</td><th>Delivery</th><td>{f.d.code} · PO {f.d.po_code}</td></tr>
          <tr><th>Site</th><td>{f.d.site ?? "—"}</td><th>Received by</th><td>{n.received_by ?? "—"}</td></tr></tbody></table>
        <table className="pt"><thead><tr><th>#</th><th>Material</th><th className="r">Quantity delivered</th></tr></thead><tbody>{acc.map((i: any, k: number) => <tr key={i.id}><td>{k + 1}</td><td>{i.description}{i.spec ? <div className="sm">{i.spec}</div> : null}</td><td className="r">{i.qty_accepted} {i.unit}</td></tr>)}</tbody></table>
        <p className="sm">Material listed above was received at site, inspected and accepted. Signing this note confirms receipt and transfers responsibility for the equipment to the customer.</p>
        <div className="sig"><div>{f.ack?.signature ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.ack.signature} alt="Customer signature" style={{ maxHeight: 60 }} /> : <div className="line" />}<div className="line" style={{ height: 0 }} />Customer{f.ack ? ` — ${f.ack.customer_name} · ${fmtDateTime(f.ack.ack_at)}` : " (signature pending)"}</div><div><div className="line" />Viryasys Technologies — {n.received_by ?? ""}</div></div>
      </div>
    </div>
  );
}
