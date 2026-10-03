import { guard } from "@/lib/auth";
import { analytics } from "@/lib/services/dashboard";
import { vendorStats } from "@/lib/services/procurement";
import { PageHeader, Card, KpiCard, BarList, StatusBadge } from "@/components/ui";
import { label, LEAD_SOURCES } from "@/lib/config";
import { inrShort } from "@/lib/util";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function Analytics() {
  await guard("analytics");
  const a = analytics();
  const vendors = vendorStats().filter((v) => v.onTimePct != null).sort((x, y) => (y.onTimePct ?? 0) - (x.onTimePct ?? 0));
  const fmtSec = (s?: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
  return (
    <div>
      <PageHeader title="Analytics" sub="Sales, projects, procurement and cash — computed live from operational records." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Total leads" value={String(a.total)} href="/crm/leads" />
        <KpiCard label="Qualified & beyond" value={String(a.qualified)} href="/crm/pipeline" />
        <KpiCard label="Won" value={String(a.won)} sub={`${a.conversion}% conversion`} tone="good" href="/crm/leads?status=WON" />
        <KpiCard label="Active project value" value={inrShort(a.projectValue)} href="/projects" />
        <KpiCard label="Avg project duration" value={a.avgDuration ? `${Math.round(a.avgDuration)} d` : "—"} sub={`${a.projDone}/${a.projTotal} completed`} href="/projects" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Lead funnel"><BarList rows={a.funnel.map((f) => ({ label: label(f.stage), value: f.count, sub: f.value ? inrShort(f.value) : undefined }))} /></Card>
        <Card title="Leads by source" flush>
          <table className="tbl"><thead><tr><th>Source</th><th className="r">Leads</th><th className="r">Won</th><th className="r">Conversion</th></tr></thead><tbody>{a.bySource.map((s: any) => <tr key={s.source}><td>{LEAD_SOURCES[s.source] ?? s.source}</td><td className="r num">{s.n}</td><td className="r num">{s.won}</td><td className="r num">{Math.round((s.won / s.n) * 100)}%</td></tr>)}</tbody></table>
        </Card>
        <Card title="Salesperson performance" flush>
          <table className="tbl"><thead><tr><th>Name</th><th className="r">Leads</th><th className="r">Won</th><th className="r">Avg response</th><th className="r">SLA met</th></tr></thead><tbody>{a.sales.map((s: any) => <tr key={s.name}><td className="font-semibold">{s.name}</td><td className="r num">{s.leads}</td><td className="r num">{s.won}</td><td className="r num">{fmtSec(s.avg_resp)}</td><td className="r num">{s.responded ? `${Math.round((s.sla_met / s.responded) * 100)}%` : "—"}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Projects by stage"><BarList color="var(--navy-700)" rows={a.projectsByStage.filter((s) => s.stage !== "PROJECT_CREATED").map((s) => ({ label: label(s.stage), value: s.count }))} /></Card>
        <Card title="Project health (active)"><div className="flex flex-wrap gap-3">{a.health.map((h: any) => <div key={h.health} className="card min-w-[120px] p-3"><StatusBadge status={h.health} /><div className="mt-1 text-2xl font-extrabold num">{h.n}</div></div>)}</div></Card>
        <Card title="Procurement">
          <div className="mb-3 grid grid-cols-2 gap-3"><div><div className="eyebrow">Open POs</div><div className="text-2xl font-extrabold num">{a.pos.pending}</div></div><div><div className="eyebrow">Delayed POs</div><div className="text-2xl font-extrabold num text-[var(--red)]">{a.pos.delayed}</div></div></div>
          <div className="eyebrow mb-1">Vendor on-time delivery</div>
          <BarList color="var(--green-500)" fmt={(n) => `${n}%`} rows={vendors.slice(0, 6).map((v) => ({ label: v.name.split(" ")[0], value: v.onTimePct! }))} />
        </Card>
        <Card title="Cash">
          <dl className="grid grid-cols-2 gap-4">{([["Collected", a.fin.collected], ["Outstanding", a.fin.outstanding], ["Overdue", a.fin.overdue], ["Yet to invoice", a.fin.upcoming]] as [string, number][]).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="text-2xl font-extrabold num">{inrShort(v)}</dd></div>)}</dl>
        </Card>
      </div>
    </div>
  );
}
