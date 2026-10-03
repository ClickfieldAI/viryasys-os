import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { SCHEMA } from "./schema";

const g = globalThis as unknown as { __vos?: Database.Database };

export type DB = Database.Database;

export function getDb(): DB {
  if (g.__vos) return g.__vos;
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "vos.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  try { db.exec("ALTER TABLE site_surveys ADD COLUMN details TEXT"); } catch { /* column already there */ }
  g.__vos = db;
  // Seed lazily, after the singleton is registered (seed uses services that call getDb()).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./catalog").seedCatalog(db);
  const seeded = db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number };
  if (seeded.c === 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./seed").seed(db);
  }
  return db;
}

/** Human-readable sequential IDs: VS-LEAD-000001. Atomic per key. */
export function nextCode(prefix: string, db: DB = getDb()): string {
  const row = db
    .prepare("INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value")
    .get(prefix) as { value: number };
  return `VS-${prefix}-${String(row.value).padStart(6, "0")}`;
}

export function getSetting<T>(key: string, fallback: T): T {
  const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(key: string, value: unknown) {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

export interface TaxRate { name: string; pct: number }
export interface OrgSettings {
  taxes: TaxRate[];
  sla_seconds: number;
  payment_templates: { name: string; milestones: { name: string; pct: number }[] }[];
  calc: { irradiation_kwh_m2_year: number; panel_wp: number; area_sqm_per_kwp: number; performance_ratio: number; degradation_pct: number; tariff_per_kwh: number; cost_per_kwp: number; area_sqft_per_kw: number; tariff_escalation_pct?: number; om_pct?: number; co2_kg_per_kwh?: number };
  proposal_validity_days: number;
  followup_days?: number;
  email: { auto_send: boolean; subject: string; body: string; from_name: string; cc: string };
}
export const DEFAULT_EMAIL_SUBJECT = "Solar proposal {{proposal_no}} — {{customer_name}}, {{site_location}}";
export const DEFAULT_EMAIL_BODY = `Dear {{salutation}},

Greetings from Viryasys Technologies Solar!

Based on the site assessments conducted on {{survey_date}}, along with your energy requirements, we are pleased to share the attached proposal for the recommended rooftop solar power system for your review and consideration.

The proposal includes the proposed system configuration, scope of work, commercial quotation, and other relevant technical details. We kindly request you to review the proposal and let us know if you have any questions or require any further clarification or modifications.

Along with the proposal, we have also attached a Plan view of the proposed solar system for your reference. Please note that the attached plan view and other illustrative images are provided for reference and visualization purposes only. The actual installation layout and certain system details may be subject to changes based on site conditions, technical requirements, and installation considerations.

We look forward to receiving your valuable feedback and the opportunity to take this project forward with you.

Thanks & Regards,

{{pm_name}}
{{pm_title}}
Viryasys Technologies Solar`;

export const DEFAULT_SETTINGS: OrgSettings = {
  taxes: [{ name: "CGST", pct: 9 }, { name: "SGST", pct: 9 }],
  sla_seconds: 120,
  payment_templates: [
    { name: "50 / 50", milestones: [{ name: "Advance", pct: 50 }, { name: "After Installation", pct: 50 }] },
    { name: "70 / 30", milestones: [{ name: "Advance", pct: 70 }, { name: "After Installation", pct: 30 }] },
    { name: "90 / 10", milestones: [{ name: "Advance", pct: 90 }, { name: "Final", pct: 10 }] },
    { name: "70 / 20 / 10", milestones: [{ name: "Advance payment along with Purchase Order", pct: 70 }, { name: "After dispatch of Solar PV panels and the Inverter systems", pct: 20 }, { name: "After Installation", pct: 10 }] },
  ],
  calc: { irradiation_kwh_m2_year: 1800, panel_wp: 540, area_sqm_per_kwp: 9.5, performance_ratio: 0.8, degradation_pct: 0.5, tariff_per_kwh: 7.5, cost_per_kwp: 38000, area_sqft_per_kw: 110, tariff_escalation_pct: 3, om_pct: 1, co2_kg_per_kwh: 0.82 },
  proposal_validity_days: 7,
  followup_days: 10,
  email: { auto_send: true, subject: DEFAULT_EMAIL_SUBJECT, body: DEFAULT_EMAIL_BODY, from_name: "Viryasys Technologies Solar", cc: "" },
};
export function settings(): OrgSettings {
  const st = getSetting<Partial<OrgSettings>>("org", {});
  // Merge nested groups so settings saved before a field existed still get its default.
  return { ...DEFAULT_SETTINGS, ...st, calc: { ...DEFAULT_SETTINGS.calc, ...st.calc }, email: { ...DEFAULT_SETTINGS.email, ...st.email } } as OrgSettings;
}
