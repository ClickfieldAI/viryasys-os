// Provider abstractions. Swap the adapter, not the callers.
// Every adapter here is a development adapter: it normalises payloads in the exact shape the
// real provider sends, so wiring the live service later is a change in this file only.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { getSetting } from "../db";

export interface InboundInput {
  source: "telegram" | "google_chat" | "email" | "website" | "voice" | "manual" | "upload";
  external_id?: string;
  sender?: string;
  subject?: string;
  body: string;
  raw?: unknown;
}

/* ───────────── Channel providers (inbound normalisation) ───────────── */
export interface ChannelProvider {
  name: string;
  /** Turn the provider's webhook payload into a normalised inbound message (null = ignore). */
  parseWebhook(payload: any): InboundInput | null;
  /** Verify the webhook came from the provider. */
  verify(headers: Headers, secret: string): boolean;
}

const safeEq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

export const TelegramProvider: ChannelProvider = {
  name: "telegram",
  // Telegram's setWebhook secret_token arrives in this header.
  verify: (h, secret) => safeEq(h.get("x-telegram-bot-api-secret-token") ?? "", secret),
  parseWebhook(u) {
    const m = u?.message ?? u?.channel_post;
    if (!m?.text) return null;
    return {
      source: "telegram",
      external_id: `${m.chat?.id}:${m.message_id}`,
      sender: m.from?.username ? `@${m.from.username}` : [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || "Telegram user",
      body: m.text,
      raw: u,
    };
  },
};

export const GoogleChatProvider: ChannelProvider = {
  name: "google_chat",
  verify: (h, secret) => safeEq(h.get("x-vos-webhook-secret") ?? "", secret),
  parseWebhook(e) {
    const m = e?.message;
    if (!m?.text) return null;
    return { source: "google_chat", external_id: m.name, sender: m.sender?.displayName ?? "Google Chat", subject: e?.space?.displayName, body: m.argumentText ?? m.text, raw: e };
  },
};

export const WebsiteFormProvider: ChannelProvider = {
  name: "website",
  verify: (h, secret) => safeEq(h.get("x-vos-webhook-secret") ?? "", secret),
  parseWebhook(f) {
    if (!f) return null;
    const body = [
      f.message,
      f.company && `Company: ${f.company}`,
      f.name && `Contact ${f.name}`,
      f.phone && `Phone ${f.phone}`,
      f.email && `Email ${f.email}`,
      f.city && `Location ${f.city}`,
      f.capacity && `Capacity ${f.capacity}`,
    ].filter(Boolean).join("\n");
    return body ? { source: "website", external_id: f.submission_id, sender: f.email || f.name, subject: "Website enquiry", body, raw: f } : null;
  },
};

export interface EmailProvider {
  name: string;
  /** Fetch new inbound mails. Dev adapter returns none; Gmail adapter would call users.messages.list. */
  poll(): Promise<InboundInput[]>;
  /** Prepare (never auto-send) an outbound email. */
  prepare(to: string, subject: string, body: string, attachments?: string[]): { to: string; subject: string; body: string; attachments: string[]; mailto: string };
}
export const GmailProvider: EmailProvider = {
  name: "gmail-dev",
  async poll() { return []; },
  prepare(to, subject, body, attachments = []) {
    return { to, subject, body, attachments, mailto: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
  },
};

/** Outbound SMTP. Configure SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM (Gmail/Workspace app password works). */
export interface OutboundMail { to: string; cc?: string; subject: string; text: string; attachments: { filename: string; content: Buffer }[] }
export const Smtp = {
  configured: () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  from: (name: string) => `${name} <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
  async send(m: OutboundMail, fromName: string): Promise<{ messageId: string }> {
    const port = Number(process.env.SMTP_PORT || 465);
    const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    const r = await t.sendMail({ from: Smtp.from(fromName), to: m.to, cc: m.cc || undefined, subject: m.subject, text: m.text, attachments: m.attachments });
    return { messageId: r.messageId };
  },
};

/** Accounting sync. Pushes a neutral event to ZOHO_SYNC_ENDPOINT (bearer ZOHO_TOKEN). It never invents ledger mappings:
 *  the receiving side (accountant-approved workflow) decides debits/credits. ZOHO_SIMULATE=1 fakes success for demos. */
export const ZohoBooks = {
  configured: () => !!process.env.ZOHO_SYNC_ENDPOINT || process.env.ZOHO_SIMULATE === "1",
  simulated: () => process.env.ZOHO_SIMULATE === "1",
  async push(event: { id: number; event_type: string; ref: string | null; payload: unknown }): Promise<{ externalId: string }> {
    if (process.env.ZOHO_SIMULATE === "1") return { externalId: `SIM-${event.id}` };
    const url = process.env.ZOHO_SYNC_ENDPOINT;
    if (!url) throw new Error("Zoho Books integration is not configured (set ZOHO_SYNC_ENDPOINT)");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", ...(process.env.ZOHO_TOKEN ? { authorization: `Bearer ${process.env.ZOHO_TOKEN}` } : {}) }, body: JSON.stringify(event) });
      if (!r.ok) throw new Error(`Zoho endpoint returned ${r.status}`);
      const j: any = await r.json().catch(() => ({}));
      return { externalId: String(j.id ?? j.external_id ?? event.id) };
    } catch (e: any) {
      throw new Error(e?.name === "AbortError" ? "API timeout" : e.message);
    } finally { clearTimeout(t); }
  },
};

export const CHANNELS: Record<string, ChannelProvider> = { telegram: TelegramProvider, google_chat: GoogleChatProvider, website: WebsiteFormProvider };

/* ───────────── Storage ───────────── */
export interface StorageProvider {
  put(folder: string, filename: string, data: Buffer): Promise<string>;
  get(relPath: string): Promise<Buffer | null>;
}
const UPLOAD_ROOT = () => path.join(process.cwd(), "data", "uploads");
export const LocalStorage: StorageProvider = {
  async put(folder, filename, data) {
    const safe = filename.replace(/[^\w.\-]+/g, "_");
    const rel = path.posix.join(folder.replace(/[^\w/\-]/g, ""), `${Date.now()}-${safe}`);
    const abs = path.join(UPLOAD_ROOT(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    return rel;
  },
  async get(rel) {
    const abs = path.resolve(UPLOAD_ROOT(), rel);
    if (!abs.startsWith(UPLOAD_ROOT() + path.sep)) return null; // path traversal guard
    return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  },
};
export const storage: StorageProvider = LocalStorage;

/* ───────────── AI ───────────── */
export interface LeadExtraction {
  fields: {
    company: string | null; contact: string | null; phone: string | null; email: string | null;
    vertical: string | null; location: string | null; capacity_kw: number | null; solar_type: string | null; intent: string | null;
  };
  field_confidence: Record<string, number>;
  confidence: number;
  ambiguities: { field: string; reason: string; options: string[] }[];
}
export interface AIProvider {
  name: string;
  extractLead(text: string): LeadExtraction;
  summarizeCall(q: Record<string, string>): { summary: string; recommendation: "QUALIFIED" | "NURTURE" | "DISQUALIFIED" };
  extractEbBill(text: string): { units_kwh: number | null; amount: number | null; sanctioned_load_kw: number | null; confidence: number };
}

const TN_CITIES = ["Chennai", "Coimbatore", "Madurai", "Hosur", "Trichy", "Tiruchirappalli", "Salem", "Tirupur", "Erode", "Chengalpattu", "Vellore", "Tirunelveli", "Kanchipuram", "Sriperumbudur", "Thanjavur", "Karur", "Namakkal", "Ranipet", "Krishnagiri", "Puducherry", "Tuticorin", "Oragadam", "Ambattur", "Guindy", "Pollachi", "Dindigul", "Cuddalore", "Nagercoil", "Gummidipoondi"];
const VERTICAL_KEYWORDS: [RegExp, string][] = [
  [/warehous|godown|logistics|cold storage/i, "Warehouse"],
  [/hospital|clinic|medical|healthcare/i, "Hospital"],
  [/\bschool\b/i, "School"],
  [/factory|mill|textile|industr|manufactur|plant|foundry|spinning|fabricat/i, "Industrial"],
  [/\bhome\b|house|villa|apartment|residen/i, "Residential"],
  [/office|mall|hotel|showroom|shop|commercial|restaurant|resort/i, "Commercial"],
];
const AMBIGUOUS_VERTICAL = /college|university|educational|institute|institution|trust|academy/i;

export const HeuristicAI: AIProvider = {
  name: "heuristic-dev",
  extractLead(text) {
    const t = text.replace(/\s+/g, " ").trim();
    const learned = getSetting<Record<string, string>>("ai_learned", {});
    const fc: Record<string, number> = {};
    let confidence = 0;

    const solarIntent = /solar|rooftop|roof top|\bpv\b|net.?meter|epc|\bkw\b|\bkwp\b|\bmw\b|kilowatt|megawatt/i.test(t);
    const intent = solarIntent ? "Solar EPC requirement" : null;
    if (intent) { confidence += 0.2; fc.intent = 0.95; }

    let capacity_kw: number | null = null;
    const cap = t.match(/(\d+(?:\.\d+)?)\s*(kwp|kw|kilowatts?|mwp|mw|megawatts?)\b/i);
    if (cap) {
      const n = parseFloat(cap[1]);
      capacity_kw = /^m/i.test(cap[2]) ? n * 1000 : n;
      confidence += 0.25; fc.capacity_kw = 0.97;
    }

    const location = TN_CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(t)) ?? null;
    if (location) { confidence += 0.2; fc.location = 0.95; }

    let vertical: string | null = null;
    const ambiguities: LeadExtraction["ambiguities"] = [];
    for (const [k, v] of Object.entries(learned)) if (t.toLowerCase().includes(k)) { vertical = v; fc.vertical = 0.9; break; }
    if (!vertical) {
      for (const [re, v] of VERTICAL_KEYWORDS) if (re.test(t)) { vertical = v; fc.vertical = 0.92; break; }
    }
    if (!vertical && AMBIGUOUS_VERTICAL.test(t)) {
      ambiguities.push({ field: "vertical", reason: "Educational institution — could be a school, college or other", options: ["School", "College", "Other"] });
      fc.vertical = 0.5;
    }
    if (vertical) confidence += 0.15;

    const phone = t.match(/(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})\b/)?.[0]?.replace(/[\s-]/g, "") ?? null;
    const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;

    let contact: string | null = null;
    const c1 = t.match(/contact(?: person| is|:)?\s+(?:is\s+)?(?:Mr\.?|Ms\.?|Mrs\.?)?\s*([A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?)/);
    const c2 = t.match(/(?:^|[.\s])([A-Z][a-z]{2,})\s+contact\b/);
    const c3 = t.match(/(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    contact = c1?.[1] ?? c2?.[1] ?? c3?.[1] ?? null;
    if (contact) { confidence += 0.1; fc.contact = 0.88; }

    const co = text.match(/\b([A-Z][\w&.]*(?:\s[A-Z][\w&.]*){0,3}\s(?:Industries|Textiles|Hospitals?|Warehousing|Enterprises|Mills|Exports|Trust|Pvt\.?\s?Ltd\.?|Ltd\.?|Foods|Steels?|Motors|Logistics|Polymers|Packaging))\b/);
    const company = co?.[1] ?? (text.match(/Company:\s*([^\n,]+)/i)?.[1]?.trim() || null);
    if (company) { confidence += 0.05; fc.company = 0.85; }

    const solar_type = /ground.?mount/i.test(t) ? "Ground mount" : /car.?port/i.test(t) ? "Carport" : /roof/i.test(t) ? "Rooftop" : null;
    if (solar_type) { confidence += 0.05; fc.solar_type = 0.9; }

    if (!solarIntent && !capacity_kw) confidence = Math.min(confidence, 0.3);
    if (ambiguities.length) confidence = Math.min(confidence, 0.61);
    confidence = Math.min(0.97, Math.round(confidence * 100) / 100);

    return { fields: { company, contact, phone, email, vertical, location, capacity_kw, solar_type, intent }, field_confidence: fc, confidence, ambiguities };
  },

  summarizeCall(q) {
    const cap = parseFloat(q.desired_capacity ?? "") || null;
    const units = parseFloat(q.monthly_units ?? "") || null;
    const suit = units ? `${Math.round((units * 12) / 1450 * 0.9)}–${Math.round((units * 12) / 1450 * 1.1)} kW` : null;
    const parts = [
      `Customer requires ${cap ? `approximately ${cap} kW ` : ""}${(q.solar_type ?? "rooftop").toLowerCase()} solar${q.segment ? ` for a ${q.segment.toLowerCase()} site` : ""}${q.location ? ` in ${q.location}` : ""}.`,
      suit ? `Current consumption indicates approximately ${suit} system suitability.` : null,
      q.site_visit === "yes" ? "Customer is interested in a site survey." : q.site_visit === "no" ? "Customer has not asked for a site visit yet." : null,
      q.decision_maker ? `Decision maker: ${q.decision_maker}.` : null,
      q.timeline ? `Timeline: ${q.timeline}.` : null,
      q.budget ? `Budget indicated: ${q.budget}.` : null,
    ].filter(Boolean);
    const strong = cap && q.decision_maker && q.timeline && q.site_visit !== "no";
    const dead = q.timeline && /no plan|not interested|just enquir/i.test(q.timeline);
    return { summary: parts.join(" "), recommendation: dead ? "DISQUALIFIED" : strong ? "QUALIFIED" : "NURTURE" };
  },

  extractEbBill(text) {
    const units = text.match(/(?:units?|consumption|kwh)[^\d]{0,15}([\d,]+(?:\.\d+)?)/i)?.[1];
    const amt = text.match(/(?:amount|bill|total)[^\d]{0,15}(?:rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i)?.[1];
    const load = text.match(/(?:sanctioned|connected)\s*load[^\d]{0,10}([\d.]+)/i)?.[1];
    const n = (s?: string) => (s ? parseFloat(s.replace(/,/g, "")) : null);
    const found = [units, amt, load].filter(Boolean).length;
    return { units_kwh: n(units), amount: n(amt), sanctioned_load_kw: n(load), confidence: found === 3 ? 0.9 : found === 2 ? 0.7 : found === 1 ? 0.45 : 0.1 };
  },
};
export const ai: AIProvider = HeuristicAI;

/* ───────────── PDF ───────────── */
export interface PdfProvider {
  name: string;
  /** Route that renders the print-ready document; user saves as PDF. A headless-Chrome adapter can swap in here. */
  documentUrl(proposalId: number, version: number): string;
}
export const PrintPdf: PdfProvider = { name: "browser-print", documentUrl: (id, v) => `/proposals/${id}/print?v=${v}` };
export const pdf: PdfProvider = PrintPdf;
