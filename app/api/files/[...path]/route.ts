import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { storage } from "@/lib/providers";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" };

// File access control: staff can read everything; customers only documents flagged customer_visible on their own projects.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const u = await getUser();
  if (!u) return new NextResponse("Unauthorized", { status: 401 });
  const rel = (await ctx.params).path.join("/");
  if (u.role === "customer") {
    const ok = getDb().prepare("SELECT 1 FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.file_path = ? AND d.customer_visible = 1 AND p.customer_id = ?").get(rel, u.customer_id);
    if (!ok) return new NextResponse("Forbidden", { status: 403 });
  }
  const buf = await storage.get(rel);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": type ?? "application/octet-stream", "Content-Disposition": type ? "inline" : "attachment", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "Cache-Control": "private, max-age=300" } });
}
