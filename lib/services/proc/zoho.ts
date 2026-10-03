// ZohoBooksIntegrationService — event queue only. No journal/ledger mapping is invented here:
// an event syncs only after finance has approved its mapping, and the receiving side owns the accounting treatment.
import { ZohoBooks } from "../../providers";
import { audit, notify, type Actor } from "../core";
import { nowSql } from "../../clock";
import { all, one, run } from "./core";

export const ZOHO_EVENTS: Record<string, string> = {
  CUSTOMER_ORDER_APPROVED: "Customer order approved", ADVANCE_RECEIVED: "Customer advance received", PURCHASE_ORDER_RELEASED: "Purchase order released to vendor",
  VENDOR_PAYMENT: "Vendor payment made", MATERIAL_RECEIVED: "Material received (GRN)", DELIVERY_NOTE_SIGNED: "Delivery note signed by customer", INVOICE_CREATED: "Customer invoice created",
};

export function ensureMappings() {
  for (const [k, l] of Object.entries(ZOHO_EVENTS)) run("INSERT OR IGNORE INTO zoho_event_mappings (event_type, label, enabled) VALUES (?,?,0)", k, l);
}

const isEnabled = (type: string) => !!one<any>("SELECT enabled FROM zoho_event_mappings WHERE event_type = ?", type)?.enabled;

export function emitEvent(type: string, entity: string, entityId: number, ref: string, payload: unknown) {
  ensureMappings();
  const t = nowSql();
  const id = Number(run("INSERT INTO zoho_sync_events (event_type, entity_type, entity_id, ref, payload, status, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    type, entity, entityId, ref, JSON.stringify(payload), "PENDING", isEnabled(type) ? null : "Awaiting finance approval of the accounting mapping for this event", t, t).lastInsertRowid);
  if (isEnabled(type)) void syncEvent(id);
  return id;
}

/** Attempts a sync. Failures are recorded and surfaced — never swallowed. */
export async function syncEvent(id: number): Promise<"SYNCED" | "FAILED" | "PENDING"> {
  const e = one<any>("SELECT * FROM zoho_sync_events WHERE id = ?", id);
  if (!e || e.status === "SYNCED") return "SYNCED";
  if (!isEnabled(e.event_type)) { run("UPDATE zoho_sync_events SET status='PENDING', last_error=?, updated_at=? WHERE id=?", "Awaiting finance approval of the accounting mapping for this event", nowSql(), id); return "PENDING"; }
  run("UPDATE zoho_sync_events SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", e.attempts > 0 ? "RETRYING" : "PROCESSING", nowSql(), id);
  try {
    const r = await ZohoBooks.push({ id, event_type: e.event_type, ref: e.ref, payload: JSON.parse(e.payload ?? "null") });
    run("UPDATE zoho_sync_events SET status='SYNCED', last_error=NULL, external_id=?, synced_at=?, updated_at=? WHERE id=?", r.externalId, nowSql(), nowSql(), id);
    return "SYNCED";
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 300);
    run("UPDATE zoho_sync_events SET status='FAILED', last_error=?, updated_at=? WHERE id=?", msg, nowSql(), id);
    notify({ role: "finance", type: "zoho_sync", title: `Zoho sync failed: ${ZOHO_EVENTS[e.event_type] ?? e.event_type}`, body: `${e.ref} — ${msg}`, link: "/procurement/zoho" });
    return "FAILED";
  }
}

export async function retryEvent(id: number, actor: Actor) {
  const r = await syncEvent(id);
  audit(actor, "retried zoho sync", "zoho_sync_event", id, undefined, r);
  return r;
}
export async function retryAllFailed(actor: Actor) {
  let ok = 0;
  for (const e of all<any>("SELECT id FROM zoho_sync_events WHERE status IN ('FAILED','PENDING') AND event_type IN (SELECT event_type FROM zoho_event_mappings WHERE enabled = 1)")) if ((await syncEvent(e.id)) === "SYNCED") ok++;
  audit(actor, "retried all zoho sync", "zoho_sync_event", null, undefined, `${ok} synced`);
  return ok;
}
export function setMapping(type: string, enabled: boolean, actor: Actor, note?: string) {
  ensureMappings();
  run("UPDATE zoho_event_mappings SET enabled = ?, approved_by = ?, approved_at = ?, note = COALESCE(?, note) WHERE event_type = ?", enabled ? 1 : 0, enabled ? actor.name : null, enabled ? nowSql() : null, note ?? null, type);
  audit(actor, enabled ? "approved zoho event mapping" : "disabled zoho event mapping", "zoho_event_mapping", type);
}
export const events = (limit = 100) => all<any>("SELECT * FROM zoho_sync_events ORDER BY id DESC LIMIT ?", limit);
export const mappings = () => { ensureMappings(); return all<any>("SELECT * FROM zoho_event_mappings ORDER BY event_type"); };
export const syncSummary = () => Object.fromEntries(all<any>("SELECT status, COUNT(*) c FROM zoho_sync_events GROUP BY status").map((r) => [r.status, r.c])) as Record<string, number>;
