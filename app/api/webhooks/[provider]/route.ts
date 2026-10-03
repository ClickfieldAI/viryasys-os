import { NextRequest, NextResponse } from "next/server";
import { CHANNELS } from "@/lib/providers";
import { ingest } from "@/lib/services/inbox";
import { SYSTEM } from "@/lib/services/core";

// Inbound channel webhooks (Telegram / Google Chat / website form). Each verifies its own shared secret,
// stores the raw message first, then runs AI extraction. Idempotent on (source, external_id).
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const ch = CHANNELS[provider];
  if (!ch) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !ch.verify(req.headers, secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let payload: unknown;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const msg = ch.parseWebhook(payload);
  if (!msg) return NextResponse.json({ ok: true, ignored: true });
  const r = ingest(msg, SYSTEM);
  return NextResponse.json({ ok: true, id: r.id, status: r.status, duplicate: r.duplicate });
}
