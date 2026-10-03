import { guard } from "@/lib/auth";
import { itemLines, analyticsData, vendorStats, projectStock, towerKpis, health } from "@/lib/services/procurement";
import { PageHeader, Card, BarList, StatusBadge, EmptyState } from "@/components/ui";
import { inr, inrShort } from "@/lib/util";

export const metadata = { title: "Procurement analytics" };
export const dynamic = "force-dynamic";

export default async function ProcAnalytics() {
  const user = await guard("analytics");
  const viewer = { id: user.id, role: user.role };
  const lines = itemLines({ viewer });
  const a = analyticsData(lines, viewer);
  const vs = vendorStats(lines).filter((v) => v.pos > 0);
  const stock = projectStock(viewer);
  const k = towerKpis(lines, viewer), h = health(lines);
  const m = a.metrics;
  const f = (v: number | null, s = "") => (v == null ? "—" : `${v}${s}`);
  const metric: [string, string, string][] = [["On-time delivery", f(m.onTimePct, "%"), "vs original promise"], ["Average delay", f(m.avgDelay, " d"), "of delivered lines"], ["Delay frequency", f(m.delayFrequencyPct, "%"), "lines that slipped"], ["PO → delivery time", f(m.poToDelivery, " d"), "released to first receipt"], ["Vendor confirmation time", f(m.confirmHours, " h"), "release to confirmation"], ["PO cycle time", f(m.poCycleHours, " h"), "created to released"], ["Cost variance", m.costVariancePct == null ? "—" : `${m.costVariancePct > 0 ? "+" : ""}${m.costVariancePct}%`, "actual vs BOQ estimate"], ["Material acceptance", f(m.acceptancePct, "%"), "accepted / received"], ["Damage", f(m.damagePct, "%"), "of received"], ["Shortage", f(m.shortagePct, "%"), "of dispatched"], ["Material returned", f(m.returnPct, "%"), "of accepted"]];
  return (
    <div>
      <PageHeader title="Procurement analytics" sub="Computed live from POs, promises, receipts, inspections and the material ledger." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{metric.map(([l, v, s]) => <div key={l} className="card p-3.5"><div className="eyebrow">{l}</div><div className="mt-1 text-[22px] font-extrabold num">{v}</div><div className="text-[11px] text-faint">{s}</div></div>)}
        <div className="card p-3.5"><div className="eyebrow">Health</div><div className="mt-1 text-[22px] font-extrabold num">{h.pct}%</div><div className="text-[11px] text-faint">{h.total} live lines</div></div></div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Monthly procurement value">{a.monthly.length === 0 ? <EmptyState title="No POs yet" /> : <BarList fmt={inrShort} rows={a.monthly.map((x: any) => ({ label: x.m, value: x.v, sub: `${x.n} POs` }))} />}</Card>
        <Card title="Procurement by category">{a.byCategory.length === 0 ? <EmptyState title="No data" /> : <BarList color="var(--navy-700)" fmt={inrShort} rows={a.byCategory.map((x: any) => ({ label: x.cat ?? "Other", value: x.v }))} />}</Card>
        <Card title="Top projects by procurement value">{a.byProject.length === 0 ? <EmptyState title="No data" /> : <BarList fmt={inrShort} rows={a.byProject.map((x: any) => ({ label: x.code, value: x.v }))} />}</Card>
        <Card title="Pending procurement" ><div className="text-3xl font-extrabold num">{inrShort(a.pending)}</div><p className="hint mt-1">Value of confirmed quantities not yet received. {k.delayed} line(s) currently delayed, {k.paymentPending} PO(s) awaiting payment ({inrShort(k.paymentPendingAmount)}).</p></Card>
        <Card title="Vendor performance" flush className="lg:col-span-2"><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Vendor</th><th className="r">POs</th><th className="r">Value</th><th className="r">On-time</th><th className="r">Avg delay</th><th className="r">Avg delivery</th><th className="r">Date shift</th><th className="r">Quality issues</th><th>Health</th></tr></thead>
          <tbody>{vs.map((v) => <tr key={v.id}><td className="font-semibold">{v.name}</td><td className="r num">{v.pos}</td><td className="r num">{inrShort(v.value)}</td><td className="r num">{v.onTimePct == null ? "—" : `${v.onTimePct}%`}</td><td className="r num">{v.avgDelay == null ? "—" : `${v.avgDelay}d`}</td><td className="r num">{v.avgDeliveryDays == null ? "—" : `${v.avgDeliveryDays}d`}</td><td className="r num">{v.avgDateShift == null ? "—" : `${v.avgDateShift > 0 ? "+" : ""}${v.avgDateShift}d`}</td><td className="r num">{v.qualityPct == null ? "—" : `${v.qualityPct}%`}</td><td><StatusBadge status={v.health} /></td></tr>)}</tbody></table></div></Card>
        <Card title="Project procurement cost" flush className="lg:col-span-2"><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Project</th><th className="r">Approved value</th><th className="r">Estimated</th><th className="r">Ordered (est.)</th><th className="r">Actual</th><th className="r">Variance</th><th>Status</th></tr></thead>
          <tbody>{a.cost.filter((c) => c.covered > 0).sort((x, y) => y.pct - x.pct).slice(0, 15).map((c) => <tr key={c.id}><td className="font-semibold">{c.customer}<div className="text-xs font-normal text-muted num">{c.code}</div></td><td className="r num">{inrShort(c.approved)}</td><td className="r num">{inrShort(c.estimated)}</td><td className="r num">{inrShort(c.covered)}</td><td className="r num">{inrShort(c.actual)}</td><td className={`r num font-semibold ${c.variance > 0 ? "text-[var(--red)]" : "text-[var(--green-700)]"}`}>{c.variance > 0 ? "+" : ""}{inr(c.variance)} ({c.pct > 0 ? "+" : ""}{c.pct}%)</td><td><StatusBadge status={c.status} /></td></tr>)}</tbody></table></div></Card>
        <Card title="Material variance & losses" flush className="lg:col-span-2">{a.variance.length === 0 ? <EmptyState icon="check" title="No material variance" body="Consumption matches plan and stock counts match the ledger." /> : <ul>{a.variance.map((e: any) => <li key={e.id} className="border-b border-line px-4 py-2.5 text-[13px] last:border-0"><b>{e.material}</b> <span className="text-muted">· {e.project_code}</span><div className="text-xs text-muted">{e.detail}</div></li>)}</ul>}</Card>
        <Card title="Where are we losing material (₹)" flush className="lg:col-span-2"><table className="tbl"><thead><tr><th>Project</th><th className="r">Damaged / rejected</th><th className="r">In store</th><th className="r">Consumed</th></tr></thead><tbody>{stock.filter((s) => s.damaged > 0).sort((x, y) => y.damaged - x.damaged).slice(0, 8).map((s) => <tr key={s.id}><td>{s.customer}<span className="ml-2 text-xs text-muted num">{s.code}</span></td><td className="r num text-[var(--red)]">{inrShort(s.damaged)}</td><td className="r num">{inrShort(s.store)}</td><td className="r num">{inrShort(s.consumed)}</td></tr>)}</tbody></table></Card>
      </div>
    </div>
  );
}
