import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { customerFull } from "@/lib/services/misc";
import { PageHeader, Card, StatusBadge, Timeline, EmptyState } from "@/components/ui";
import { fmtDateTime, inr } from "@/lib/util";
import { label } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await guard("crm");
  const d = customerFull(Number((await params).id));
  if (!d) notFound();
  return (
    <div>
      <PageHeader crumbs={[{ label: "Customers", href: "/crm/customers" }, { label: d.c.code }]} title={d.c.name} sub={`${d.c.industry ?? "—"} · ${d.c.city ?? "—"} · ${d.docs} document${d.docs === 1 ? "" : "s"}`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <Card title="Contacts" flush>{d.contacts.length === 0 ? <EmptyState title="No contacts" /> : <ul>{d.contacts.map((c: any) => <li key={c.id} className="border-b border-line px-4 py-3 last:border-0"><div className="font-semibold">{c.name} {c.is_primary ? <span className="badge b-green ml-1">Primary</span> : null}</div><div className="text-xs text-muted">{c.designation}{c.phone && ` · ${c.phone}`}{c.email && ` · ${c.email}`}</div></li>)}</ul>}</Card>
          <Card title="Leads & proposals" flush>
            <ul>{d.leads.map((l: any) => <li key={l.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-0"><Link className="lnk text-[13px]" href={`/crm/leads/${l.id}`}>{l.code}</Link><StatusBadge status={l.status} /></li>)}
              {d.proposals.map((p: any) => <li key={p.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-0"><Link className="lnk text-[13px]" href={`/proposals/${p.id}`}>{p.code} · {inr(p.total)}</Link><StatusBadge status={p.status} /></li>)}</ul>
          </Card>
          <Card title="Projects" flush>{d.projects.length === 0 ? <EmptyState title="No projects yet" /> : <ul>{d.projects.map((p: any) => <li key={p.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-0"><Link className="lnk text-[13px]" href={`/projects/${p.id}`}>{p.code}</Link><span className="flex gap-1.5"><StatusBadge status={p.stage} /><StatusBadge status={p.health} /></span></li>)}</ul>}</Card>
        </div>
        <Card title="Communication history" className="lg:col-span-2">
          {d.comms.length === 0 ? <EmptyState icon="chat" title="No communication yet" /> : (
            <Timeline items={d.comms.map((c: any) => ({ title: c.summary, sub: <><Link className="lnk" href={c.href}>{c.ref}</Link> · {label(c.type)}</>, at: fmtDateTime(c.at) }))} />)}
        </Card>
      </div>
    </div>
  );
}
