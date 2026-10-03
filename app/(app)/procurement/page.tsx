import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { itemLines, towerKpis, health, materialPosition, projectOverview, openExceptions, upcomingDeliveries, recentActivity, lockedProjects, readyToAuthorize, procurementTable, viewCounts, attentionList, procurementTick, SAVED_VIEWS, impactOf, type Line } from "@/lib/services/procurement";
import { PageHeader, Card, KpiCard, StatusBadge, EmptyState, Icon, Pagination, Timeline } from "@/components/ui";
import { ProcurementHealth, ProjectProcRow, ExceptionRow, RiskBadge } from "@/components/proc";
import { ProcSearch, ColumnPicker } from "@/components/proc-client";
import { ActionButton } from "@/components/client";
import { refreshProcurementAction } from "@/app/actions/procurement";
import { inr, inrShort, fmtDate, fmtDateTime } from "@/lib/util";

export const metadata = { title: "Procurement" };
export const dynamic = "force-dynamic";

const COLS = [["po", "PO"], ["project", "Project"], ["customer", "Customer"], ["vendor", "Vendor"], ["material", "Material"], ["value", "PO Value"], ["ordered", "Ordered"], ["received", "Received"], ["expected", "Expected"], ["actual", "Actual"], ["delay", "Delay"], ["status", "Status"], ["owner", "Owner"]] as const;

function statusLabel(l: Line) {
  if (l.status === "ORDERED" && l.expected_date) return `Ordered → expected ${fmtDate(l.expected_date).replace(/ \d{4}$/, "")}`;
  if (l.status === "DELAYED") return `Delayed ${l.delay_days}d`;
  if (l.status === "AWAITING_CONFIRMATION") return "Awaiting vendor";
  return undefined;
}

export default async function Procurement({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const sp = await searchParams;
  const viewer = { id: user.id, role: user.role };
  procurementTick();
  const lines = itemLines({ viewer });
  const k = towerKpis(lines, viewer);
  const h = health(lines);
  const pos = materialPosition(lines, viewer);
  const overview = projectOverview(lines, viewer);
  const exc = openExceptions(viewer, 6);
  const upcoming = upcomingDeliveries(lines, 7);
  const delayed = lines.filter((l) => l.status === "DELAYED").sort((a, b) => b.delay_days - a.delay_days).slice(0, 6);
  const activity = recentActivity(viewer, 8);
  const locked = lockedProjects(viewer, 5);
  const ready = readyToAuthorize(viewer);
  const attention = attentionList(lines, k, viewer);
  const view = sp.view ?? "all";
  const page = Number(sp.page) || 1;
  const tbl = procurementTable(lines, { view, q: sp.q, sort: sp.sort, dir: sp.dir === "asc" ? "asc" : "desc", page, vendor: Number(sp.vendor) || undefined, project: Number(sp.project) || undefined, category: sp.category }, viewer);
  const counts = viewCounts(lines, viewer);
  const db = getDb();
  const vendors = db.prepare("SELECT id, name FROM vendors ORDER BY name").all() as any[];
  const projs = overview.map((p) => ({ id: p.project_id, code: p.code }));
  const w = can(user.role, "procurement", "w");
  const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams({ ...(sp.view && { view: sp.view }), ...(sp.q && { q: sp.q }), ...(sp.sort && { sort: sp.sort }), ...(sp.dir && { dir: sp.dir }), ...(sp.vendor && { vendor: sp.vendor }), ...(sp.project && { project: sp.project }), ...(sp.category && { category: sp.category }), ...(o as any) }); [...p.keys()].forEach((x) => !p.get(x) && p.delete(x)); return `/procurement?${p}`; };
  const exportHref = `/api/procurement/export?${new URLSearchParams({ view, ...(sp.q && { q: sp.q }), ...(sp.vendor && { vendor: sp.vendor }), ...(sp.project && { project: sp.project }), ...(sp.category && { category: sp.category }) })}`;
  const sortLink = (key: string) => qs({ sort: key, dir: sp.sort === key && sp.dir !== "asc" ? "asc" : "desc", page: undefined });
  const money = k.value;

  return (
    <div>
      <PageHeader title="Procurement" sub="Track purchasing, vendor commitments, deliveries and project material flow."
        actions={<>
          <ProcSearch />
          <ActionButton action={refreshProcurementAction} className="btn btn-sm" title="Re-check delays, confirmations and payments now"><Icon name="refresh" size={13} /></ActionButton>
          <a className="btn" href={exportHref}>Export</a>
          <details className="relative">
            <summary className="btn cursor-pointer list-none">Filters{(sp.vendor || sp.project || sp.category) ? " •" : ""}</summary>
            <form className="absolute right-0 z-30 mt-1 w-64 space-y-2 rounded-lg border border-line bg-white p-3 shadow-xl" method="get">
              <input type="hidden" name="view" value={view} />
              <div><label className="label">Vendor</label><select name="vendor" defaultValue={sp.vendor ?? ""} className="input"><option value="">All</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
              <div><label className="label">Project</label><select name="project" defaultValue={sp.project ?? ""} className="input"><option value="">All</option>{projs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
              <div><label className="label">Category</label><select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">All</option>{["Panels", "Inverters", "Structure", "Cables", "Electrical"].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="flex gap-2"><button className="btn btn-primary btn-sm">Apply</button><Link className="btn btn-sm" href="/procurement">Clear</Link></div>
            </form>
          </details>
          {w && <Link href="/procurement/new" className="btn btn-primary"><Icon name="plus" size={14} /> New Procurement</Link>}
        </>} />

      <nav className="-mt-2 mb-4 flex flex-wrap gap-1.5 text-[12.5px]" aria-label="Procurement sections">
        {[["Purchase requests", "/procurement/requests"], ["Exceptions", "/procurement/exceptions"], ["Calendar", "/procurement/calendar"], ["Analytics", "/procurement/analytics"], ["Accounting sync", "/procurement/zoho"]].map(([l, h]) => <Link key={h} href={h} className="rounded-full border border-line bg-white px-3 py-1 font-semibold text-muted transition-colors hover:border-[var(--green-500)] hover:text-ink">{l}</Link>)}
      </nav>

      {/* KPI row — every card filters the table below */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Procurement value" value={inrShort(money)} sub={`${inrShort(k.payable)} payable`} href="/procurement?view=all#table" />
        <KpiCard label="Open POs" value={String(k.openPos)} href="/procurement?view=open#table" />
        <KpiCard label="Awaiting vendor" value={String(k.awaitingConfirmation)} tone={k.awaitingConfirmation ? "warn" : undefined} href="/procurement?view=awaiting_confirmation#table" />
        <KpiCard label="Payment pending" value={String(k.paymentPending)} sub={k.paymentPending ? inrShort(k.paymentPendingAmount) : undefined} tone={k.paymentPending ? "warn" : undefined} href="/procurement?view=payment_pending#table" />
        <KpiCard label="In transit" value={String(k.inTransit)} href="/procurement?view=in_transit#table" />
        <KpiCard label="Delayed" value={String(k.delayed)} tone={k.delayed ? "bad" : "good"} href="/procurement?view=delayed#table" />
        <KpiCard label="Received today" value={String(k.receivedToday)} href="/procurement?view=received_today#table" />
        <KpiCard label="Inspection pending" value={String(k.inspectionPending)} tone={k.inspectionPending ? "warn" : undefined} href="/procurement?view=inspection_pending#table" />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <ProcurementHealth h={h} />
        <Card title={<span className="flex items-center gap-2"><Icon name="alert" size={15} className="text-[var(--red)]" /> Critical procurement issues</span>} flush className="lg:col-span-2" actions={<Link className="lnk text-xs" href="/procurement/exceptions">Exception centre</Link>}>
          {exc.length === 0 && attention.length === 0 ? <EmptyState icon="check" title="No delayed deliveries or open issues" body="All current procurement commitments are on schedule." /> : (
            <ul>
              {exc.map((e) => <ExceptionRow key={e.id} e={e} action={<Link className="lnk" href={e.po_id ? `/procurement/${e.po_id}` : "/procurement/exceptions"}>Open</Link>} />)}
              {exc.length === 0 && attention.slice(0, 5).map((a) => <li key={a.text} className="border-b border-line last:border-0"><Link href={a.href} className="row-link flex items-center gap-3 px-4 py-3 text-[13.5px] font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: a.tone === "bad" ? "var(--red)" : "var(--solar-600)" }} />{a.text}</Link></li>)}
            </ul>)}
          {attention.length > 0 && exc.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">{attention.map((a) => <Link key={a.text} href={a.href} className={`badge ${a.tone === "bad" ? "b-red" : a.tone === "warn" ? "b-orange" : "b-blue"}`}>{a.text}</Link>)}</div>)}
        </Card>
      </div>

      <Card title="What do you want to do?" className="mb-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {[["Purchase request", "/procurement/requests", "file", w], ["Create PO", "/procurement/new", "plus", w], ["Vendor confirmation", "/procurement/orders?status=SENT", "check", w], ["Record delivery", "/procurement/deliveries", "truck", w],
            ["Receive material", "/procurement/deliveries?status=IN_TRANSIT", "cube", true], ["Create GRN", "/procurement/receipts", "receipt", true], ["Issue material", "/procurement/issues", "upload", true], ["Return material", "/procurement/returns", "refresh", true]].map(([l, href, ic, ok]) => (
            <Link key={l as string} href={href as string} aria-disabled={!ok} className={`flex flex-col items-center gap-1.5 rounded-lg border border-line p-3 text-center text-[12.5px] font-semibold transition-colors hover:border-[var(--green-500)] hover:bg-[var(--green-50)] ${ok ? "" : "pointer-events-none opacity-40"}`}><Icon name={ic as string} size={18} className="text-[var(--green-700)]" />{l}</Link>))}
        </div>
      </Card>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card title="Project procurement status" flush className="lg:col-span-2" actions={<Link className="lnk text-xs" href="/procurement/inventory">Project stock</Link>}>
          {locked.length > 0 && (
            <div className="border-b border-line bg-[var(--orange-50)] px-4 py-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wider text-[var(--orange)]"><Icon name="lock" size={13} /> Procurement locked</div>
              <ul className="space-y-1">{locked.slice(0, 3).map((p: any) => <li key={p.id} className="text-[12.5px]"><Link className="font-bold hover:underline" href={`/procurement/plans/${p.id}`}>{p.customer}</Link> <span className="text-muted">({p.code}) — {p.gate.reasons[0].message}{p.gate.reasons[0].required ? ` Required ${p.gate.reasons[0].required}, received ${p.gate.reasons[0].received}.` : ""}</span></li>)}</ul>
            </div>)}
          {ready.length > 0 && w && <div className="border-b border-line bg-[var(--green-50)] px-4 py-2.5 text-[12.5px]"><b className="text-[var(--green-700)]">{ready.length} project{ready.length > 1 ? "s" : ""} ready to authorize:</b> {ready.slice(0, 4).map((p: any, i: number) => <span key={p.id}>{i > 0 && ", "}<Link className="lnk" href={`/procurement/plans/${p.id}`}>{p.code}</Link></span>)}{ready.length > 4 ? "…" : ""}</div>}
          {overview.length === 0 ? <EmptyState icon="truck" title="No purchase orders yet" body="Once a project’s order is approved and the advance is received, procurement unlocks and you can raise purchase orders." /> : overview.slice(0, 6).map((p) => <ProjectProcRow key={p.project_id} p={p} />)}
          {overview.length > 6 && <div className="px-4 py-2.5 text-xs"><Link className="lnk" href="/procurement/inventory">All {overview.length} projects →</Link></div>}
        </Card>
        <Card title="Where is the material (₹)" flush>
          <table className="tbl"><tbody>{([["Ordered", pos.ordered], ["In transit", pos.inTransit], ["Received at site", pos.received], ["Under inspection", pos.underInspection], ["Accepted", pos.accepted], ["Shortages", pos.shortages], ["Damaged / rejected", pos.damaged], ["Issued to projects", pos.issued], ["Consumed", pos.consumed], ["Returned", pos.returned]] as [string, number][]).map(([l, v]) => (
            <tr key={l}><td className="text-muted">{l}</td><td className={`r num font-semibold ${(l === "Shortages" || l === "Damaged / rejected") && v > 0 ? "text-[var(--red)]" : ""}`}>{inrShort(v)}</td></tr>))}</tbody></table>
        </Card>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Upcoming deliveries (7 days)" flush actions={<Link className="lnk text-xs" href="/procurement/calendar">Calendar</Link>}>
          {upcoming.length === 0 ? <EmptyState icon="calendar" title="Nothing due this week" body="No confirmed deliveries fall in the next seven days." /> : (
            <ul>{upcoming.map((l) => <li key={l.id} className="border-b border-line last:border-0"><Link href={`/procurement/${l.po_id}`} className="row-link flex items-center justify-between gap-3 px-4 py-2.5"><div className="min-w-0"><div className="truncate text-[13px] font-semibold">{l.description}</div><div className="text-xs text-muted">{l.project_code} · {l.vendor_name} · {l.remaining} {l.unit}</div></div><div className="text-right text-xs"><b>{fmtDate(l.expected_date).replace(/ \d{4}$/, "")}</b>{l.promise_count > 1 && <div className="text-[var(--orange)]">date changed ×{l.promise_count - 1}</div>}</div></Link></li>)}</ul>)}
        </Card>
        <Card title="Delayed deliveries" flush actions={<Link className="lnk text-xs" href="/procurement?view=delayed#table">View all</Link>}>
          {delayed.length === 0 ? <EmptyState icon="check" title="No delayed deliveries" body="All current procurement commitments are on schedule." /> : (
            <ul>{delayed.map((l) => { const im = impactOf(l); return (
              <li key={l.id} className="border-b border-line last:border-0"><Link href={`/procurement/${l.po_id}`} className="row-link block px-4 py-2.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold">{l.description}</span><span className="shrink-0 text-xs font-bold text-[var(--red)]">{l.delay_days}d late</span></div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted"><span>{l.customer_name}</span><span>· {l.vendor_name}</span><span>· was {fmtDate(l.original_expected).replace(/ \d{4}$/, "")}</span><RiskBadge risk={im.risk} />{im.milestone && <span>→ {im.milestone}</span>}</div></Link></li>); })}</ul>)}
        </Card>
      </div>

      <Card title="Recent procurement activity" className="mb-6" flush>
        {activity.length === 0 ? <EmptyState icon="list" title="No activity yet" /> : <div className="px-4 py-3"><Timeline items={activity.map((a) => ({ title: a.summary, sub: `${a.project_code ?? ""} · ${a.user_name ?? "System"}`, at: fmtDateTime(a.at), tone: ["material_received", "vendor_confirmation", "grn", "customer_ack"].includes(a.type) ? "green" : ["delivery_date_changed", "po_rejected"].includes(a.type) ? "red" : "gray" }))} /></div>}
      </Card>

      <div id="table" className="scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-extrabold">Procurement table</h2>
          <div className="flex items-center gap-2">
            <form method="get" className="relative">{Object.entries({ view, vendor: sp.vendor, project: sp.project, category: sp.category }).map(([kk, v]) => v && <input key={kk} type="hidden" name={kk} value={v} />)}<Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" /><input name="q" defaultValue={sp.q} className="input pl-8" style={{ width: 240 }} placeholder="Search table…" aria-label="Search procurement table" /></form>
            <ColumnPicker tableId="ptable" cols={COLS.map(([key, l]) => ({ key, label: l }))} />
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Saved views">
          {SAVED_VIEWS.map((v) => <Link key={v.key} href={qs({ view: v.key, page: undefined }) + "#table"} className={`btn btn-sm ${view === v.key ? "btn-dark" : ""}`}>{v.label} <span className="opacity-60">{counts[v.key] ?? 0}</span></Link>)}
        </div>
        <Card flush>
          {tbl.rows.length === 0 ? <EmptyState icon="truck" title={view === "delayed" ? "No delayed deliveries" : "Nothing in this view"} body={view === "delayed" ? "All current procurement commitments are on schedule." : "Try another saved view or clear the filters."} /> : (
            <div className="overflow-x-auto"><table className="tbl" id="ptable" style={{ minWidth: 1180 }}>
              <thead><tr>{COLS.map(([key, l]) => <th key={key} className={`col-${key} ${["value", "ordered", "received", "delay"].includes(key) ? "r" : ""}`}><Link href={sortLink(key) + "#table"} className="hover:text-ink">{l}{sp.sort === key ? (sp.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>)}</tr></thead>
              <tbody>{tbl.rows.map((l) => (
                <tr key={l.id}>
                  <td className="col-po"><Link className="lnk num" href={`/procurement/${l.po_id}`}>{l.po_code}</Link></td>
                  <td className="col-project"><Link className="lnk num" href={`/procurement/plans/${l.project_id}`}>{l.project_code}</Link></td>
                  <td className="col-customer">{l.customer_name}</td>
                  <td className="col-vendor">{l.vendor_name}</td>
                  <td className="col-material font-semibold">{l.description}<div className="text-xs font-normal text-muted">{l.category}</div></td>
                  <td className="col-value r num">{inr(l.value)}</td>
                  <td className="col-ordered r num">{l.qty} {l.unit}</td>
                  <td className="col-received r num">{l.accepted + l.pending_inspection}/{l.target}</td>
                  <td className="col-expected">{l.promise_count > 1 ? <span><s className="text-faint">{fmtDate(l.original_expected).replace(/ \d{4}$/, "")}</s> <b>{fmtDate(l.expected_date).replace(/ \d{4}$/, "")}</b></span> : l.expected_date ? fmtDate(l.expected_date).replace(/ \d{4}$/, "") : <span className="text-faint">—</span>}</td>
                  <td className="col-actual">{l.actual_date ? fmtDate(l.actual_date).replace(/ \d{4}$/, "") : <span className="text-faint">—</span>}</td>
                  <td className={`col-delay r num ${l.total_delay > 0 ? "font-bold text-[var(--red)]" : ""}`}>{l.total_delay > 0 ? `+${l.total_delay}d` : "—"}</td>
                  <td className="col-status"><StatusBadge status={l.status === "DELAYED" ? "delayed" : l.status}>{statusLabel(l) ?? label(l.status)}</StatusBadge></td>
                  <td className="col-owner">{l.owner_name ?? "—"}</td>
                </tr>))}</tbody>
            </table></div>)}
          <Pagination page={tbl.page} pages={tbl.pages} total={tbl.total} href={(p) => qs({ page: String(p) }) + "#table"} />
        </Card>
      </div>
    </div>
  );
}
