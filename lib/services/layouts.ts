// Preliminary plan layouts: create from a lead (pre-filled from the site file), edit, issue revisions.
import { getDb, nextCode, settings } from "../db";
import { audit, type Actor } from "./core";
import { logActivity } from "./leads";
import { defaultDrawing, presetFor, type Drawing, type Sheet } from "../layout-geom";
import { siteFile } from "./handoff";
import { storage } from "../providers";

const COMPANY = { name: "Viryasys Technologies", address: "First Floor, UMA Courtyard, 15, Harrington Rd, Chetpet, Chennai, Tamil Nadu, 600031" };
const IMG = /\.(png|jpe?g|webp|gif)$/i;

export function createLayout(leadId: number, actor: Actor): { id: number; code: string } {
  const db = getDb();
  const f = siteFile(leadId);
  if (!f) throw new Error("Lead not found");
  const sv = f.survey?.survey, ex = f.details.extras ?? {};
  const wp = settings().calc.panel_wp;
  const preset = presetFor(wp);
  const roofW = Number(ex.roof_length_m) > 0 ? Number(ex.roof_length_m) * 1000 : undefined, roofH = Number(ex.roof_width_m) > 0 ? Number(ex.roof_width_m) * 1000 : undefined;
  const kw = f.lead.capacity_kw ?? 0;
  const modules = kw > 0 && kw <= 60 ? Math.ceil((kw * 1000) / wp) : undefined; // only pre-fill small systems; large ones are placed by hand
  const { drawing } = defaultDrawing({ roofW, roofH, roofType: sv?.roof_type ?? undefined, wp, modules });
  const org = db.prepare("SELECT * FROM organizations LIMIT 1").get() as any;
  const me = db.prepare("SELECT name FROM users WHERE id = ?").get(actor.id) as any;
  const existing = (db.prepare("SELECT COUNT(*) c FROM layouts WHERE lead_id = ?").get(leadId) as any).c as number;
  const sheet: Sheet = {
    title: "PRELIMINARY PLAN LAYOUT", customer_name: f.lead.customer_name ?? f.lead.title, address: sv?.site_address || f.lead.city || "", coordinates: sv?.gps || "", prn: f.lead.code,
    designed_by: me?.name ?? actor.name, approved_by: "", scale: "NTS", paper: "A4", rev: "A", date: new Date().toLocaleDateString("en-GB").replaceAll("/", "/"), sheet_no: `PP-${String(existing + 1).padStart(2, "0")}`,
    module_wp: wp, module_w: preset.w, module_h: preset.h, inverter_text: kw ? `${kw <= 60 ? Math.round(kw * 1000) + "W" : kw + "KW"} INVERTER` : "", roof_type: (sv?.roof_type ?? "").toUpperCase(), mounting: "FLUSH MOUNT",
    company_name: org?.name ?? COMPANY.name, company_address: COMPANY.address,
  };
  const img = f.files.find((x) => x.image);
  const code = nextCode("LAY", db);
  const proj = db.prepare("SELECT id FROM projects WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const id = Number(db.prepare("INSERT INTO layouts (code, lead_id, project_id, title, sheet, drawing, aerial_path, created_by) VALUES (?,?,?,?,?,?,?,?)").run(code, leadId, proj?.id ?? null, `${sheet.customer_name} — preliminary layout`, JSON.stringify(sheet), JSON.stringify(drawing), img?.path ?? null, actor.id).lastInsertRowid);
  logActivity(leadId, "design", `Preliminary layout ${code} started`, actor);
  audit(actor, "created layout", "layout", code);
  return { id, code };
}

export function getLayout(id: number) {
  const db = getDb();
  const l = db.prepare("SELECT l.*, ld.code lead_code, p.code project_code, u.name creator FROM layouts l LEFT JOIN leads ld ON ld.id = l.lead_id LEFT JOIN projects p ON p.id = l.project_id LEFT JOIN users u ON u.id = l.created_by WHERE l.id = ?").get(id) as any;
  if (!l) return null;
  const images = l.lead_id ? (siteFile(l.lead_id)?.files ?? []).filter((x) => x.image) : [];
  const revisions = db.prepare("SELECT r.id, r.rev, r.issued_at, u.name by_name FROM layout_revisions r LEFT JOIN users u ON u.id = r.issued_by WHERE r.layout_id = ? ORDER BY r.id DESC").all(id) as any[];
  const proposal = l.lead_id ? (db.prepare("SELECT id, code FROM proposals WHERE lead_id = ? AND status != 'REJECTED' ORDER BY id DESC LIMIT 1").get(l.lead_id) as any) : null;
  return { ...l, sheet: JSON.parse(l.sheet) as Sheet, drawing: JSON.parse(l.drawing) as Drawing, images, revisions, proposal };
}

export function listLayouts() {
  return getDb().prepare("SELECT l.id, l.code, l.title, l.rev, l.status, l.updated_at, ld.code lead_code, p.code project_code, u.name creator, json_extract(l.sheet,'$.sheet_no') sheet_no FROM layouts l LEFT JOIN leads ld ON ld.id = l.lead_id LEFT JOIN projects p ON p.id = l.project_id LEFT JOIN users u ON u.id = l.created_by ORDER BY l.updated_at DESC, l.id DESC").all() as any[];
}

/** Create (or reuse) a layout for a project, using its lead's site file. */
export function createLayoutForProject(projectId: number, actor: Actor): { id: number; code: string } {
  const db = getDb();
  const p = db.prepare("SELECT lead_id FROM projects WHERE id = ?").get(projectId) as any;
  if (!p) throw new Error("Project not found");
  const existing = db.prepare("SELECT id, code FROM layouts WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(projectId) as any;
  if (existing) return existing;
  if (!p.lead_id) throw new Error("This project has no linked lead — nothing to pre-fill the layout from");
  return createLayout(p.lead_id, actor);
}

const nextRev = (r: string) => String.fromCharCode(Math.min(90, (r.charCodeAt(0) || 64) + 1));

/** Save edits. Editing an issued layout starts the next revision letter. */
export function saveLayout(id: number, sheet: Sheet, drawing: Drawing, actor: Actor) {
  const db = getDb();
  const l = db.prepare("SELECT code, rev, status, lead_id FROM layouts WHERE id = ?").get(id) as any;
  if (!l) throw new Error("Layout not found");
  if (!Array.isArray(drawing.roofs) || !Array.isArray(drawing.arrays)) throw new Error("Invalid drawing");
  let rev = l.rev;
  if (l.status === "ISSUED") rev = nextRev(l.rev);
  sheet.rev = rev;
  db.prepare("UPDATE layouts SET sheet = ?, drawing = ?, title = ?, rev = ?, status = 'DRAFT', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(sheet), JSON.stringify(drawing), `${sheet.customer_name} — preliminary layout`, rev, id);
  audit(actor, "saved layout", "layout", l.code);
  return rev as string;
}

export function issueLayout(id: number, actor: Actor) {
  const db = getDb();
  const l = db.prepare("SELECT * FROM layouts WHERE id = ?").get(id) as any;
  if (!l) throw new Error("Layout not found");
  if (l.status === "ISSUED") throw new Error(`Rev ${l.rev} is already issued`);
  db.prepare("INSERT INTO layout_revisions (layout_id, rev, sheet, drawing, aerial_path, issued_by) VALUES (?,?,?,?,?,?)").run(id, l.rev, l.sheet, l.drawing, l.aerial_path, actor.id);
  db.prepare("UPDATE layouts SET status = 'ISSUED', updated_at = datetime('now') WHERE id = ?").run(id);
  if (l.lead_id) logActivity(l.lead_id, "design", `Preliminary layout ${l.code} Rev ${l.rev} issued`, actor);
  audit(actor, "issued layout", "layout", l.code, undefined, `Rev ${l.rev}`);
}

export async function setAerial(id: number, opts: { path?: string; file?: File }, actor: Actor) {
  const db = getDb();
  const l = db.prepare("SELECT code, lead_id FROM layouts WHERE id = ?").get(id) as any;
  if (!l) throw new Error("Layout not found");
  let path = opts.path ?? null;
  if (opts.file) {
    if (!IMG.test(opts.file.name)) throw new Error("Aerial image must be PNG, JPG or WebP");
    if (opts.file.size > 10 * 1024 * 1024) throw new Error("Image too large (max 10 MB)");
    path = await storage.put(`layouts/${id}`, opts.file.name, Buffer.from(await opts.file.arrayBuffer()));
  }
  if (!path) throw new Error("Choose an image");
  db.prepare("UPDATE layouts SET aerial_path = ?, updated_at = datetime('now') WHERE id = ?").run(path, id);
  audit(actor, "set layout aerial image", "layout", l.code);
}

/** Export the sheet as a plan view on the lead's proposal (customer email says a plan view is attached). */
export async function attachToProposal(id: number, png: File, actor: Actor) {
  const l = getDb().prepare("SELECT code, lead_id FROM layouts WHERE id = ?").get(id) as any;
  if (!l?.lead_id) throw new Error("This layout isn't linked to a lead");
  const p = getDb().prepare("SELECT id, code FROM proposals WHERE lead_id = ? AND status != 'REJECTED' ORDER BY id DESC LIMIT 1").get(l.lead_id) as any;
  if (!p) throw new Error("There's no proposal for this lead yet — generate the proposal first");
  const { uploadDocument } = await import("./misc");
  await uploadDocument({ lead_id: l.lead_id, doc_type: "Plan view", module: "proposal", file: png, customer_visible: true }, actor);
  audit(actor, "attached layout to proposal", "layout", l.code, undefined, p.code);
  return p.code as string;
}
