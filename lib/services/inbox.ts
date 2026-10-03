// InboundMessageService + AI review queue. Every external message is stored first and never discarded.
import { getDb, getSetting, setSetting } from "../db";
import { ai, type InboundInput, type LeadExtraction } from "../providers";
import { audit, notify, type Actor } from "./core";
import { createLead, findDuplicates, logActivity, type LeadInput, type DupMatch } from "./leads";

export const REVIEW_THRESHOLD = 0.75;
const SOURCE_MAP: Record<string, string> = { telegram: "telegram", google_chat: "google_chat", email: "email", website: "website", voice: "voice", manual: "manual", upload: "manual" };

export function ingest(input: InboundInput, actor: Actor): { id: number; duplicate: boolean; status: string } {
  const db = getDb();
  if (input.external_id) {
    const ex = db.prepare("SELECT id, processing_status FROM inbound_messages WHERE source = ? AND external_id = ?").get(input.source, input.external_id) as any;
    if (ex) return { id: ex.id, duplicate: true, status: ex.processing_status }; // webhook retries are idempotent
  }
  const id = Number(
    db.prepare("INSERT INTO inbound_messages (source, external_id, sender, subject, body, raw_data) VALUES (?,?,?,?,?,?)")
      .run(input.source, input.external_id ?? null, input.sender ?? null, input.subject ?? null, input.body, input.raw ? JSON.stringify(input.raw) : null).lastInsertRowid
  );
  const status = process(id);
  return { id, duplicate: false, status };
}

export function process(id: number): string {
  const db = getDb();
  const m = db.prepare("SELECT * FROM inbound_messages WHERE id = ?").get(id) as any;
  const ex = ai.extractLead(m.body);
  const isLead = !!ex.fields.intent || !!ex.fields.capacity_kw;
  db.prepare("INSERT INTO ai_extractions (message_id, kind, fields, confidence, provider) VALUES (?,?,?,?,?)").run(id, "lead", JSON.stringify(ex), ex.confidence, ai.name);
  let status: string;
  if (!isLead) status = "NOT_A_LEAD";
  else if (ex.confidence < REVIEW_THRESHOLD || ex.ambiguities.length) {
    status = "REVIEW";
    const ins = db.prepare("INSERT INTO ai_reviews (message_id, field, ai_value, status) VALUES (?,?,?,'OPEN')");
    if (ex.ambiguities.length) ex.ambiguities.forEach((a) => ins.run(id, a.field, null));
    else ins.run(id, "confidence", `${Math.round(ex.confidence * 100)}%`);
    notify({ role: "sales", type: "ai_review", title: "AI review required", body: `Inbound ${m.source} message needs a human check (${Math.round(ex.confidence * 100)}% confidence)`, link: "/ai-inbox" });
  } else status = "READY";

  db.prepare("UPDATE inbound_messages SET processing_status = ?, ai_result = ?, confidence = ? WHERE id = ?").run(status, JSON.stringify(ex), ex.confidence, id);

  if (status === "READY" && getSetting("ai_auto_create", false) && ex.confidence >= 0.9 && findDuplicates(toLeadInput(ex, m.source)).length === 0) {
    createFromMessage(id, {}, { id: null, name: "AI auto-capture" });
    return "LEAD_CREATED";
  }
  return status;
}

export function toLeadInput(ex: LeadExtraction, source: string): LeadInput {
  const f = ex.fields;
  return { company: f.company, contact: f.contact, phone: f.phone, email: f.email, vertical: f.vertical, location: f.location, capacity_kw: f.capacity_kw, solar_type: f.solar_type, source: SOURCE_MAP[source] ?? "manual" };
}

export function duplicatesFor(id: number, overrides: Partial<LeadInput> = {}): DupMatch[] {
  const m = getDb().prepare("SELECT * FROM inbound_messages WHERE id = ?").get(id) as any;
  const ex = JSON.parse(m.ai_result ?? "null") as LeadExtraction | null;
  if (!ex) return [];
  return findDuplicates({ ...toLeadInput(ex, m.source), ...overrides });
}

/** Human-confirmed creation. Corrections are stored, and vertical corrections teach the extractor. */
export function createFromMessage(id: number, overrides: Partial<LeadInput>, actor: Actor, useExistingLeadId?: number): { lead_id: number; code: string; merged: boolean } {
  const db = getDb();
  const m = db.prepare("SELECT * FROM inbound_messages WHERE id = ?").get(id) as any;
  if (!m) throw new Error("Message not found");
  if (m.linked_entity) throw new Error("Already converted");
  const ex = JSON.parse(m.ai_result) as LeadExtraction;
  const base = toLeadInput(ex, m.source);
  const final: LeadInput = { ...base, ...cleanOverrides(overrides), inbound_message_id: id, notes: `via ${m.source}${m.sender ? ` (${m.sender})` : ""}` };

  // record corrections
  const rev = db.prepare("INSERT INTO ai_reviews (message_id, field, ai_value, human_value, status, reviewer_id) VALUES (?,?,?,?, 'RESOLVED', ?)");
  for (const k of Object.keys(cleanOverrides(overrides)) as (keyof LeadInput)[]) {
    const aiV = (base as any)[k];
    const hv = (final as any)[k];
    if (String(aiV ?? "") !== String(hv ?? "")) rev.run(id, k, aiV == null ? null : String(aiV), hv == null ? null : String(hv), actor.id);
  }
  db.prepare("UPDATE ai_reviews SET status = 'RESOLVED', reviewer_id = ? WHERE message_id = ? AND status = 'OPEN'").run(actor.id, id);
  if (overrides.vertical && !base.vertical && ex.ambiguities.some((a) => a.field === "vertical")) {
    const kw = m.body.toLowerCase().match(/college|university|educational|institute|institution|trust|academy/)?.[0];
    if (kw) setSetting("ai_learned", { ...getSetting<Record<string, string>>("ai_learned", {}), [kw]: overrides.vertical });
  }

  let leadId: number, code: string, merged = false;
  if (useExistingLeadId) {
    const l = db.prepare("SELECT id, code FROM leads WHERE id = ?").get(useExistingLeadId) as any;
    leadId = l.id; code = l.code; merged = true;
    logActivity(leadId, "message", `New ${m.source} message merged into this lead: "${m.body.slice(0, 140)}"`, actor);
  } else {
    const r = createLead(final, actor);
    leadId = r.id; code = r.code;
  }
  db.prepare("UPDATE inbound_messages SET processing_status = 'LEAD_CREATED', linked_entity = ? WHERE id = ?").run(`lead:${code}`, id);
  audit(actor, merged ? "merged inbound message" : "created lead from inbound message", "inbound_message", id, undefined, code);
  return { lead_id: leadId, code, merged };
}

function cleanOverrides(o: Partial<LeadInput>): Partial<LeadInput> {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== null) out[k] = k === "capacity_kw" ? Number(v) : v;
  return out;
}

export function ignoreMessage(id: number, actor: Actor) {
  getDb().prepare("UPDATE inbound_messages SET processing_status = 'IGNORED' WHERE id = ?").run(id);
  getDb().prepare("UPDATE ai_reviews SET status = 'DISMISSED' WHERE message_id = ? AND status = 'OPEN'").run(id);
  audit(actor, "ignored inbound message", "inbound_message", id);
}
export function reprocess(id: number, actor: Actor) {
  getDb().prepare("UPDATE ai_reviews SET status = 'DISMISSED' WHERE message_id = ? AND status = 'OPEN'").run(id);
  const s = process(id);
  audit(actor, "reprocessed inbound message", "inbound_message", id, undefined, s);
  return s;
}

export function listInbox(filter?: string) {
  const w = filter && filter !== "ALL" ? "WHERE processing_status = ?" : "";
  const rows = getDb().prepare(`SELECT * FROM inbound_messages ${w} ORDER BY id DESC LIMIT 100`).all(...(w ? [filter] : [])) as any[];
  return rows.map((r) => ({ ...r, extraction: r.ai_result ? (JSON.parse(r.ai_result) as LeadExtraction) : null }));
}
export const inboxCounts = () =>
  Object.fromEntries((getDb().prepare("SELECT processing_status s, COUNT(*) c FROM inbound_messages GROUP BY processing_status").all() as any[]).map((r) => [r.s, r.c])) as Record<string, number>;
export const learned = () => getSetting<Record<string, string>>("ai_learned", {});
