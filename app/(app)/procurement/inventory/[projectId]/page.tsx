import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can, label } from "@/lib/config";
import { getDb } from "@/lib/db";
import { canSeeProject, ledger, consumptionSummary, requirementRows } from "@/lib/services/procurement";
import { PageHeader, Card, StatusBadge, EmptyState, Field, Pagination, Timeline } from "@/components/ui";
import { ActionForm, ModalButton } from "@/components/client";
import { Select } from "@/components/forms";
import * as A from "@/app/actions/procurement";
import { fmtDateTime, fmtDate } from "@/lib/util";

export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function ProjectStock({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await guard("procurement");
  const pid = Number((await params).projectId);
  const sp = await searchParams;
  if (!canSeeProject({ id: user.id, role: user.role }, pid)) notFound();
  const db = getDb();
  const p = db.prepare("SELECT p.*, c.name customer_name FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?").get(pid) as any;
  if (!p) notFound();
  const wr = can(user.role, "receiving", "w");
  const page = Math.max(1, Number(sp.page) || 1);
  const reqId = Number(sp.material) || undefined;
  const led = ledger(pid, reqId, PAGE, (page - 1) * PAGE);
  const sum = consumptionSummary(pid);
  const reqs = requirementRows(pid);
  const serials = db.prepare("SELECT * FROM serial_numbers WHERE project_id = ? ORDER BY id DESC LIMIT 40").all(pid) as any[];
  const chain = {
    order: db.prepare("SELECT code FROM customer_orders WHERE project_id = ?").get(pid) as any,
    pos: db.prepare("SELECT id, code FROM purchase_orders WHERE project_id = ? AND status NOT IN ('DRAFT','CANCELLED','REJECTED')").all(pid) as any[],
    dels: (db.prepare("SELECT COUNT(*) c FROM deliveries WHERE project_id = ?").get(pid) as any).c,
    grns: (db.prepare("SELECT COUNT(*) c FROM grns WHERE project_id = ?").get(pid) as any).c,
    issues: (db.prepare("SELECT COUNT(*) c FROM material_issues WHERE project_id = ?").get(pid) as any).c,
    returns: (db.prepare("SELECT COUNT(*) c FROM material_returns WHERE project_id = ?").get(pid) as any).c,
  };
  const matOpts = sum.map((m) => [String(m.id), `${m.name} — store ${m.store} · site ${m.site} ${m.unit}`] as [string, string]);
  const form = (title: string, label: string, action: any, fields: React.ReactNode, btn = "btn") => (
    <ModalButton label={label} title={title} className={btn} width={480}><ActionForm action={action} submitLabel={label} className="space-y-3"><input type="hidden" name="project_id" value={pid} /><Field label="Material *"><Select name="requirement_id" required placeholder="Select…" options={matOpts} /></Field>{fields}</ActionForm></ModalButton>
  );

  return (
    <div>
      <PageHeader crumbs={[{ label: "Inventory", href: "/procurement/inventory" }, { label: p.code }]} title={`${p.customer_name} — material ledger`} sub={`${p.name} · ${p.code}`}
        actions={wr ? <>
          {form("Issue material to installation", "Issue", A.issueMaterialAction, <><div className="grid grid-cols-2 gap-3"><Field label="Quantity *"><input name="qty" type="number" step="any" min="0" required className="input" /></Field><Field label="Installation stage"><input name="install_stage" className="input" placeholder="Panel mounting" /></Field><Field label="Issued by *"><input name="issued_by" required defaultValue={user.name} className="input" /></Field><Field label="Received by *"><input name="received_by" required className="input" placeholder="Site engineer" /></Field></div><Field label="Purpose"><input name="purpose" className="input" /></Field></>, "btn btn-primary")}
          {form("Record consumption", "Consume", A.consumeMaterialAction, <><Field label="Quantity used *"><input name="qty" type="number" step="any" min="0" required className="input" /></Field><Field label="Note"><input name="note" className="input" /></Field></>)}
          {form("Return unused material", "Return", A.returnMaterialAction, <><div className="grid grid-cols-2 gap-3"><Field label="Quantity *"><input name="qty" type="number" step="any" min="0" required className="input" /></Field><Field label="Condition"><Select name="condition" options={["Good", "Minor damage", "Damaged"]} /></Field><Field label="Returned by *"><input name="returned_by" required className="input" /></Field><Field label="Received by *"><input name="received_by" required defaultValue={user.name} className="input" /></Field></div><Field label="Reason"><input name="reason" className="input" placeholder="Unused at completion" /></Field></>)}
          {form("Stock count / reconcile", "Stock count", A.reconcileAction, <><Field label="Physically counted *" ><input name="physical" type="number" step="any" min="0" required className="input" /></Field><Field label="Note"><input name="note" className="input" /></Field><p className="hint">A difference from the ledger is posted as an adjustment and raised as a material-variance exception.</p></>)}
        </> : undefined} />

      <Card title="Traceability" className="mb-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          {[["Customer", p.customer_name], ["Project", p.code], ["Order", chain.order?.code ?? "—"], ["Plan", `${reqs.length} materials`], ["POs", chain.pos.map((x) => x.code).join(", ") || "—"], ["Deliveries", String(chain.dels)], ["GRNs", String(chain.grns)], ["Issues", String(chain.issues)], ["Returns", String(chain.returns)]].map(([k, v], i, a) => <span key={k} className="flex items-center gap-2"><span><span className="text-faint">{k}</span> <b>{v}</b></span>{i < a.length - 1 && <span className="text-faint">→</span>}</span>)}
        </div>
      </Card>

      <Card title="Material balance" className="mb-5" flush>
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 1050 }}><thead><tr><th>Material</th><th className="r">Planned</th><th className="r">Received</th><th className="r">Accepted</th><th className="r">In store</th><th className="r">Issued</th><th className="r">Consumed</th><th className="r">Returned</th><th className="r">Damaged</th><th className="r">Rejected</th><th className="r">On hand</th><th className="r">Variance</th><th /></tr></thead>
          <tbody>{sum.map((m) => <tr key={m.id} className={m.flagged ? "bg-[var(--orange-50)]" : ""}><td className="font-semibold">{m.name}<div className="text-xs font-normal text-muted">{m.category}</div></td><td className="r num">{m.qty} {m.unit}</td><td className="r num">{m.received}</td><td className="r num">{m.accepted}</td><td className="r num font-semibold">{m.store}</td><td className="r num">{m.issued}</td><td className="r num">{m.consumed}</td><td className="r num">{m.returned}</td><td className={`r num ${m.damaged ? "text-[var(--red)]" : ""}`}>{m.damaged}</td><td className={`r num ${m.rejected ? "text-[var(--red)]" : ""}`}>{m.rejected}</td><td className="r num font-bold">{m.onHand}</td>
            <td className="r num">{m.unaccounted > 0 ? <b className="text-[var(--red)]">{m.unaccounted} unaccounted</b> : m.variance !== 0 ? `${m.variance > 0 ? "+" : ""}${m.variance}` : "0"}{m.flagged && <div className="text-[11px] font-bold text-[var(--orange)]">Material variance detected</div>}</td>
            <td className="r"><Link className="btn btn-sm btn-ghost" href={`/procurement/inventory/${pid}?material=${m.id}`}>Ledger</Link></td></tr>)}</tbody></table></div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={`Ledger${reqId ? ` — ${sum.find((m) => m.id === reqId)?.name}` : ""}`} className="lg:col-span-2" flush actions={reqId ? <Link className="lnk text-xs" href={`/procurement/inventory/${pid}`}>All materials</Link> : undefined}>
          {led.rows.length === 0 ? <EmptyState icon="cube" title="No movements yet" body="Every receipt, issue, consumption and return is recorded here and can never be edited." /> : (
            <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 720 }}><thead><tr><th>When</th><th>Material</th><th>Movement</th><th className="r">Qty</th><th className="r">Store</th><th className="r">Site</th><th>Ref</th><th>By</th></tr></thead>
              <tbody>{led.rows.map((t) => <tr key={t.id}><td className="whitespace-nowrap">{fmtDateTime(t.at)}</td><td>{t.material}</td><td><StatusBadge status={["ACCEPTED", "RECEIVED"].includes(t.type) ? "ACCEPTED" : ["DAMAGED", "REJECTED", "ADJUST_OUT"].includes(t.type) ? "DAMAGED" : "ISSUED"}>{label(t.type)}</StatusBadge></td><td className="r num">{t.qty}</td><td className="r num">{t.store_delta ? (t.store_delta > 0 ? "+" : "") + t.store_delta : ""}</td><td className="r num">{t.site_delta ? (t.site_delta > 0 ? "+" : "") + t.site_delta : ""}</td><td className="num text-xs">{t.ref_code ?? t.note ?? ""}</td><td className="text-xs text-muted">{t.by_name}</td></tr>)}</tbody></table></div>)}
          <Pagination page={page} pages={Math.max(1, Math.ceil(led.total / PAGE))} total={led.total} href={(n) => `/procurement/inventory/${pid}?${new URLSearchParams({ ...(reqId && { material: String(reqId) }), page: String(n) })}`} />
        </Card>
        <Card title={`Serial numbers (${serials.length})`} flush>{serials.length === 0 ? <EmptyState icon="tag" title="No serialised equipment yet" body="Inverter serial numbers are captured at inspection." /> : (
          <ul className="max-h-[420px] overflow-y-auto">{serials.map((s) => <li key={s.id} className="border-b border-line px-4 py-2 text-[12.5px] last:border-0"><b className="num">{s.serial}</b><div className="text-xs text-muted">{s.material} · received {fmtDate(s.received_on)} · warranty {s.warranty_months}m</div></li>)}</ul>)}</Card>
      </div>
      <span className="hidden"><Timeline items={[]} /></span>
    </div>
  );
}
