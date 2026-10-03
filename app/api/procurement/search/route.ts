import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/config";
import { procurementSearch } from "@/lib/services/proc/intel";

export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || !can(u.role, "procurement")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(procurementSearch(req.nextUrl.searchParams.get("q") ?? "", { id: u.id, role: u.role }));
}
