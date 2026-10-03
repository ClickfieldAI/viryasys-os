import Link from "next/link";
import { guard } from "@/lib/auth";
import { calendarEvents, type CalEvent } from "@/lib/services/procurement";
import { today } from "@/lib/clock";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Procurement calendar" };
export const dynamic = "force-dynamic";
const TONE: Record<CalEvent["tone"], string> = { done: "var(--green-600)", upcoming: "var(--blue)", late: "var(--red)", neutral: "var(--faint)" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const t = today();
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : t.slice(0, 7);
  const [Y, M] = m.split("-").map(Number);
  const first = new Date(Date.UTC(Y, M - 1, 1));
  const days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const from = `${m}-01`, to = `${m}-${String(days).padStart(2, "0")}`;
  const ev = calendarEvents(from, to, { id: user.id, role: user.role });
  const by = new Map<string, CalEvent[]>();
  ev.forEach((e) => by.set(e.date, [...(by.get(e.date) ?? []), e]));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => { const d = i - lead + 1; return d >= 1 && d <= days ? `${m}-${String(d).padStart(2, "0")}` : null; });
  const prev = new Date(Date.UTC(Y, M - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(Y, M, 1)).toISOString().slice(0, 7);
  // "what is expected at which project this week?"
  const wkEnd = new Date(Date.parse(t) + 6 * 86400000).toISOString().slice(0, 10);
  const week = calendarEvents(t, wkEnd, { id: user.id, role: user.role }).filter((e) => e.kind === "Expected" || e.kind === "Required");
  return (
    <div>
      <PageHeader title="Procurement calendar" sub="PO dates, vendor confirmations, payments, expected and actual deliveries, inspections and project requirements. Colour means status only."
        actions={<><Link className="btn" href={`/procurement/calendar?m=${prev}`}>←</Link><span className="px-1 text-[14px] font-extrabold">{first.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span><Link className="btn" href={`/procurement/calendar?m=${next}`}>→</Link><Link className="btn" href="/procurement/calendar">Today</Link></>} />
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">{([["done", "Done / received"], ["upcoming", "Upcoming"], ["late", "Delayed / attention"], ["neutral", "Neutral"]] as const).map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: TONE[k] }} />{l}</span>)}</div>
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-[var(--sunk)] text-center text-[11px] font-bold uppercase tracking-wider text-faint">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">{cells.map((d, i) => { const es = d ? by.get(d) ?? [] : []; return (
            <div key={i} className={`min-h-[104px] border-b border-r border-line p-1.5 ${d === t ? "bg-[var(--green-50)]" : ""} ${d ? "" : "bg-[var(--sunk)]"}`}>
              {d && <div className={`mb-1 text-[11px] font-bold ${d === t ? "text-[var(--green-700)]" : "text-faint"}`}>{Number(d.slice(8))}</div>}
              {es.slice(0, 3).map((e, n) => <Link key={n} href={e.href} className="mb-0.5 flex items-start gap-1 rounded px-1 py-0.5 text-[10.5px] leading-tight hover:bg-white" title={`${e.kind}: ${e.label}${e.project ? ` (${e.project})` : ""}`}><i className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE[e.tone] }} /><span className="line-clamp-2">{e.label}</span></Link>)}
              {es.length > 3 && <div className="px-1 text-[10px] font-semibold text-muted">+{es.length - 3} more</div>}
            </div>); })}</div>
        </div>
        <Card title="This week — what is expected where" flush>{week.length === 0 ? <EmptyState icon="calendar" title="Nothing expected this week" body="No confirmed deliveries or plan requirements fall in the next seven days." /> : (
          <ul className="max-h-[560px] overflow-y-auto">{week.map((e, i) => <li key={i} className="border-b border-line last:border-0"><Link href={e.href} className="row-link flex items-start gap-2.5 px-4 py-2.5"><i className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE[e.tone] }} /><div className="min-w-0 text-[13px]"><div className="font-semibold">{e.label}</div><div className="text-xs text-muted">{e.project} · {e.kind} · {fmtDate(e.date).replace(/ \d{4}$/, "")}</div></div></Link></li>)}</ul>)}</Card>
      </div>
    </div>
  );
}
