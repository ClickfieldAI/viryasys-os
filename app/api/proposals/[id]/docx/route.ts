import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { docxFor } from "@/lib/services/proposals";

// Editable Word version of the proposal (same structured source as the PDF and the emailed attachment).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u || !can(u.role, "proposals")) return new NextResponse("Forbidden", { status: 403 });
  const v = Number(req.nextUrl.searchParams.get("v")) || undefined;
  const d = await docxFor(Number((await ctx.params).id), v);
  if (!d) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(d.buffer), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${d.filename}"`, "Cache-Control": "no-store",
  } });
}
