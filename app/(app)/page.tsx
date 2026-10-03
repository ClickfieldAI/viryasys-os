import Link from "next/link";
import { guard } from "@/lib/auth";
import { dashboardFor, activityFeed, analytics, executiveStats, projectWidgets } from "@/lib/services/dashboard";
import { slaTick, slaInfo } from "@/lib/services/leads";
import { refreshAllHealth } from "@/lib/services/projects";
import { getDb } from "@/lib/db";
import { KpiCard, Card, Icon, StatusBadge, EmptyState, BarList, MiniBars, StackBar, StatTile, AreaChart, Donut, kpiIcon } from "@/components/ui";
import { AutoRefresh, SlaTimer } from "@/components/client";
import { label } from "@/lib/config";
import { fmtKw, inrShort, dateOnly } from "@/lib/util";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const ATT: Record<string, [string, string]> = { bad: ["tile-red", "bell"], warn: ["tile-amber", "clipboard"], info: ["tile-blue", "inbox"] };
function attIcon(href: string, tone: string): [string, string] {
  const t = ATT[tone] ?? ATT.info;
  const map: [string, string, string][] = [["/procurement", "truck", "tile-teal"], ["/proposals", "file", "tile-purple"], ["/crm", "funnel", "tile-blue"], ["/projects", "sun", "tile-green"], ["/inbox", "inbox", "tile-blue"]];
  const m = map.find(([h]) => href.startsWith(h));
  return m ? [m[2], m[1]] : t;
}
function feedIcon(href: string): [string, string] {
  const map: [string, string, string][] = [["/procurement", "truck", "tile-teal"], ["/proposals", "file", "tile-purple"], ["/crm", "funnel", "tile-blue"], ["/projects", "sun", "tile-green"], ["/inbox", "chat", "tile-blue"]];
  const m = map.find(([h]) => href.startsWith(h));
  return m ? [m[2], m[1]] : ["tile-green", "bolt"];
}
const HEALTH_TONE: Record<string, string> = { ON_TRACK: "b-green", AT_RISK: "b-orange", DELAYED: "b-red", BLOCKED: "b-red" };

export default async function Dashboard() {
  const user = await guard("dashboard");
  slaTick();
  refreshAllHealth();
  const d = dashboardFor(user.role, user.id);
  const feed = activityFeed(8);
  const pw = user.role === "customer" ? { recent: [], upcoming: [] } : projectWidgets(user);
  const showExec = user.role === "md" || user.role === "admin";
  const a = showExec ? analytics() : null;
  const x = showExec ? executiveStats() : null;
  const mmss = (sec?: number | null) => (sec == null ? "—" : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`);
  const slaLeads = user.role === "sales"
    ? (getDb().prepare("SELECT l.*, c.name customer_name FROM leads l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.owner_id = ? AND l.status = 'NEW' AND l.first_response_at IS NULL ORDER BY l.received_at DESC LIMIT 4").all(user.id) as any[])
    : [];

  return (
    <div>
      <AutoRefresh seconds={30} />
      <section className="hero mb-5">
        <svg className="panels" viewBox="0 0 400 170" preserveAspectRatio="xMaxYMax slice" aria-hidden>
          <circle cx="330" cy="40" r="26" fill="#ffe65a" opacity=".9" />
          {[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => <polygon key={`${r}${c}`} points={`${120 + c * 60 - r * 14},${72 + r * 26} ${172 + c * 60 - r * 14},${72 + r * 26} ${162 + c * 60 - r * 20},${94 + r * 26} ${108 + c * 60 - r * 20},${94 + r * 26}`} fill="#1c6fb5" stroke="#cfe8ff" strokeWidth="1.2" opacity={.95 - r * .08} />))}
        </svg>
        <div className="relative max-w-[62%] min-w-[240px]">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11.5px] font-semibold backdrop-blur">
            <Icon name="sun" size={14} /> {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
          </div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{greeting()}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-[14px] text-white/85">Powering a greener tomorrow, one project at a time.</p>
          <p className="mt-3 flex items-center gap-2 text-xs text-white/70"><span className="live-dot" /> Live · refreshes every 30s</p>
        </div>
      </section>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {d.kpis.map((k, i) => <KpiCard key={k.label} {...k} icon={kpiIcon(k.label, i).icon} tile={kpiIcon(k.label, i).tile} />)}
      </div>

      {x && (
        <section className="mb-5" aria-label="Business at a glance">
          <div className="eyebrow mb-2">Business at a glance</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="New leads · 30 days" value={String(x.new30)} delta={x.leadDelta} sub="vs previous 30" href="/crm/leads" />
            <StatTile label="Win rate" value={x.winRate == null ? "—" : `${x.winRate}%`} sub={x.conversion != null ? `${x.conversion}% of all leads won` : undefined} tone="good" href="/analytics" />
            <StatTile label="Weighted pipeline" value={inrShort(x.weighted)} sub="stage-probability weighted" href="/crm/pipeline" />
            <StatTile label="First response" value={mmss(x.avgResponse)} sub={x.slaMetPct != null ? `${x.slaMetPct}% within SLA` : undefined} tone={x.slaMetPct != null && x.slaMetPct < 80 ? "warn" : undefined} href="/analytics" />
            <StatTile label="Proposals in play" value={inrShort(x.openProposals.v)} sub={`${x.openProposals.n} open`} href="/proposals" />
            <StatTile label="Active capacity" value={`${(x.active.kw / 1000).toFixed(1)} MW`} sub={`${x.active.n} projects · ${inrShort(x.active.v)}`} href="/projects" />
            <StatTile label="Delivered capacity" value={`${(x.done.kw / 1000).toFixed(1)} MW`} sub={`${x.done.n} completed${x.avgDuration ? ` · avg ${Math.round(x.avgDuration)} d` : ""}`} tone="good" href="/projects?stage=COMPLETED" />
            <StatTile label="Milestones due · 7 days" value={String(x.milestonesWeek)} sub="across active projects" href="/projects" />
            <StatTile label="Procurement health" value={`${x.proc.pct}%`} sub={`${x.proc.delayed} delayed lines`} tone={x.proc.pct >= 85 ? "good" : x.proc.pct >= 65 ? "warn" : "bad"} href="/procurement" />
            <StatTile label="Payable to vendors" value={inrShort(x.proc.payable)} sub={`${inrShort(x.proc.value)} committed`} href="/procurement?view=payment_pending" />
          </div>
        </section>)}

      {slaLeads.length > 0 && (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {slaLeads.map((l) => {
            const s = slaInfo(l);
            return (
              <Link key={l.id} href={`/crm/leads/${l.id}`} className="card flex items-center justify-between gap-3 border-l-4 p-4" style={{ borderLeftColor: "var(--green-500)" }}>
                <div className="min-w-0">
                  <div className="eyebrow !text-[var(--green-700)]">New lead · respond now</div>
                  <div className="truncate text-[15px] font-extrabold">{l.customer_name}</div>
                  <div className="text-xs text-muted">{l.city} · {fmtKw(l.capacity_kw)} · SLA {Math.round(l.sla_seconds / 60)}:00</div>
                </div>
                <SlaTimer deadline={s.deadline} total={s.total} state={s.state} responseSeconds={s.responseSeconds} />
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title={<span id="attention">Needs attention</span>} flush actions={<span className="text-xs text-faint">{d.attention.length ? `${d.attention.length} area${d.attention.length > 1 ? "s" : ""}` : ""}</span>}>
            {d.attention.length === 0 ? (
              <EmptyState icon="check" title="You’re all caught up" body="Nothing needs attention right now." />
            ) : (
              <ul>
                {d.attention.map((i) => (
                  <li key={i.key} className="border-b border-line last:border-0">
                    <Link href={i.href} className="row-link flex items-center gap-3 px-4 py-3">
                      {(() => { const [tl, ic] = attIcon(i.href, i.tone); return <span className={`ic-tile !h-9 !w-9 !rounded-full ${tl}`}><Icon name={ic} size={16} /></span>; })()}
                      <span className="flex-1 text-[13.5px] font-semibold">{i.text}</span>
                      <Icon name="arrow" size={14} className="text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {x && (
            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Business at a glance" className="md:col-span-2" actions={<span className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-muted">Last 6 months ▾</span>}>
                <div className="grid gap-6 md:grid-cols-2">
                  <div><div className="mb-1 text-xs font-semibold text-muted">New leads per week</div><AreaChart rows={x.weeks} color="#2f6fd6" /></div>
                  <div><div className="mb-1 text-xs font-semibold text-muted">Proposals, open value</div><div className="text-[26px] font-extrabold num">{inrShort(x.openProposals.v)}</div><div className="text-xs text-muted">{x.openProposals.n} proposals in play · weighted pipeline {inrShort(x.weighted)}</div></div>
                </div>
              </Card>
              <Card title="Project portfolio" actions={<Link className="lnk text-xs" href="/projects">All projects</Link>}>
                <Donut centre={String(x.health.reduce((a: number, h: any) => a + h.n, 0))} sub="projects" parts={[["ON_TRACK", "On track", "#32c36c"], ["AT_RISK", "At risk", "#ffc93c"], ["DELAYED", "Delayed", "#e5534b"], ["BLOCKED", "Blocked", "#7a1f1a"]].map(([k, l, c]) => ({ label: l, color: c, value: (x.health.find((h: any) => h.health === k) as any)?.n ?? 0 })).filter((p) => p.value > 0)} />
              </Card>
              <Card title="Capacity overview" actions={<span className="text-xs text-faint">kW in execution</span>}>
                <BarList color="var(--green-500)" rows={x.capByStage.filter((r) => r.n > 0).map((r) => ({ label: label(r.stage), value: Math.round(r.kw), sub: `${r.n} proj` }))} fmt={(n) => new Intl.NumberFormat("en-IN").format(n)} />
              </Card>
              <Card title="New leads per week" actions={<span className="text-xs text-faint">last 8 weeks</span>}><MiniBars rows={x.weeks} /></Card>
              <Card title="Lead sources · 90 days"><BarList rows={x.sources.map((r: any) => ({ label: label(r.source), value: r.n }))} /></Card>
              <Card title="Largest active customers" flush>
                <ul>{x.topCustomers.map((c: any) => <li key={c.name} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0"><span className="truncate font-semibold">{c.name}</span><span className="shrink-0 text-xs text-muted">{fmtKw(c.kw)} · <b className="num text-ink">{inrShort(c.v)}</b></span></li>)}</ul>
              </Card>
            </div>)}

          {a && (
            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Pipeline by stage" actions={<Link className="lnk text-xs" href="/crm/pipeline">Open pipeline</Link>}>
                <BarList rows={a.funnel.map((f) => ({ label: label(f.stage), value: f.count, sub: f.value ? inrShort(f.value) : undefined }))} />
              </Card>
              <Card title="Projects by stage" actions={<Link className="lnk text-xs" href="/projects">All projects</Link>}>
                <BarList color="var(--navy-700)" rows={a.projectsByStage.filter((s) => s.stage !== "PROJECT_CREATED").map((s) => ({ label: label(s.stage), value: s.count }))} />
              </Card>
            </div>
          )}

          {pw.recent.length > 0 && (
            <Card title="Recent projects" flush actions={<Link className="lnk text-xs" href="/projects">View all projects</Link>}>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Project</th><th>Stage</th><th>Progress</th><th>Health</th><th className="text-right">Value</th></tr></thead>
                  <tbody>
                    {pw.recent.map((p: any) => (
                      <tr key={p.id} className="row-link">
                        <td><Link href={`/projects/${p.id}`} className="block"><div className="font-bold">{p.name}</div><div className="text-xs text-faint">{p.code} · {p.city ?? "—"} · {fmtKw(p.capacity_kw)}</div></Link></td>
                        <td><span className="badge b-blue">{label(p.stage)}</span></td>
                        <td style={{ minWidth: 120 }}><div className="flex items-center gap-2"><div className="progress flex-1"><div style={{ width: `${p.install_progress}%` }} /></div><span className="num text-xs text-muted">{p.install_progress}%</span></div></td>
                        <td><span className={`badge ${HEALTH_TONE[p.health] ?? ""}`}>{label(p.health)}</span></td>
                        <td className="num text-right font-semibold">{inrShort(p.value)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            </Card>)}

          <div className="grid gap-5 md:grid-cols-2">
            {d.panels.map((p) => (
              <Card key={p.title} title={p.title} flush actions={p.href && <Link className="lnk text-xs" href={p.href}>View all</Link>}>
                {p.rows.length === 0 ? <EmptyState title={p.empty} icon="check" /> : (
                  <ul>
                    {p.rows.map((r, i) => (
                      <li key={i} className="border-b border-line last:border-0">
                        <Link href={r.href} className="row-link flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{r.primary}</div>{r.secondary && <div className="truncate text-xs text-muted">{r.secondary}</div>}</div>
                          {r.badge && <StatusBadge status={r.badge} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Upcoming this week" flush actions={<Link className="lnk text-xs" href="/projects">Projects</Link>}>
            {pw.upcoming.length === 0 ? <EmptyState icon="check" title="No milestones due" /> : (
              <ul>
                {pw.upcoming.map((m: any) => {
                  const dt = new Date(m.due_date + "T00:00:00");
                  return (
                    <li key={m.id} className="border-b border-line last:border-0">
                      <Link href={`/projects/${m.project_id}`} className="row-link flex items-center gap-3 px-4 py-2.5">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--green-50)] text-center leading-none text-[var(--green-700)]"><span><b className="block text-[15px]">{dt.getDate()}</b><span className="text-[9.5px] font-bold uppercase">{dt.toLocaleDateString("en-IN", { month: "short" })}</span></span></span>
                        <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{m.name}</div><div className="truncate text-xs text-muted">{m.project}</div></div>
                      </Link>
                    </li>);
                })}
              </ul>)}
          </Card>
        <Card title="Live business activity" flush actions={<span className="live-dot" />}>
          {feed.length === 0 ? <EmptyState title="No activity yet" body="Events appear here as the business moves." /> : (
            <ul>
              {feed.map((f, i) => (
                <li key={i} className="border-b border-line last:border-0">
                  <Link href={f.href} className="row-link flex items-start gap-3 px-4 py-3">
                    {(() => { const [tl, ic] = feedIcon(f.href); return <span className={`ic-tile !h-9 !w-9 !rounded-full ${tl}`}><Icon name={ic} size={16} /></span>; })()}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold">{f.title}</span>
                        <span className="shrink-0 text-[11px] text-faint">{f.ago}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted">{f.sub}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </div>
    </div>
  );
}
