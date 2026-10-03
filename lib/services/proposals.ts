// ProposalService — template → dynamic variables → pricing → versions → approval → send → accept.
import { getDb, nextCode, settings } from "../db";
import { fmtKw, fmtDate, fmtDMY, sqlTime, dateOnly, addDays, inr } from "../util";
import { audit, notify, type Actor } from "./core";
import { fire } from "./automation";
import { changeStatus, logActivity } from "./leads";
import { GmailProvider, pdf, Smtp, storage } from "../providers";
import { buildProposalDocx } from "../proposal-docx";
import {
  computePayments, computePricing, validateTerms, fillVars,
  type Item, type Pricing, type TemplateDoc, type PayLine,
} from "../proposal-render";

export const COMPANY = {
  address: "15 LMA Courtyard, Harrington Road, Chetpet, Chennai 600031",
  web: "www.viryasystech.com", phone: "+91 97908 59026", email: "accounts@viryasystech.com",
};

export const DEFAULT_TEMPLATE: TemplateDoc = {
  brand: { logo_path: "/brand/logo.png", footer: "Viryasys Technologies · Accelerating Green", contact: `${COMPANY.email} | ${COMPANY.phone} | ${COMPANY.web}` },
  sections: [
    { key: "cover", title: "Proposal for Solar On-Grid System", type: "cover", visible: true, body: `Quotation for Supply, Installation, Testing and Commissioning (SITC) of **{{system_capacity}}** Rooftop mounted.\nLuminating Today with Renewable Energy Excellence\n${COMPANY.address}\n${COMPANY.web}  ·  ${COMPANY.phone}` },
    { key: "letter", title: "", type: "text", visible: true, body: `PID: {{proposal_no}} | Date: {{proposal_date}}

To,
**{{customer_name}}**
{{site_location}}
Contact: {{contact_phone}}

**Sub: - Quotation for Supply, Installation, Testing and Commissioning (SITC) of {{system_capacity}} Rooftop mounted.**

With reference to the above subject, we are pleased to submit our techno-commercial proposal for the installation of a rooftop-mounted solar power plant at the proposed site in compliance with MNRE/SECI guidelines.

Pursuant to our site survey on {{survey_date}}, and based on the preliminary design and requirements of the customer, we propose the installation of a rooftop solar power system of approximately {{system_capacity}}.

We look forward to your kind consideration and the opportunity to serve you. We assure you of our best services at all times.

Thank you.

**{{pm_name}}**
**{{pm_title}}**
**Viryasys Technologies**
${COMPANY.address}
Email: ${COMPANY.email} | Contact: ${COMPANY.phone} | ${COMPANY.web}` },
    { key: "technical", title: "Technical details", type: "text", visible: true, body: `Solar energy is important for many reasons and has a great positive impact on the environment. Solar / Photovoltaic devices convert light from the sun into usable forms of electrical energy. These mainly consist of PV modules, module mounting structures, inverters, monitoring devices etc.

The proposed solution is an **On-Grid Solar Power Plant**. This system integrates **solar PV generation and grid electricity (DISCOM)** under PM Surya Ghar Yojna Scheme.

## Salient features

**Premium Tier-1 Components:** We use high-quality solar panels and inverters sourced from reputed Tier-1 manufacturers such as Goldi Solar, Premier Energies, Growatt, Sungrow, etc. This ensures superior system reliability, higher energy efficiency, long-term performance, and maximum value for our clients.

**Robust & Customizable Mounting Structure:** The module mounting structure can be customized or standardized based on site requirements and rooftop conditions. Where no pre-fabricated structure is required, the setup is mounted on top of the sheet using Aluminium strut rails with stainless steel fasteners.

**Optimized Cable Selection & Safety:** High-quality 1core/4-core, 4sq.mm cables are proposed to ensure efficient power transmission, minimal energy losses, and reliable system connectivity. The selected cable sizing is optimized for a {{system_capacity}} solar plant and enhances system safety by providing effective protection during sudden current surges, thereby safeguarding critical electrical components.

**Professional Installation & Commissioning:** Installation and commissioning activities are carried out by a skilled and experienced technical team under the supervision of a dedicated site engineer. This ensures safe execution, seamless system integration, adherence to industry standards, and a clean aesthetic finish.

**End-to-End Coordination & Support:** Complete project coordination is managed by Viryasys Technologies, including system design, net-metering application support, logistics, installation planning, commissioning, and customer assistance — ensuring a smooth and hassle-free experience from start to finish.` },
    { key: "boq", title: "Bill of material", type: "boq", visible: true, body: "Note: the quantity of panels may vary depending on the watt peak of panel." },
    { key: "area", title: "Area requirement", type: "text", visible: true, body: "Shadow free area of around **{{area_requirement}}** (based on true south orientation) is required for a {{system_capacity}} rooftop plant." },
    { key: "layout", title: "Solar plant layout", type: "image", visible: true, body: "" },
    { key: "scope", title: "Scope of work", type: "text", visible: true, body: `Scope of Work in this offer includes the following:

## Design & Engineering
- System design: PV Plant Layout diagrams
- Engineering drawings, SLD diagrams
- Detailed Bill of Materials & Project Report

## Procurement
- Procurement of raw material, Solar Panels, PV inverter, BOS electrical material for {{system_capacity}}
- Ordering Material & follow up for delivery of materials
- Invoice certification

## Civil works
- Erection of Module structure for mounting modules on Roof/Tinshade
- Preparation of earthing pits
- Erection of foundation in case of Rooftop Solar Power Plant

## Electrical works
- Placing and erecting PV modules
- Stringing or wiring of Modules for arrays
- Cabling from modules to DC Distribution box, from DC Distribution box to Inverter, and from Inverter to AC Distribution box
- Earthing connections and Earthing Tests
- Initial configuration of the software for monitoring power generation

## Testing & commissioning
- Pre-testing of the plant with grid synchronization
- Commissioning of the plant and final plant checks
- Warranty as per terms and conditions mentioned herein` },
    { key: "exclusions", title: "Exclusions", type: "text", visible: true, body: `- Any separate sheds or enclosures for inverter and ACDC panel.
- Suitable and safe claiming systems at the workplace during installation. Our installation team will be equipped with PPE for their individual safety. Additional safety as may be necessary due to site conditions shall be project client's responsibility.
- Regulatory and statutory approval like Net-Meter / Additional Energy / Check Meters and other approvals. However, Viryasys Technologies shall guide through the process.
- Construction power and special approval at the project location for work access.
- Clearances and confirmation to work from all stakeholders in case of society and community. The project client shall obtain all necessary approval for the seamless and smooth execution of the project on time.

**ENCLOSURE:** Refer to the plan view attached in the email.` },
    { key: "commercial", title: "Commercial details", type: "commercial", visible: true, body: "Material, Labor, Supply, Installation, Balance of System (BoS), Steel Structure, Testing & Commissioning of Roof Top {{system_capacity}} Solar Plant." },
    { key: "payment", title: "Payment terms", type: "payment", visible: true, body: "" },
    { key: "warranty", title: "Warranty", type: "text", visible: true, body: `- PV modules will have a limited performance generation warranty as described by the module manufacturers for a period of 30 Years from the date of installation.
- Inverters shall be as per the manufacturer's warranty Terms & Conditions.
- The warranty for Inverters and PV Modules (Solar Panels) under this proposal shall be strictly limited to the warranty terms and conditions issued by the respective Original Equipment Manufacturers (OEMs). All warranties shall be provided on a back-to-back basis, and Viryasys Technologies' liability shall not extend beyond facilitating the applicable OEM warranty claims, as per the OEM's published warranty policy.
- All other equipment: 1 year warranty against manufacturing defects.
- The warranty shall be deemed null and void in the event of any physical damage to the solar panels or inverter or other equipment.` },
    { key: "validity", title: "", type: "text", visible: true, body: "**Proposal Validity:** Offer validity – {{validity_days}} days from the date of proposal" },
    { key: "signature", title: "Acceptance", type: "signature", visible: false, body: "Kindly sign below to accept this proposal and confirm the payment schedule." },
  ],
};

interface VersionRow {
  id: number; proposal_id: number; version: number; sections: string; variables: string; subtotal: number; discount: number; tax: number; total: number;
  tax_breakdown: string; payment_terms: string; note: string | null; created_by: number | null; approval_status: string; created_at: string;
}

export function getTemplate(id?: number): { id: number; name: string; doc: TemplateDoc } {
  const db = getDb();
  const r = (id ? db.prepare("SELECT * FROM proposal_templates WHERE id = ?").get(id) : db.prepare("SELECT * FROM proposal_templates WHERE is_default = 1").get()) as any;
  return { id: r.id, name: r.name, doc: JSON.parse(r.sections) as TemplateDoc };
}
export function saveTemplate(id: number, doc: TemplateDoc, actor: Actor) {
  getDb().prepare("UPDATE proposal_templates SET sections = ?, updated_by = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(doc), actor.id, sqlTime(), id);
  audit(actor, "edited proposal template", "template", id);
}

/* ───────────── variables ───────────── */
export function buildVariables(leadId: number, proposalNo: string, version: number, pricing: Pricing, terms: { name: string; pct: number }[]): Record<string, string> {
  const db = getDb();
  const st = settings();
  const l = db.prepare(`SELECT l.*, c.name customer_name, ct.name contact_name, ct.phone contact_phone, ow.name owner_name FROM leads l LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN contacts ct ON ct.id = l.contact_id LEFT JOIN users ow ON ow.id = l.owner_id WHERE l.id = ?`).get(leadId) as any;
  const d = db.prepare("SELECT * FROM designs WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const s = db.prepare("SELECT s.site_address, s.submitted_at, s.created_at, pm.name pm_name FROM site_surveys s LEFT JOIN users pm ON pm.id = s.pm_id WHERE s.lead_id = ? ORDER BY s.id DESC LIMIT 1").get(leadId) as any;
  const v = db.prepare("SELECT v.scheduled_at, pm.name pm_name FROM site_visits v LEFT JOIN users pm ON pm.id = v.pm_id WHERE v.lead_id = ? ORDER BY v.id DESC LIMIT 1").get(leadId) as any;
  const org = db.prepare("SELECT name FROM organizations LIMIT 1").get() as any;
  const kw = d?.capacity_kw ?? l.capacity_kw;
  const pmName = s?.pm_name ?? v?.pm_name;
  const gstRate = pricing.taxes.reduce((a, t) => a + t.pct, 0);
  return {
    company_name: org?.name ?? "ViryaSys Technologies",
    customer_name: l.customer_name ?? "Customer",
    contact_person: l.contact_name ?? "Sir/Madam",
    contact_phone: l.contact_phone ? (/^\+/.test(l.contact_phone) ? l.contact_phone : `+91 ${l.contact_phone}`) : "—",
    salutation: "Sir",
    site_location: s?.site_address || l.city || "—",
    system_capacity: fmtKw(kw),
    panel_brand: d?.panel_brand ?? "—",
    panel_details: d?.panel_count ? `${d.panel_count} × ${d.panel_wp} Wp` : "—",
    inverter_brand: d?.inverter_brand ?? "—",
    inverter_details: d?.inverter_count ? `${d.inverter_count} × ${d.inverter_kw} kW` : "—",
    estimated_generation: d?.est_annual_kwh ? `${new Intl.NumberFormat("en-IN").format(Math.round(d.est_annual_kwh))} kWh / year` : "—",
    project_value: inr(pricing.subtotal - pricing.discount),
    tax: inr(pricing.tax),
    total_value: inr(pricing.total),
    gst_label: `${gstRate}% GST`,
    payment_terms: terms.map((t) => `${t.pct}% ${t.name}`).join(" / "),
    validity_days: String(st.proposal_validity_days),
    validity: fmtDate(sqlTime(addDays(new Date(), st.proposal_validity_days))),
    proposal_date: fmtDMY(sqlTime()),
    survey_date: fmtDMY(v?.scheduled_at ?? s?.submitted_at ?? s?.created_at ?? sqlTime()),
    area_requirement: kw ? `${new Intl.NumberFormat("en-IN").format(Math.round(kw * st.calc.area_sqft_per_kw))} Sqft.` : "—",
    pm_name: pmName ?? l.owner_name ?? "Viryasys Technologies",
    pm_title: pmName ? "Project Manager" : "Solar Consultant",
    proposal_no: proposalNo,
    version: `V${version}`,
  };
}

/* ───────────── generate ───────────── */
export function readiness(leadId: number) {
  const db = getDb();
  const design = db.prepare("SELECT id, status FROM designs WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const boqCount = design ? (db.prepare("SELECT COUNT(*) c FROM boq_items bi JOIN boqs b ON b.id = bi.boq_id WHERE b.design_id = ?").get(design.id) as any).c : 0;
  const existing = db.prepare("SELECT id FROM proposals WHERE lead_id = ?").get(leadId) as any;
  return { designReady: design?.status === "COMPLETED", boqCount, existingProposalId: existing?.id as number | undefined };
}

export function generateProposal(leadId: number, actor: Actor, paymentTemplateName?: string): number {
  const db = getDb();
  const r = readiness(leadId);
  if (r.existingProposalId) return r.existingProposalId;
  if (!r.designReady) throw new Error("Design must be completed before generating a proposal");
  const design = db.prepare("SELECT * FROM designs WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as any;
  const boq = db.prepare("SELECT bi.* FROM boq_items bi JOIN boqs b ON b.id = bi.boq_id WHERE b.design_id = ? ORDER BY bi.id").all(design.id) as any[];
  const lead = db.prepare("SELECT customer_id, code FROM leads WHERE id = ?").get(leadId) as any;
  const s = settings();
  const items: Item[] = boq.map((b) => ({ description: b.description, spec: b.spec, qty: b.qty, unit: b.unit, rate: b.unit_cost }));
  const terms = (s.payment_templates.find((p) => p.name === paymentTemplateName) ?? s.payment_templates[0]).milestones;
  const tpl = getTemplate();
  const pricing = computePricing(items, 0, s.taxes);
  const code = nextCode("PROP", db);

  const id = db.transaction(() => {
    const pid = Number(db.prepare("INSERT INTO proposals (code, lead_id, customer_id, template_id, status) VALUES (?,?,?,?,'DRAFT')").run(code, leadId, lead.customer_id, tpl.id).lastInsertRowid);
    insertVersion(pid, 1, tpl.doc, buildVariables(leadId, code, 1, pricing, terms), pricing, terms, "Initial proposal generated from survey, design and BOQ", actor.id);
    return pid;
  })();
  changeStatus(leadId, "PROPOSAL", actor);
  logActivity(leadId, "proposal", `Proposal ${code} V1 generated`, actor);
  audit(actor, "generated proposal", "proposal", code);
  return id;
}

function insertVersion(pid: number, version: number, doc: TemplateDoc, vars: Record<string, string>, p: Pricing, terms: { name: string; pct: number }[], note: string, userId: number | null) {
  const db = getDb();
  const vid = Number(
    db.prepare(
      `INSERT INTO proposal_versions (proposal_id, version, sections, variables, subtotal, discount, tax, total, tax_breakdown, payment_terms, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(pid, version, JSON.stringify(doc), JSON.stringify(vars), p.subtotal, p.discount, p.tax, p.total, JSON.stringify(p.taxes.map((t) => ({ name: t.name, pct: t.pct }))), JSON.stringify(terms), note, userId).lastInsertRowid
  );
  const ins = db.prepare("INSERT INTO proposal_items (version_id, description, spec, qty, unit, rate, sort) VALUES (?,?,?,?,?,?,?)");
  p.items.forEach((i, n) => ins.run(vid, i.description, i.spec ?? null, i.qty, i.unit, i.rate, n));
  db.prepare("UPDATE proposals SET current_version = ? WHERE id = ?").run(version, pid);
  return vid;
}

/* ───────────── read ───────────── */
export function getProposal(id: number, version?: number) {
  const db = getDb();
  const p = db.prepare(
    `SELECT p.*, l.title lead_title, l.code lead_code, l.owner_id, l.status lead_status, c.name customer_name, ct.email contact_email, ct.name contact_name
     FROM proposals p JOIN leads l ON l.id = p.lead_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN contacts ct ON ct.id = l.contact_id WHERE p.id = ?`
  ).get(id) as any;
  if (!p) return null;
  const v = db.prepare("SELECT * FROM proposal_versions WHERE proposal_id = ? AND version = ?").get(id, version ?? p.current_version) as VersionRow | undefined;
  if (!v) return null;
  const items = db.prepare("SELECT * FROM proposal_items WHERE version_id = ? ORDER BY sort").all(v.id) as any[];
  const taxes = JSON.parse(v.tax_breakdown) as { name: string; pct: number }[];
  const pricing = computePricing(items.map((i) => ({ description: i.description, spec: i.spec, qty: i.qty, unit: i.unit, rate: i.rate })), v.discount, taxes);
  const terms = JSON.parse(v.payment_terms) as { name: string; pct: number }[];
  const versions = db.prepare(
    "SELECT v.version, v.total, v.note, v.approval_status, v.created_at, u.name created_by FROM proposal_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.proposal_id = ? ORDER BY v.version DESC"
  ).all(id) as any[];
  return {
    proposal: p, version: v, doc: JSON.parse(v.sections) as TemplateDoc,
    // Stored values win (the wording a version was created with); newer variables fall back to live data.
    vars: { ...buildVariables(p.lead_id, p.code, v.version, pricing, terms), ...(JSON.parse(v.variables) as Record<string, string>) },
    pricing, taxes, terms, payments: computePayments(terms, pricing.total) as PayLine[], versions,
    editable: v.version === p.current_version,
  };
}

export function listProposals(q?: string) {
  const w = q ? "WHERE p.code LIKE ? OR c.name LIKE ?" : "";
  return getDb().prepare(
    `SELECT p.*, c.name customer_name, l.code lead_code, l.capacity_kw, v.total, v.approval_status, u.name owner_name
     FROM proposals p JOIN leads l ON l.id = p.lead_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = l.owner_id
     JOIN proposal_versions v ON v.proposal_id = p.id AND v.version = p.current_version ${w} ORDER BY p.id DESC LIMIT 100`
  ).all(...(q ? [`%${q}%`, `%${q}%`] : [])) as any[];
}

/* ───────────── edit (draft only — never overwrite an approved/sent version) ───────────── */
export function saveDraft(id: number, input: { items: Item[]; discount: number; taxes: { name: string; pct: number }[]; terms: { name: string; pct: number }[]; doc: TemplateDoc }, actor: Actor) {
  const db = getDb();
  const cur = getProposal(id);
  if (!cur) throw new Error("Proposal not found");
  if (!cur.editable) throw new Error("Only the current version can be edited. Open the latest version.");
  const err = validateTerms(input.terms);
  if (err) throw new Error(err);
  const items = input.items.filter((i) => i.description.trim() && i.qty > 0);
  if (!items.length) throw new Error("Add at least one pricing row");
  const p = computePricing(items, input.discount, input.taxes);
  const vars = buildVariables(cur.proposal.lead_id, cur.proposal.code, cur.version.version, p, input.terms);
  db.transaction(() => {
    db.prepare("UPDATE proposal_versions SET sections=?, variables=?, subtotal=?, discount=?, tax=?, total=?, tax_breakdown=?, payment_terms=? WHERE id=?")
      .run(JSON.stringify(input.doc), JSON.stringify(vars), p.subtotal, p.discount, p.tax, p.total, JSON.stringify(input.taxes), JSON.stringify(input.terms), cur.version.id);
    db.prepare("DELETE FROM proposal_items WHERE version_id = ?").run(cur.version.id);
    const ins = db.prepare("INSERT INTO proposal_items (version_id, description, spec, qty, unit, rate, sort) VALUES (?,?,?,?,?,?,?)");
    items.forEach((i, n) => ins.run(cur.version.id, i.description, i.spec ?? null, i.qty, i.unit || "nos", i.rate, n));
  })();
  audit(actor, cur.version.approval_status === "DRAFT" ? `saved draft V${cur.version.version}` : `edited ${cur.version.approval_status.toLowerCase()} V${cur.version.version} in place`, "proposal", cur.proposal.code, cur.version.total, p.total);
}

export function approve(id: number, actor: Actor) {
  const cur = getProposal(id)!;
  if (cur.version.approval_status !== "DRAFT") throw new Error("Already approved");
  const db = getDb();
  db.prepare("UPDATE proposal_versions SET approval_status = 'APPROVED' WHERE id = ?").run(cur.version.id);
  if (cur.proposal.status !== "ACCEPTED") db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE id = ?").run(id); // a revision of an accepted proposal never re-opens the deal
  logActivity(cur.proposal.lead_id, "proposal", `Proposal ${cur.proposal.code} V${cur.version.version} approved`, actor);
  audit(actor, "approved proposal", "proposal", cur.proposal.code, "DRAFT", "APPROVED");
  notify({ userId: cur.proposal.owner_id, type: "proposal_ready", title: `Proposal approved: ${cur.proposal.code}`, body: "Ready to send to the customer.", link: `/proposals/${id}` });
}

/* ───────────── email (template from Settings, DOCX + plan view attached) ───────────── */
export function planViews(leadId: number) {
  return getDb().prepare("SELECT id, name, file_path FROM documents WHERE lead_id = ? AND doc_type = 'Plan view' AND file_path IS NOT NULL ORDER BY id").all(leadId) as { id: number; name: string; file_path: string }[];
}
const isImage = (n: string) => /\.(png|jpe?g)$/i.test(n);

export async function docxFor(id: number, version?: number): Promise<{ buffer: Buffer; filename: string } | null> {
  const cur = getProposal(id, version);
  if (!cur) return null;
  const plan: { data: Buffer }[] = [];
  for (const d of planViews(cur.proposal.lead_id)) if (isImage(d.name)) { const b = await storage.get(d.file_path); if (b) plan.push({ data: b }); }
  const buffer = await buildProposalDocx({ doc: cur.doc, vars: cur.vars, pricing: cur.pricing, payments: cur.payments, plan });
  const safe = String(cur.proposal.customer_name ?? "Customer").replace(/[^\w]+/g, "_");
  return { buffer, filename: `${cur.proposal.code}_V${cur.version.version}_${safe}.docx` };
}

export function composeEmail(id: number) {
  const cur = getProposal(id)!;
  const em = settings().email;
  return {
    to: (cur.proposal.contact_email as string | null) ?? "",
    cc: em.cc,
    subject: fillVars(em.subject, cur.vars),
    body: fillVars(em.body, cur.vars),
    fromName: em.from_name,
    plan: planViews(cur.proposal.lead_id),
  };
}

export function prepareEmail(id: number) {
  const m = composeEmail(id);
  const cur = getProposal(id)!;
  return { ...m, attachmentNames: [`${cur.proposal.code}_V${cur.version.version}.docx (editable Word proposal)`, ...m.plan.map((p) => p.name)], configured: Smtp.configured(), mailto: GmailProvider.prepare(m.to, m.subject, m.body).mailto, pdfUrl: pdf.documentUrl(id, cur.version.version) };
}

export type SendResult = { status: "SENT" | "FAILED" | "NOT_CONFIGURED" | "NO_RECIPIENT"; error?: string };

/** Sends the approved proposal to the customer, records it in the outbox, and marks the proposal SENT on success. */
export async function sendProposalEmail(id: number, actor: Actor, trigger: "auto" | "manual"): Promise<SendResult> {
  const db = getDb();
  const cur = getProposal(id);
  if (!cur) throw new Error("Proposal not found");
  if (!["APPROVED", "SENT", "ACCEPTED"].includes(cur.version.approval_status)) throw new Error("Approve the proposal before sending");
  const m = composeEmail(id);
  const docx = await docxFor(id);
  const atts: { filename: string; content: Buffer }[] = [];
  if (docx) atts.push({ filename: docx.filename, content: docx.buffer });
  for (const p of m.plan) { const b = await storage.get(p.file_path); if (b) atts.push({ filename: p.name, content: b }); }
  const log = (status: string, error?: string) => db.prepare("INSERT INTO email_outbox (proposal_id, lead_id, to_addr, cc, subject, body, attachments, status, error, trigger, sent_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, cur.proposal.lead_id, m.to, m.cc || null, m.subject, m.body, JSON.stringify(atts.map((a) => a.filename)), status, error ?? null, trigger, status === "SENT" ? sqlTime() : null, actor.id);
  const link = `/proposals/${id}`;

  if (!m.to) { log("NO_RECIPIENT"); notify({ userId: cur.proposal.owner_id, role: "sales", type: "proposal_ready", title: `Proposal ${cur.proposal.code} approved — no customer email on file`, body: "Add the contact's email, then send from the proposal.", link }); return { status: "NO_RECIPIENT" }; }
  if (!Smtp.configured()) { log("NOT_CONFIGURED"); notify({ userId: cur.proposal.owner_id, role: "sales", type: "proposal_ready", title: `Proposal ${cur.proposal.code} approved — email not sent`, body: "Outgoing email (SMTP) isn't configured yet. Send it manually from the proposal.", link }); return { status: "NOT_CONFIGURED" }; }
  try {
    await Smtp.send({ to: m.to, cc: m.cc, subject: m.subject, text: m.body, attachments: atts }, m.fromName);
    log("SENT");
    if (cur.version.approval_status === "APPROVED") markSent(id, actor, `emailed to ${m.to}`);
    else logActivity(cur.proposal.lead_id, "proposal", `Proposal ${cur.proposal.code} V${cur.version.version} re-sent by email to ${m.to}`, actor);
    return { status: "SENT" };
  } catch (e: any) {
    const err = String(e?.message ?? e).slice(0, 300);
    log("FAILED", err);
    notify({ userId: cur.proposal.owner_id, role: "sales", type: "proposal_ready", title: `Proposal ${cur.proposal.code} email failed`, body: err, link });
    return { status: "FAILED", error: err };
  }
}

/** Approve, then auto-send if enabled in Settings. */
export async function approveAndSend(id: number, actor: Actor): Promise<SendResult | null> {
  approve(id, actor);
  return settings().email.auto_send ? sendProposalEmail(id, actor, "auto") : null;
}

export function outboxFor(id: number) {
  return getDb().prepare("SELECT * FROM email_outbox WHERE proposal_id = ? ORDER BY id DESC LIMIT 10").all(id) as any[];
}

/** Records that the proposal went to the customer (by SMTP send, or by the user through their own mail client). */
export function markSent(id: number, actor: Actor, how = "sent to customer") {
  const cur = getProposal(id)!;
  if (cur.version.approval_status !== "APPROVED") throw new Error("Approve the proposal before sending");
  const db = getDb();
  db.prepare("UPDATE proposal_versions SET approval_status = 'SENT' WHERE id = ?").run(cur.version.id);
  if (cur.proposal.status !== "ACCEPTED") db.prepare("UPDATE proposals SET status = 'SENT' WHERE id = ?").run(id);
  logActivity(cur.proposal.lead_id, "proposal", `Proposal ${cur.proposal.code} V${cur.version.version} ${how}`, actor);
  audit(actor, "sent proposal", "proposal", cur.proposal.code);
}

/* ───────────── negotiation ───────────── */
export function logNegotiation(id: number, kind: string, note: string, actor: Actor) {
  const cur = getProposal(id)!;
  logActivity(cur.proposal.lead_id, "negotiation", `${kind}: ${note}`, actor);
  if (cur.proposal.lead_status === "PROPOSAL") changeStatus(cur.proposal.lead_id, "NEGOTIATION", actor);
  getDb().prepare("UPDATE proposals SET status = 'NEGOTIATION' WHERE id = ? AND status IN ('SENT','APPROVED')").run(id);
}

export function revise(id: number, note: string, actor: Actor): number {
  const cur = getProposal(id)!;
  if (cur.proposal.status === "REJECTED") throw new Error("Proposal is closed");
  const db = getDb();
  const n = cur.version.version + 1;
  insertVersion(id, n, cur.doc, { ...cur.vars, version: `V${n}` }, cur.pricing, cur.terms, note || "Revised", actor.id);
  if (cur.proposal.status !== "ACCEPTED") db.prepare("UPDATE proposals SET status = 'DRAFT' WHERE id = ?").run(id);
  logActivity(cur.proposal.lead_id, "proposal", `Revised proposal V${n} created${note ? ` — ${note}` : ""}`, actor);
  audit(actor, "created proposal revision", "proposal", cur.proposal.code, `V${n - 1}`, `V${n}`);
  return n;
}

export function accept(id: number, actor: Actor, pmId?: number | null): { project_id?: number; project_code?: string; log: string[] } {
  const cur = getProposal(id)!;
  if (!["SENT", "NEGOTIATION"].includes(cur.proposal.status)) throw new Error("Send the proposal before marking it accepted");
  const db = getDb();
  db.prepare("UPDATE proposal_versions SET approval_status = 'ACCEPTED' WHERE id = ?").run(cur.version.id);
  db.prepare("UPDATE proposals SET status = 'ACCEPTED' WHERE id = ?").run(id);
  changeStatus(cur.proposal.lead_id, "WON", actor);
  audit(actor, "accepted proposal", "proposal", cur.proposal.code);
  const ctx: Record<string, any> = { proposal_id: id, lead_id: cur.proposal.lead_id, lead_code: cur.proposal.lead_code, owner_id: cur.proposal.owner_id, customer: cur.proposal.customer_name, value: inr(cur.pricing.total), link: `/proposals/${id}`, pm_choice: pmId ?? null };
  const log = fire("proposal.accepted", ctx);
  return { project_id: ctx.project_id, project_code: ctx.project_code, log };
}

export function reject(id: number, reason: string, actor: Actor) {
  const cur = getProposal(id)!;
  getDb().prepare("UPDATE proposals SET status = 'REJECTED' WHERE id = ?").run(id);
  changeStatus(cur.proposal.lead_id, "LOST", actor, reason || "Proposal rejected");
}

export { dateOnly };

/** Create a project from a lead. With an accepted proposal the full proposal flow runs; otherwise the project opens straight from the lead. */
export function createProjectForLead(leadId: number, pmId: number | null, actor: Actor) {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM projects WHERE lead_id = ?").get(leadId)) throw new Error("This lead already has a project");
  const prop = db.prepare("SELECT p.id FROM proposals p WHERE p.lead_id = ? AND p.status = 'ACCEPTED'").get(leadId) as any;
  if (!prop) {
    const r = (require("./projects") as typeof import("./projects")).createFromLead(leadId, pmId, actor);
    return { project_id: r.id, project_code: r.code };
  }
  const cur = getProposal(prop.id)!;
  const ctx: Record<string, any> = { proposal_id: prop.id, lead_id: leadId, lead_code: cur.proposal.lead_code, owner_id: cur.proposal.owner_id, customer: cur.proposal.customer_name, value: inr(cur.pricing.total), link: `/proposals/${prop.id}`, pm_choice: pmId };
  fire("proposal.accepted", ctx);
  if (!ctx.project_id) throw new Error("The “Create project” automation rule is switched off — turn it on in Automation, then try again.");
  return { project_id: ctx.project_id as number, project_code: ctx.project_code as string };
}
