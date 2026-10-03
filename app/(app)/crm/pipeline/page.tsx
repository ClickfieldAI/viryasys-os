import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, LEAD_STAGES, label } from "@/lib/config";
import { pipelineBoard, slaTick } from "@/lib/services/leads";
import { PageHeader, StatusBadge } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { changeStatusAction } from "@/app/actions/crm";
import { fmtKw, inrShort } from "@/lib/util";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";
const MANUAL = ["NEW", "CONTACTED", "QUALIFIED"];

export default async function Pipeline() {
  const user = await guard("crm");
  slaTick();
  const board = pipelineBoard();
  const w = can(user.role, "crm", "w");
  const open = Object.entries(board).filter(([k]) => k !== "WON").flatMap(([, v]) => v);
  const total = open.reduce((a, l) => a + (l.est_value ?? 0), 0);
  return (
    <div>
      <PageHeader title="Pipeline" sub={`${open.length} open leads · ${inrShort(total)} estimated value. Early stages are moved by hand; site visit → won advance automatically as the work completes.`} />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 lg:-mx-6 lg:px-6">
        <div className="flex gap-3" style={{ minWidth: LEAD_STAGES.length * 236 }}>
          {LEAD_STAGES.map((stage, si) => {
            const items = board[stage];
            const sum = stage === "WON" ? 0 : items.reduce((a, l) => a + (l.est_value ?? 0), 0);
            const next = LEAD_STAGES[si + 1];
            return (
              <div key={stage} className="w-[224px] shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <div className="text-[12px] font-extrabold uppercase tracking-wider">{label(stage)} <span className="ml-1 font-semibold text-faint">{items.length}</span></div>
                  <div className="text-[11px] font-semibold text-muted">{stage === "WON" ? "recent" : inrShort(sum)}</div>
                </div>
                <div className="space-y-2 rounded-lg bg-[#eaeef2] p-2" style={{ minHeight: 120 }}>
                  {items.length === 0 && <div className="py-6 text-center text-xs text-faint">Empty</div>}
                  {items.map((l) => (
                    <div key={l.id} className="card p-3 transition-shadow hover:shadow-md">
                      <Link href={`/crm/leads/${l.id}`} className="block">
                        <div className="truncate text-[13px] font-bold">{l.customer_name}</div>
                        <div className="mt-0.5 text-xs text-muted">{fmtKw(l.capacity_kw)} · {l.city}</div>
                      </Link>
                      <div className="mt-2 flex items-center justify-between gap-1">
                        <span className="text-[13px] font-extrabold num">{inrShort(l.est_value)}</span>
                        <StatusBadge status={l.temperature} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-faint"><span className="truncate">{l.owner_name ?? "Unassigned"}</span>
                        {w && MANUAL.includes(stage) && next && <ActionButton action={changeStatusAction.bind(null, l.id, next, undefined)} className="btn btn-sm !h-6 !px-2 text-[11px]" title={`Move to ${label(next)}`}>{label(next)} →</ActionButton>}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
