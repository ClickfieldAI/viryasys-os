import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { guard } from "@/lib/auth";
import { deliveryFull, canSeeProject } from "@/lib/services/procurement";
import { PageHeader } from "@/components/ui";
import { ReceivingFlow } from "@/components/proc-client";
import * as A from "@/app/actions/procurement";
import { getDb } from "@/lib/db";

export const metadata = { title: "Receive material" };
export const dynamic = "force-dynamic";

// Mobile-first guided flow for site engineers: arrive → quantities → inspect → customer signature.
export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard("receiving", "w");
  const id = Number((await params).id);
  const f = deliveryFull(id);
  if (!f || !canSeeProject({ id: user.id, role: user.role }, f.d.project_id)) notFound();
  const st = f.d.status;
  if (["ACKNOWLEDGED", "CLOSED"].includes(st) || (st === "INSPECTED" && !f.dn)) redirect(`/procurement/deliveries/${id}`);
  const mode = ["PLANNED", "READY_FOR_DISPATCH", "IN_TRANSIT"].includes(st) ? "receive" : st === "RECEIVED" ? "inspect" : "ack";
  const contact = (getDb().prepare("SELECT ct.name FROM contacts ct JOIN projects p ON p.customer_id = ct.customer_id WHERE p.id = ? ORDER BY ct.is_primary DESC LIMIT 1").get(f.d.project_id) as any)?.name ?? "";
  return (
    <div>
      <PageHeader crumbs={[{ label: "Deliveries", href: "/procurement/deliveries" }, { label: f.d.code, href: `/procurement/deliveries/${id}` }]} title={mode === "receive" ? "Receive material" : mode === "inspect" ? "Inspect material" : "Customer acknowledgement"} sub={`${f.d.customer_name} · ${f.d.project_code}`} actions={<Link href={`/procurement/deliveries/${id}`} className="btn btn-sm">Cancel</Link>} />
      <ReceivingFlow key={`${id}-${mode}`} mode={mode} customerHint={contact} delivery={{ id, code: f.d.code, project: f.d.project_code, vendor: f.d.vendor_name, po: f.d.po_code }}
        items={f.items.map((i: any) => ({ id: i.id, description: i.description, spec: i.spec, unit: i.unit, category: i.category, qty_dispatched: i.qty_dispatched, qty_received: i.qty_received, qty_short: i.qty_short }))}
        actions={{ receive: A.receiveDeliveryAction.bind(null, id), inspect: A.inspectDeliveryAction.bind(null, id), ack: A.acknowledgeDeliveryAction.bind(null, id) }} />
    </div>
  );
}
