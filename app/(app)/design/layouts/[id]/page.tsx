import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { getLayout } from "@/lib/services/layouts";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LayoutEditor } from "@/components/layout-editor";
import { saveLayoutAction, issueLayoutAction, setLayoutAerialAction, attachLayoutToProposalAction } from "@/app/actions/work";
import { fmtDateTime } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function LayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard("design");
  const id = Number((await params).id);
  const l = getLayout(id);
  if (!l) notFound();
  const w = can(user.role, "design", "w");
  return (
    <div>
      <PageHeader crumbs={[{ label: "Design", href: "/design" }, { label: "Preliminary layouts", href: "/design/layouts" }, { label: l.sheet.sheet_no }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{l.sheet.customer_name}<span className="text-[15px] font-semibold text-muted">Rev {l.rev}</span><StatusBadge status={l.status} tone={l.status === "ISSUED" ? "green" : "gray"} /></span>}
        sub={`${l.code}${l.project_code ? ` · project ${l.project_code}` : l.lead_code ? ` · lead ${l.lead_code}` : ""}${l.revisions.length ? ` · issued: ${l.revisions.map((r: any) => `Rev ${r.rev} (${fmtDateTime(r.issued_at)})`).join(", ")}` : ""}`} />
      {w ? (
        <LayoutEditor id={id} code={l.code} init={{ sheet: l.sheet, drawing: l.drawing, status: l.status, rev: l.rev }} aerial={l.aerial_path ? `/api/files/${l.aerial_path}` : null}
          images={l.images.map((i: any) => ({ kind: i.kind, id: i.id, name: i.name, path: i.path }))} proposalCode={l.proposal?.code ?? null}
          actions={{ save: saveLayoutAction.bind(null, id), issue: issueLayoutAction.bind(null, id), aerial: setLayoutAerialAction.bind(null, id), attach: attachLayoutToProposalAction.bind(null, id) }} />
      ) : <p className="text-sm text-muted">You have read-only access. <a className="lnk" href={`/layout-print/${id}`} target="_blank">Open the printable sheet</a>.</p>}
    </div>
  );
}
