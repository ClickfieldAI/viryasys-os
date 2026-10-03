// SiteSurveyService + DesignService + SolarCalculationEngine.
import { getDb, settings, type OrgSettings } from "../db";
import { addDays, sqlTime } from "../util";
import { audit, notify, usersByRole, userName, type Actor, SYSTEM } from "./core";
import { fire } from "./automation";
import { changeStatus, logActivity } from "./leads";

/* ───────────── SolarCalculationEngine ───────────── */
export interface CalcInput { annual_kwh?: number; monthly_kwh?: number; roof_area_sqm?: number; capacity_kw?: number; panel_wp?: number; location?: string }
export interface CalcOutput {
  recommended_kw: number; limiting_factor: "consumption" | "roof area" | "specified capacity";
  panel_count: number; panel_wp: number; annual_generation_kwh: number; specific_yield_kwh_per_kwp: number;
  monthly_generation_kwh: number; est_annual_saving: number; est_system_cost: number; payback_years: number | null;
  required_area_sqm: number; supporting: { assumptions: OrgSettings["calc"]; notes: string[]; year_25_generation_kwh: number };
}

export class SolarCalculationEngine {
  constructor(private cfg: OrgSettings["calc"]) {}
  static fromSettings() { return new SolarCalculationEngine(settings().calc); }

  compute(i: CalcInput): CalcOutput {
    const c = this.cfg;
    const notes: string[] = [];
    const specificYield = c.irradiation_kwh_m2_year * c.performance_ratio; // kWh per kWp per year
    const annual = i.annual_kwh ?? (i.monthly_kwh ? i.monthly_kwh * 12 : undefined);

    const byConsumption = annual ? annual / specificYield : undefined;
    const byArea = i.roof_area_sqm ? i.roof_area_sqm / c.area_sqm_per_kwp : undefined;
    let kw: number, limiting: CalcOutput["limiting_factor"];
    if (i.capacity_kw) { kw = i.capacity_kw; limiting = "specified capacity"; }
    else if (byConsumption && byArea) { kw = Math.min(byConsumption, byArea); limiting = byArea < byConsumption ? "roof area" : "consumption"; }
    else if (byConsumption) { kw = byConsumption; limiting = "consumption"; notes.push("Roof area not provided — sized on consumption only."); }
    else if (byArea) { kw = byArea; limiting = "roof area"; notes.push("Consumption not provided — sized on roof area only."); }
    else throw new Error("Provide consumption, roof area or a target capacity");
    if (byArea && kw > byArea) notes.push(`Requested capacity exceeds available roof area (max ≈ ${byArea.toFixed(0)} kW).`);

    kw = Math.round(kw * 10) / 10;
    const panelWp = i.panel_wp ?? c.panel_wp;
    const panels = Math.ceil((kw * 1000) / panelWp);
    const gen = Math.round(kw * specificYield);
    const saving = Math.round(gen * c.tariff_per_kwh);
    const cost = Math.round(kw * c.cost_per_kwp);
    const y25 = Math.round(gen * Math.pow(1 - c.degradation_pct / 100, 24));
    return {
      recommended_kw: kw, limiting_factor: limiting, panel_count: panels, panel_wp: panelWp,
      annual_generation_kwh: gen, specific_yield_kwh_per_kwp: Math.round(specificYield), monthly_generation_kwh: Math.round(gen / 12),
      est_annual_saving: saving, est_system_cost: cost, payback_years: saving ? Math.round((cost / saving) * 10) / 10 : null,
      required_area_sqm: Math.round(kw * c.area_sqm_per_kwp),
      supporting: { assumptions: c, notes, year_25_generation_kwh: y25 },
    };
  }
}

export function runCalculation(i: CalcInput, leadId: number | null, actor: Actor) {
  const out = SolarCalculationEngine.fromSettings().compute(i);
  getDb().prepare("INSERT INTO solar_calculations (lead_id, inputs, outputs) VALUES (?,?,?)").run(leadId, JSON.stringify(i), JSON.stringify(out));
  if (leadId) logActivity(leadId, "calculation", `Solar calculation run: ${out.recommended_kw} kW recommended (${out.limiting_factor})`, actor);
  return out;
}

/* ───────────── site surveys ───────────── */
const SURVEY_FIELDS = ["site_address", "gps", "site_type", "roof_type", "roof_area_sqm", "available_area_sqm", "orientation", "shading", "obstacles", "structural", "access", "safety", "eb_connection", "sanctioned_load_kw", "monthly_kwh", "annual_kwh", "existing_infra", "notes"] as const;
const NUMERIC = new Set(["roof_area_sqm", "available_area_sqm", "sanctioned_load_kw", "monthly_kwh", "annual_kwh"]);

export function getOrCreateSurvey(leadId: number, actor: Actor): number {
  const db = getDb();
  const ex = db.prepare("SELECT id FROM site_surveys WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as { id: number } | undefined;
  if (ex) return ex.id;
  const visit = db.prepare("SELECT id, pm_id, location FROM site_visits WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const id = Number(db.prepare("INSERT INTO site_surveys (lead_id, visit_id, pm_id, site_address) VALUES (?,?,?,?)").run(leadId, visit?.id ?? null, visit?.pm_id ?? actor.id, visit?.location ?? null).lastInsertRowid);
  return id;
}

export function saveSurvey(surveyId: number, data: Record<string, string>, actor: Actor) {
  const db = getDb();
  const cols = SURVEY_FIELDS.filter((f) => f in data);
  if (!cols.length) return;
  const vals = cols.map((c) => (data[c] === "" ? null : NUMERIC.has(c) ? Number(data[c]) : data[c]));
  db.prepare(`UPDATE site_surveys SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...vals, surveyId);
  // Keep annual and monthly consistent when only one is supplied.
  db.prepare("UPDATE site_surveys SET annual_kwh = monthly_kwh * 12 WHERE id = ? AND annual_kwh IS NULL AND monthly_kwh IS NOT NULL").run(surveyId);
}

export function addMeasurement(surveyId: number, label: string, value: number, unit: string) {
  getDb().prepare("INSERT INTO site_measurements (survey_id, label, value, unit) VALUES (?,?,?,?)").run(surveyId, label, value, unit);
}
export function addPhoto(surveyId: number, category: string, filePath: string, caption: string | null, actor: Actor) {
  const db = getDb();
  db.prepare("INSERT INTO site_photos (survey_id, category, file_path, caption) VALUES (?,?,?,?)").run(surveyId, category, filePath, caption);
  const s = db.prepare("SELECT s.lead_id, l.customer_id FROM site_surveys s JOIN leads l ON l.id = s.lead_id WHERE s.id = ?").get(surveyId) as any;
  db.prepare("INSERT INTO documents (customer_id, lead_id, module, doc_type, name, file_path, uploaded_by) VALUES (?,?,?,?,?,?,?)").run(s.customer_id, s.lead_id, "survey", "Site Survey", caption || `${category} photo`, filePath, actor.id);
}

export function submitSurvey(surveyId: number, actor: Actor) {
  const db = getDb();
  const s = db.prepare("SELECT * FROM site_surveys WHERE id = ?").get(surveyId) as any;
  if (!s) throw new Error("Survey not found");
  if (s.status === "SUBMITTED") return;
  const missing = ["site_address", "roof_type", "available_area_sqm", "eb_connection"].filter((f) => s[f] == null || s[f] === "");
  if (missing.length) throw new Error(`Complete required fields first: ${missing.join(", ")}`);
  db.prepare("UPDATE site_surveys SET status = 'SUBMITTED', submitted_at = ? WHERE id = ?").run(sqlTime(), surveyId);
  if (s.visit_id) db.prepare("UPDATE site_visits SET status = 'COMPLETED' WHERE id = ?").run(s.visit_id);
  const l = db.prepare("SELECT code, title FROM leads WHERE id = ?").get(s.lead_id) as any;
  changeStatus(s.lead_id, "SITE_SURVEY", actor);
  logActivity(s.lead_id, "survey", "Site survey submitted", actor);
  audit(actor, "submitted site survey", "lead", l.code);
  fire("survey.submitted", { lead_id: s.lead_id, survey_id: surveyId, lead_code: l.code, title: l.title, link: `/design` });
}

export function surveyFull(surveyId: number) {
  const db = getDb();
  return {
    survey: db.prepare("SELECT s.*, u.name pm_name FROM site_surveys s LEFT JOIN users u ON u.id = s.pm_id WHERE s.id = ?").get(surveyId) as any,
    measurements: db.prepare("SELECT * FROM site_measurements WHERE survey_id = ? ORDER BY id").all(surveyId) as any[],
    photos: db.prepare("SELECT * FROM site_photos WHERE survey_id = ? ORDER BY id").all(surveyId) as any[],
  };
}

/* ───────────── design ───────────── */
export function createDesignTask(leadId: number, surveyId?: number | null): number {
  const db = getDb();
  const designer = db.prepare(
    `SELECT u.id, u.name FROM users u WHERE u.role = 'designer' AND u.active = 1
     ORDER BY (SELECT COUNT(*) FROM design_tasks t WHERE t.designer_id = u.id AND t.status != 'COMPLETED') ASC, u.id LIMIT 1`
  ).get() as { id: number; name: string } | undefined;
  const id = Number(db.prepare("INSERT INTO design_tasks (lead_id, survey_id, designer_id, due_at) VALUES (?,?,?,?)").run(leadId, surveyId ?? null, designer?.id ?? null, sqlTime(addDays(new Date(), 3))).lastInsertRowid);
  const l = db.prepare("SELECT code, title FROM leads WHERE id = ?").get(leadId) as any;
  changeStatus(leadId, "DESIGN", SYSTEM);
  logActivity(leadId, "design", `Design task created${designer ? ` — assigned to ${designer.name}` : ""}`, SYSTEM);
  if (designer) notify({ userId: designer.id, type: "task_assigned", title: `Design task: ${l.code}`, body: l.title, link: `/design/${id}` });
  return id;
}

export function designTaskFull(taskId: number) {
  const db = getDb();
  const task = db.prepare(
    `SELECT t.*, l.code lead_code, l.title lead_title, l.capacity_kw lead_kw, l.city, l.solar_type, l.vertical, c.name customer_name, u.name designer_name
     FROM design_tasks t JOIN leads l ON l.id = t.lead_id LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN users u ON u.id = t.designer_id WHERE t.id = ?`
  ).get(taskId) as any;
  if (!task) return null;
  const design = db.prepare("SELECT * FROM designs WHERE task_id = ?").get(taskId) as any;
  const boq = design ? (db.prepare("SELECT bi.* FROM boq_items bi JOIN boqs b ON b.id = bi.boq_id WHERE b.design_id = ? ORDER BY bi.id").all(design.id) as any[]) : [];
  return { task, design, boq, survey: task.survey_id ? surveyFull(task.survey_id) : null };
}

export interface BoqRow { category: string; description: string; spec?: string; qty: number; unit: string; unit_cost: number }
export function saveDesign(taskId: number, d: Record<string, any>, boq: BoqRow[], actor: Actor, complete: boolean) {
  const db = getDb();
  const task = db.prepare("SELECT * FROM design_tasks WHERE id = ?").get(taskId) as any;
  if (!task) throw new Error("Design task not found");
  const tx = db.transaction(() => {
    let design = db.prepare("SELECT id FROM designs WHERE task_id = ?").get(taskId) as { id: number } | undefined;
    const vals = [d.capacity_kw ?? null, d.panel_brand ?? null, d.panel_wp ?? null, d.panel_count ?? null, d.inverter_brand ?? null, d.inverter_kw ?? null, d.inverter_count ?? null, d.structure ?? null, d.est_annual_kwh ?? null, d.tech_notes ?? null];
    if (design) {
      db.prepare("UPDATE designs SET capacity_kw=?, panel_brand=?, panel_wp=?, panel_count=?, inverter_brand=?, inverter_kw=?, inverter_count=?, structure=?, est_annual_kwh=?, tech_notes=?, updated_at=? WHERE id=?").run(...vals, sqlTime(), design.id);
    } else {
      design = { id: Number(db.prepare("INSERT INTO designs (task_id, lead_id, capacity_kw, panel_brand, panel_wp, panel_count, inverter_brand, inverter_kw, inverter_count, structure, est_annual_kwh, tech_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(taskId, task.lead_id, ...vals).lastInsertRowid) };
    }
    let boqRow = db.prepare("SELECT id FROM boqs WHERE design_id = ?").get(design.id) as { id: number } | undefined;
    if (!boqRow) boqRow = { id: Number(db.prepare("INSERT INTO boqs (design_id, lead_id) VALUES (?,?)").run(design.id, task.lead_id).lastInsertRowid) };
    db.prepare("DELETE FROM boq_items WHERE boq_id = ?").run(boqRow.id);
    const ins = db.prepare("INSERT INTO boq_items (boq_id, category, description, spec, qty, unit, unit_cost) VALUES (?,?,?,?,?,?,?)");
    boq.filter((r) => r.description && r.qty > 0).forEach((r) => ins.run(boqRow!.id, r.category, r.description, r.spec ?? null, r.qty, r.unit || "nos", r.unit_cost || 0));
    if (complete) {
      db.prepare("UPDATE designs SET status = 'COMPLETED' WHERE id = ?").run(design.id);
      db.prepare("UPDATE design_tasks SET status = 'COMPLETED' WHERE id = ?").run(taskId);
    } else {
      db.prepare("UPDATE design_tasks SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'PENDING'").run(taskId);
    }
  });
  tx();
  const l = db.prepare("SELECT code, title, owner_id FROM leads WHERE id = ?").get(task.lead_id) as any;
  audit(actor, complete ? "completed design" : "saved design draft", "lead", l.code);
  if (complete) {
    logActivity(task.lead_id, "design", "Design & BOQ completed — ready for proposal", actor);
    notify({ userId: l.owner_id, role: "sales", type: "design_ready", title: `Design ready: ${l.code}`, body: "Generate the proposal.", link: `/crm/leads/${task.lead_id}` });
    fire("design.completed", { lead_id: task.lead_id, lead_code: l.code, owner_id: l.owner_id, link: `/crm/leads/${task.lead_id}` });
  }
}

export const designTasks = () =>
  getDb().prepare(
    `SELECT t.*, l.code lead_code, l.title lead_title, l.capacity_kw, l.city, u.name designer_name
     FROM design_tasks t JOIN leads l ON l.id = t.lead_id LEFT JOIN users u ON u.id = t.designer_id ORDER BY t.status = 'COMPLETED', t.due_at`
  ).all() as any[];

export { usersByRole, userName };
