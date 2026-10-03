import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { globalSearch } from "@/lib/services/misc";

export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || u.role === "customer") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(globalSearch(req.nextUrl.searchParams.get("q") ?? ""));
}
