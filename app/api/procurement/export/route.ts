import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { itemLines, procurementTable, toCsv } from "@/lib/services/proc/intel";

// CSV export of exactly what the procurement table shows (same view / search / filters), scoped to the user's projects.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !can(u.role, "procurement")) return new NextResponse("Forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const viewer = { id: u.id, role: u.role };
  const t = procurementTable(itemLines({ viewer }), { view: sp.get("view") ?? "all", q: sp.get("q") ?? undefined, vendor: Number(sp.get("vendor")) || undefined, project: Number(sp.get("project")) || undefined, category: sp.get("category") ?? undefined, pageSize: 100000 }, viewer);
  return new NextResponse(toCsv(t.all), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="procurement-${sp.get("view") ?? "all"}.csv"`, "Cache-Control": "no-store" } });
}
