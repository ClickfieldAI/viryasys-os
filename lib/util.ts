// Pure helpers (safe to import from client components).

export const TZ = "Asia/Kolkata";

/** SQLite-style UTC timestamp: "YYYY-MM-DD HH:MM:SS". */
export function sqlTime(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
export function parseSql(s?: string | null): Date | null {
  if (!s) return null;
  const iso = s.length <= 10 ? `${s}T00:00:00+05:30` : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const dateOnly = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD in IST

export function fmtDate(s?: string | null): string {
  const d = parseSql(s);
  return d ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }).format(d) : "—";
}
export function fmtDateTime(s?: string | null): string {
  const d = parseSql(s);
  return d
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ }).format(d)
    : "—";
}
export function timeAgo(s?: string | null, now: Date = new Date()): string {
  const d = parseSql(s);
  if (!d) return "—";
  const sec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return `${Math.floor(sec / 86400)} d ago`;
}

/** Indian-grouped rupees: ₹18,50,000 */
export function inr(n?: number | null): string {
  if (n == null || isNaN(n)) return "—";
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));
}
/** Compact: ₹8.4 Cr / ₹42.5 L */
export function inrShort(n?: number | null): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 1 : 2).replace(/\.?0+$/, "")} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, "")} L`;
  return inr(n);
}
export const fmtKw = (kw?: number | null) => (kw == null ? "—" : kw >= 1000 ? `${(kw / 1000).toFixed(kw % 1000 ? 1 : 0)} MW` : `${kw} kW`);

export function money2(n: number) {
  return Math.round(n * 100) / 100;
}

/** dd-mm-yyyy, the format used on ViryaSys proposals and emails. */
export function fmtDMY(s?: string | null): string {
  const d = parseSql(s);
  if (!d) return "—";
  const p = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ }).format(d);
  return p.replace(/\//g, "-");
}
