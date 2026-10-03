import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { getLayout } from "@/lib/services/layouts";
import { LayoutSheet } from "@/components/layout-sheet";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preliminary Plan Layout" };

export default async function LayoutPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!can(u.role, "design")) redirect("/forbidden");
  const l = getLayout(Number((await params).id));
  if (!l) notFound();
  const a3 = l.sheet.paper === "A3";
  return (
    <div className="min-h-screen bg-white">
      <style>{`@media print{@page{size:${a3 ? "A3" : "A4"} landscape;margin:0}html,body{margin:0}.no-print{display:none!important}.sheetbox{max-width:none!important;padding:0!important}}`}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-2.5"><span className="text-[13px]"><b>{l.sheet.sheet_no}</b> · Rev {l.rev} · choose “Save as PDF” (landscape, no margins, background graphics on)</span><PrintButton /></div>
      <div className="sheetbox mx-auto max-w-[1200px] p-4"><LayoutSheet sheet={l.sheet} drawing={l.drawing} aerial={l.aerial_path ? `/api/files/${l.aerial_path}` : null} /></div>
    </div>
  );
}
