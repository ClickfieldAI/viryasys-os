// A controllable clock. Production code always sees real time; the demo seed uses withClock() to
// build believable history (POs raised days ago, deliveries that slipped) through the real services.
import { dateOnly, sqlTime } from "./util";

let override: Date | null = null;
export const now = () => override ?? new Date();
export const nowSql = () => sqlTime(now());
export const today = () => dateOnly(now());
export function withClock<T>(d: Date, fn: () => T): T {
  const prev = override;
  override = d;
  try { return fn(); } finally { override = prev; }
}
