import { getDb } from "../db";
import { nowSql } from "../clock";
import type { RoleKey } from "../config";

export interface Actor { id: number | null; name: string; role?: RoleKey }
export const SYSTEM: Actor = { id: null, name: "ViryaSys OS" };

/* ───────────── AuditService ───────────── */
export function audit(actor: Actor, action: string, entity: string, entityId: string | number | null, oldV?: unknown, newV?: unknown) {
  getDb()
    .prepare("INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, old_value, new_value, at) VALUES (?,?,?,?,?,?,?,?)")
    .run(actor.id, actor.name, action, entity, entityId == null ? null : String(entityId),
      oldV === undefined ? null : typeof oldV === "string" ? oldV : JSON.stringify(oldV),
      newV === undefined ? null : typeof newV === "string" ? newV : JSON.stringify(newV), nowSql());
}

/* ───────────── NotificationService ───────────── */
export type NotifType =
  | "new_lead" | "sla_warning" | "sla_breach" | "task_assigned" | "site_survey_scheduled" | "design_ready"
  | "proposal_ready" | "proposal_approved" | "payment_received" | "procurement_delay" | "material_received"
  | "installation_milestone" | "customer_query" | "project_delay" | "ai_review" | "info" | "po_approval" | "vendor_confirmation" | "delivery_delay" | "material_shortage" | "material_damage" | "cost_variance" | "zoho_sync";

export function notify(o: { userId?: number | null; role?: RoleKey; type: NotifType; title: string; body?: string; link?: string }) {
  getDb()
    .prepare("INSERT INTO notifications (user_id, role, type, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(o.userId ?? null, o.role ?? null, o.type, o.title, o.body ?? null, o.link ?? null, nowSql());
}

export function notificationsFor(user: { id: number; role: RoleKey }, limit = 50) {
  return getDb()
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? OR (user_id IS NULL AND role = ?) ORDER BY id DESC LIMIT ?`
    )
    .all(user.id, user.role, limit) as any[];
}
export function unreadCount(user: { id: number; role: RoleKey }): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) c FROM notifications WHERE is_read = 0 AND (user_id = ? OR (user_id IS NULL AND role = ?))")
      .get(user.id, user.role) as { c: number }
  ).c;
}
export function markRead(user: { id: number; role: RoleKey }, id?: number) {
  const db = getDb();
  if (id) db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR role = ?)").run(id, user.id, user.role);
  else db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? OR (user_id IS NULL AND role = ?)").run(user.id, user.role);
}

export const usersByRole = (role: RoleKey) =>
  getDb().prepare("SELECT id, name FROM users WHERE role = ? AND active = 1 ORDER BY id").all(role) as { id: number; name: string }[];
export const userName = (id?: number | null) =>
  id ? ((getDb().prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "—") : "Unassigned";
