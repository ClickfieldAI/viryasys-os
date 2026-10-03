import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { getProposal, planViews } from "@/lib/services/proposals";
import { renderProposal, PROPOSAL_CSS } from "@/lib/proposal-render";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal" };

// Print-ready document. "Generate PDF" = browser Save-as-PDF of this page (PdfProvider swap point).
export default async function PrintProposal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!can(u.role, "proposals")) redirect("/forbidden");
  const cur = getProposal(Number((await params).id), Number((await searchParams).v) || undefined);
  if (!cur) notFound();
  const plan = planViews(cur.proposal.lead_id).filter((x) => /\.(png|jpe?g)$/i.test(x.name)).map((x) => `/api/files/${x.file_path}`);
  const html = renderProposal(cur.doc, cur.vars, cur.pricing, cur.payments, plan);
  return (
    <div className="min-h-screen bg-white">
      <style>{PROPOSAL_CSS}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/95 px-5 py-2.5 backdrop-blur">
        <div className="text-[13px]"><b>{cur.proposal.code}</b> · V{cur.version.version} · {cur.proposal.customer_name} <span className="ml-2 text-faint">Choose “Save as PDF” as the destination.</span></div>
        <PrintButton />
      </div>
      <div className="pdoc mx-auto max-w-[820px] px-6 py-8 sm:px-10" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
