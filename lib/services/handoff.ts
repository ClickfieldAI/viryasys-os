// Site file (everything collected about a lead's site) + hand-off to the designer.
import { getDb } from "../db";
import { addDays, sqlTime } from "../util";
import { audit, notify, type Actor } from "./core";
import { changeStatus, logActivity } from "./leads";
import { surveyFull } from "./design";

const IMG = /\.(png|jpe?g|webp|gif|heic)$/i;
export interface SiteDetails { extras?: Record<string, string>; obstacles?: { desc: string; l: string; w: string; h: string; note: string }[] }
const COLS = ["site_address", "gps", "site_type", "roof_type", "roof_area_sqm", "available_area_sqm", "orientation", "shading", "obstacles", "structural", "access", "safety", "eb_connection", "sanctioned_load_kw", "monthly_kwh", "annual_kwh", "existing_infra", "notes"];
const NUM = new Set(["roof_area_sqm", "available_area_sqm", "sanctioned_load_kw", "monthly_kwh", "annual_kwh"]);
export interface Attachment { kind: "photo" | "doc"; id: number; name: string; path: string; image: boolean }

/** Everything gathered so far for this lead: qualification, visits, survey inputs, measurements, photos, documents. */
export function siteFile(leadId: number) {
  const db = getDb();
  const lead = db.prepare("SELECT l.*, c.name customer_name, ct.name contact_name, ct.phone contact_phone, ct.email contact_email FROM leads l LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN contacts ct ON ct.id = l.contact_id WHERE l.id = ?").get(leadId) as any;
  if (!lead) return null;
  const visits = db.prepare("SELECT v.*, p.name pm, d.name designer FROM site_visits v LEFT JOIN users p ON p.id = v.pm_id LEFT JOIN users d ON d.id = v.designer_id WHERE lead_id = ? ORDER BY v.id").all(leadId) as any[];
  const sv = db.prepare("SELECT id FROM site_surveys WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const survey = sv ? surveyFull(sv.id) : null;
  const docs = db.prepare("SELECT d.*, u.name by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.lead_id = ? AND d.file_path IS NOT NULL ORDER BY d.id DESC").all(leadId) as any[];
  const photos = (survey?.photos ?? []).filter((p: any) => p.file_path);
  const files: Attachment[] = [
    ...photos.map((p: any) => ({ kind: "photo" as const, id: p.id, name: p.caption || `${p.category} photo`, path: p.file_path, image: true })),
    ...docs.filter((d) => !photos.some((p: any) => p.file_path === d.file_path)).map((d) => ({ kind: "doc" as const, id: d.id, name: d.name, path: d.file_path, image: IMG.test(d.name) || IMG.test(d.file_path) })),
  ];
  const notes = db.prepare("SELECT a.*, u.name uname FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? AND a.type = 'site_note' ORDER BY a.id DESC").all(leadId) as any[];
  const handoffs = db.prepare("SELECT h.*, d.name designer, u.name sender FROM design_handoffs h LEFT JOIN users d ON d.id = h.designer_id LEFT JOIN users u ON u.id = h.sent_by WHERE h.lead_id = ? ORDER BY h.id DESC").all(leadId) as any[];
  const details = survey?.survey?.details ? (JSON.parse(survey.survey.details) as SiteDetails) : ({} as SiteDetails);
  return { details, lead, qualification: lead.qualification ? (JSON.parse(lead.qualification) as Record<string, string>) : {}, visits, survey, files, notes, handoffs };
}

export function designers() {
  return getDb().prepare(`SELECT u.id, u.name, (SELECT COUNT(*) FROM design_tasks t WHERE t.designer_id = u.id AND t.status != 'COMPLETED') open FROM users u WHERE u.role = 'designer' AND u.active = 1 ORDER BY u.name`).all() as { id: number; name: string; open: number }[];
}

export function addSiteNote(leadId: number, note: string, actor: Actor) {
  if (!note.trim()) throw new Error("Write the note first");
  const l = getDb().prepare("SELECT code FROM leads WHERE id = ?").get(leadId) as any;
  if (!l) throw new Error("Lead not found");
  logActivity(leadId, "site_note", note.trim(), actor);
  audit(actor, "added site note", "lead", l.code);
}

/** Snapshot the site file, attach the chosen photos/documents, and hand the whole package to a designer. */
export function sendToDesigner(leadId: number, designerId: number, message: string, picks: string[], actor: Actor) {
  const db = getDb();
  const f = siteFile(leadId);
  if (!f) throw new Error("Lead not found");
  const designer = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'designer' AND active = 1").get(designerId) as any;
  if (!designer) throw new Error("Choose a designer");
  const chosen = f.files.filter((x) => picks.includes(`${x.kind === "photo" ? "p" : "d"}:${x.id}`));
  const survey = f.survey?.survey;
  const snapshot = {
    lead: { code: f.lead.code, customer: f.lead.customer_name, contact: [f.lead.contact_name, f.lead.contact_phone].filter(Boolean).join(" · "), city: f.lead.city, capacity_kw: f.lead.capacity_kw, solar_type: f.lead.solar_type, vertical: f.lead.vertical, est_value: f.lead.est_value },
    qualification: f.qualification,
    visits: f.visits.map((v) => ({ when: v.scheduled_at, location: v.location, contact: v.contact, status: v.status, pm: v.pm })),
    details: f.details,
    survey: survey ? Object.fromEntries(["site_address", "site_type", "roof_type", "roof_area_sqm", "available_area_sqm", "orientation", "shading", "obstacles", "structural", "access", "safety", "eb_connection", "sanctioned_load_kw", "monthly_kwh", "annual_kwh", "existing_infra", "notes"].filter((k) => survey[k] != null && survey[k] !== "").map((k) => [k, survey[k]])) : null,
    measurements: (f.survey?.measurements ?? []).map((m: any) => ({ label: m.label, value: m.value, unit: m.unit })),
    site_notes: f.notes.map((n) => ({ at: n.created_at, by: n.uname, note: n.summary })),
  };
  let task = db.prepare("SELECT * FROM design_tasks WHERE lead_id = ? AND status != 'COMPLETED' ORDER BY id DESC LIMIT 1").get(leadId) as any;
  if (task) {
    db.prepare("UPDATE design_tasks SET designer_id = ?, survey_id = COALESCE(survey_id, ?) WHERE id = ?").run(designer.id, survey?.id ?? null, task.id);
  } else {
    const id = Number(db.prepare("INSERT INTO design_tasks (lead_id, survey_id, designer_id, due_at) VALUES (?,?,?,?)").run(leadId, survey?.id ?? null, designer.id, sqlTime(addDays(new Date(), 3))).lastInsertRowid);
    task = { id };
    if (["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT", "SITE_SURVEY"].includes(f.lead.status)) changeStatus(leadId, "DESIGN", actor);
  }
  db.prepare("INSERT INTO design_handoffs (lead_id, task_id, designer_id, message, snapshot, attachments, sent_by) VALUES (?,?,?,?,?,?,?)").run(leadId, task.id, designer.id, message.trim() || null, JSON.stringify(snapshot), JSON.stringify(chosen), actor.id);
  logActivity(leadId, "design", `Site information sent to designer ${designer.name} (${chosen.length} file${chosen.length === 1 ? "" : "s"})`, actor);
  audit(actor, "sent site file to designer", "lead", f.lead.code, undefined, designer.name);
  notify({ userId: designer.id, type: "task_assigned", title: `Site information received — ${f.lead.code}`, body: `${f.lead.customer_name}${message.trim() ? ` · ${message.trim().slice(0, 90)}` : ""}`, link: `/design/${task.id}` });
  return { task_id: task.id as number, files: chosen.length };
}

export function handoffsForLead(leadId: number) {
  return (getDb().prepare("SELECT h.*, u.name sender FROM design_handoffs h LEFT JOIN users u ON u.id = h.sent_by WHERE h.lead_id = ? ORDER BY h.id DESC").all(leadId) as any[]).map((h) => ({ ...h, snapshot: JSON.parse(h.snapshot), attachments: JSON.parse(h.attachments) as Attachment[] }));
}


/** Record everything measured/observed on site. Creates the survey (draft) if there isn't one yet. */
export function saveSiteInputs(leadId: number, d: { fields: Record<string, string>; extras: Record<string, string>; obstacles: { desc: string; l: string; w: string; h: string; note: string }[]; measurements: { label: string; value: number; unit: string }[] }, actor: Actor) {
  const db = getDb();
  const l = db.prepare("SELECT code, city FROM leads WHERE id = ?").get(leadId) as any;
  if (!l) throw new Error("Lead not found");
  let sv = db.prepare("SELECT id FROM site_surveys WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  if (!sv) {
    const visit = db.prepare("SELECT id, pm_id FROM site_visits WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
    sv = { id: Number(db.prepare("INSERT INTO site_surveys (lead_id, visit_id, pm_id, site_address) VALUES (?,?,?,?)").run(leadId, visit?.id ?? null, visit?.pm_id ?? null, l.city ?? null).lastInsertRowid) };
  }
  const cols = COLS.filter((c) => c in d.fields);
  const vals = cols.map((c) => { const v = (d.fields[c] ?? "").trim(); if (v === "") return null; if (NUM.has(c)) { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${c.replaceAll("_", " ")} must be a positive number`); return n; } return v; });
  const details: SiteDetails = {
    extras: Object.fromEntries(Object.entries(d.extras).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v !== "")),
    obstacles: d.obstacles.filter((o) => o.desc.trim() || o.l || o.w || o.h),
  };
  db.transaction(() => {
    if (cols.length) db.prepare(`UPDATE site_surveys SET ${cols.map((c) => `${c} = ?`).join(", ")}, details = ? WHERE id = ?`).run(...vals, JSON.stringify(details), sv.id);
    else db.prepare("UPDATE site_surveys SET details = ? WHERE id = ?").run(JSON.stringify(details), sv.id);
    db.prepare("UPDATE site_surveys SET annual_kwh = monthly_kwh * 12 WHERE id = ? AND annual_kwh IS NULL AND monthly_kwh IS NOT NULL").run(sv.id);
    db.prepare("DELETE FROM site_measurements WHERE survey_id = ?").run(sv.id);
    const ins = db.prepare("INSERT INTO site_measurements (survey_id, label, value, unit) VALUES (?,?,?,?)");
    for (const m of d.measurements) if (m.label.trim() && Number.isFinite(m.value)) ins.run(sv.id, m.label.trim(), m.value, m.unit || "m");
  })();
  logActivity(leadId, "site_note", "Site details updated", actor);
  audit(actor, "updated site details", "lead", l.code);
  return sv.id as number;
}
