// Realistic Tamil Nadu solar demo data. Deterministic (seeded PRNG) so every fresh DB looks the same.
import type { DB } from "./index";
import bcrypt from "bcryptjs";
import { ROLES, RBAC, LEAD_SOURCES, type RoleKey, type ModuleKey } from "../config";
import { DEFAULT_SETTINGS } from "./index";
import { addDays, addMinutes, dateOnly, sqlTime, inr, fmtDate, fmtDMY } from "../util";
import { computePricing, computePayments } from "../proposal-render";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20260925);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
const between = (a: number, b: number) => Math.round(a + R() * (b - a));

const NOW = new Date();
const ts = (daysAgo: number, minutes = 0) => sqlTime(addMinutes(addDays(NOW, -daysAgo), -minutes));
const day = (offset: number) => dateOnly(addDays(NOW, offset));

const CITIES = ["Chennai", "Coimbatore", "Madurai", "Hosur", "Tiruchirappalli", "Salem", "Tirupur", "Erode", "Chengalpattu", "Vellore", "Tirunelveli", "Sriperumbudur", "Krishnagiri", "Karur", "Thanjavur", "Namakkal"];
const COMPANY_PARTS: [string, string][] = [
  ["Sri Lakshmi", "Textiles"], ["Kaveri", "Industries"], ["Sakthi", "Spinning Mills"], ["Annai", "Foods"], ["Murugan", "Steels"], ["Bharathi", "Polymers"], ["Vel", "Auto Components"],
  ["Thirumala", "Warehousing"], ["Ganga", "Cold Storage"], ["Pioneer", "Packaging"], ["Southern", "Castings"], ["Aadhavan", "Exports"], ["Palani", "Rice Mills"], ["Nila", "Hospitals"],
  ["Shanmuga", "Educational Trust"], ["Coromandel", "Logistics"], ["Sundaram", "Fasteners"], ["Rathna", "Garments"], ["Velavan", "Engineering"], ["Tamilnadu", "Cements Depot"],
  ["Madras", "Precision Tools"], ["Kovai", "Pumps"], ["Cauvery", "Agro Foods"], ["Ponni", "Dairy"], ["Meenakshi", "Hotels"], ["Lotus", "Apparels"], ["Surya", "Plastics"], ["Amman", "Granites"],
  ["Bala", "Motors"], ["Deepam", "Oils"], ["Ideal", "Bakers"], ["Jeeva", "Medical Centre"], ["Karthik", "Ceramics"], ["Sri Ram", "Chemicals"], ["Thangam", "Jewellers"], ["Udhaya", "Textile Park"],
  ["Vijay", "Educational Trust"], ["Yamuna", "Fabricators"], ["Zenith", "Electricals"], ["Ashok", "Agencies"], ["Gopal", "Cotton Mills"], ["Hari", "Steel Tubes"], ["Indira", "Matriculation School"],
  ["Janani", "Hospital"], ["Kannan", "Tyres"], ["Lakshmi", "Bricks"], ["Mano", "Feeds"], ["Naveen", "Cables"], ["Omega", "Foundry"], ["Prakash", "Paper Mills"], ["Ragu", "Enterprises"],
  ["Selvam", "Rubber"], ["Tirupati", "Tex"], ["Uma", "Frozen Foods"], ["Venkat", "Auto Ancillary"], ["Windsor", "Furnitures"], ["Xpress", "Cargo"], ["Yogi", "Rice Exports"], ["Zion", "Institute"], ["Arun", "Castings"],
  ["Balaji", "Tanneries"], ["Chola", "Ceramics"], ["Dhanam", "Finance Tower"], ["Eswar", "Tex Processing"], ["Fortune", "Warehouse Park"], ["Guru", "Engineering Works"], ["Hindusthan", "Bearings"], ["Inba", "Hospitals"], ["Kumaran", "Silks"],
];
const industryOf = (n: string) => /Hospital|Medical/.test(n) ? "Healthcare" : /Educational|School|Institute/.test(n) ? "Educational" : /Warehous|Logistics|Cargo|Cold/.test(n) ? "Warehouse" : /Hotel|Jewel|Finance|Agenc|Tower|Furnit/.test(n) ? "Commercial" : "Industrial";
const FIRST = ["Ravi", "Suresh", "Karthik", "Meena", "Anand", "Priya", "Senthil", "Lakshmi", "Vignesh", "Deepa", "Arjun", "Kavitha", "Mohan", "Revathi", "Balaji", "Saravanan", "Divya", "Ramesh", "Nithya", "Prakash"];
const LAST = ["Kumar", "Raman", "Subramanian", "Iyer", "Pillai", "Naidu", "Chettiar", "Rajan", "Murthy", "Krishnan", "Selvam", "Natarajan"];

export function seed(db: DB) {
  const tx = db.transaction(() => run(db));
  tx();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { refreshAllHealth } = require("../services/projects");
  refreshAllHealth();
}

function counter(db: DB, key: string) {
  const r = db.prepare("INSERT INTO counters (key, value) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET value=value+1 RETURNING value").get(key) as any;
  return `VS-${key}-${String(r.value).padStart(6, "0")}`;
}

function run(db: DB) {
  /* org, roles, permissions */
  db.prepare("INSERT INTO organizations (id, name, gstin, address, phone, email) VALUES (1,'ViryaSys Technologies','33AAAAA0000A1Z5','Chennai, Tamil Nadu','+91 44 0000 0000','info@viryasystech.com')").run();
  (Object.keys(ROLES) as RoleKey[]).forEach((k) => {
    db.prepare("INSERT INTO roles (key, name, description) VALUES (?,?,?)").run(k, ROLES[k].name, ROLES[k].description);
    Object.entries(RBAC[k]).forEach(([m, a]) => db.prepare("INSERT INTO permissions (role, module, access) VALUES (?,?,?)").run(k, m as ModuleKey, a));
  });
  Object.entries(LEAD_SOURCES).forEach(([k, n]) => db.prepare("INSERT INTO lead_sources (key, name) VALUES (?,?)").run(k, n));
  db.prepare("INSERT INTO settings (key, value) VALUES ('org', ?)").run(JSON.stringify(DEFAULT_SETTINGS));
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai_auto_create', 'false')").run();

  /* users — password for all demo users: viryasys123 */
  const pw = bcrypt.hashSync("viryasys123", 10);
  const U: Record<string, number> = {};
  const users: [string, string, RoleKey][] = [
    ["Kishore", "kishore@viryasystech.com", "md"], ["Admin", "admin@viryasystech.com", "admin"],
    ["Arun Kumar", "arun@viryasystech.com", "sales"], ["Divya Raman", "divya@viryasystech.com", "sales"],
    ["Senthil Murugan", "senthil@viryasystech.com", "pm"], ["Karthik Rajan", "karthik@viryasystech.com", "pm"],
    ["Meena Iyer", "meena@viryasystech.com", "designer"], ["Vignesh Pillai", "vignesh@viryasystech.com", "designer"],
    ["Ramesh Naidu", "ramesh@viryasystech.com", "procurement"], ["Lakshmi Subramanian", "lakshmi@viryasystech.com", "finance"],
    ["Prakash Selvam", "prakash@viryasystech.com", "site_engineer"], ["Vimal Raj", "vimal@viryasystech.com", "site_engineer"], ["Mohan Kumar", "mohan@viryasystech.com", "warehouse"],
  ];
  users.forEach(([n, e, r]) => (U[e.split("@")[0]] = Number(db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)").run(n, e, pw, r).lastInsertRowid)));

  /* proposal template */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DEFAULT_TEMPLATE } = require("../services/proposals");
  db.prepare("INSERT INTO proposal_templates (name, sections, is_default) VALUES ('ViryaSys Standard EPC Proposal', ?, 1)").run(JSON.stringify(DEFAULT_TEMPLATE));
  const tplId = 1;

  /* material categories (configurable) + vendors */
  ([["Panels", "high", "INSTALLATION", 0], ["Inverters", "critical", "COMMISSIONING", 1], ["Structure", "high", "INSTALLATION", 0], ["Cables", "medium", "INSTALLATION", 0], ["Electrical", "medium", "COMMISSIONING", 0], ["Other", "low", "COMMISSIONING", 0]] as [string, string, string, number][])
    .forEach(([k, crit, ms, ser], n) => db.prepare("INSERT INTO material_categories (key, name, criticality, milestone_stage, serialized, sort) VALUES (?,?,?,?,?,?)").run(k, k, crit, ms, ser, n));
  const vendors: [string, string, string, string, string, string][] = [
    ["Waaree Energies (Chennai Depot)", "Panels", "Chennai", "33AAACW3775F1ZR", "orders@waareedepot.in", "30 days"], ["Adani Solar Distribution", "Panels", "Coimbatore", "33AABCA2345B1Z9", "sales@adanisolar-cbe.in", "30 days"],
    ["Vikram Solar Channel Partner", "Panels", "Chennai", "33AAECV5678C1ZK", "chennai@vikramchannel.in", "15 days"], ["Sungrow India Partner", "Inverters", "Bengaluru", "29AAFCS9012D1ZP", "orders@sungrowpartner.in", "Advance"],
    ["Huawei FusionSolar Distributor", "Inverters", "Chennai", "33AABCH3456E1ZM", "sales@fusionsolar-tn.in", "Advance"], ["SolarEdge Channel", "Inverters", "Hyderabad", "36AAGCS7890F1ZQ", "tn@solaredgechannel.in", "15 days"],
    ["Sri Vinayaga Structures", "Structure", "Hosur", "33AAHFS1234G1ZT", "works@vinayagastructures.in", "15 days"], ["Tamil Steel Fabricators", "Structure", "Coimbatore", "33AAJCT5678H1ZV", "info@tamilsteelfab.in", "30 days"],
    ["Polycab Cables Dealer", "Cables,Electrical", "Chennai", "33AAKCP9012J1ZX", "orders@polycabchennai.in", "30 days"], ["Havells Electricals Trading", "Cables,Electrical", "Madurai", "33AALCH3456K1ZZ", "sales@havellsmadurai.in", "30 days"],
  ];
  const vendorIds: Record<string, number[]> = {};
  vendors.forEach(([n, cats, city, gst, email, terms]) => {
    const id = Number(db.prepare("INSERT INTO vendors (code, name, category, categories, products, city, address, gstin, contact, phone, email, payment_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(counter(db, "VEN"), n, cats.split(",")[0], cats, cats.replace(",", " & ").toLowerCase(), city, `${city}, Tamil Nadu`, gst, `${pick(FIRST)} ${pick(LAST)}`, `9${between(400000000, 899999999)}`, email, terms).lastInsertRowid);
    cats.split(",").forEach((c) => (vendorIds[c] ??= []).push(id));
  });

  /* helper builders */
  const mkCustomer = (name: string, city: string) => {
    const cid = Number(db.prepare("INSERT INTO customers (code,name,industry,city,created_at) VALUES (?,?,?,?,?)").run(counter(db, "CUST"), name, industryOf(name), city, ts(between(20, 400))).lastInsertRowid);
    const cn = `${pick(FIRST)} ${pick(LAST)}`;
    const ctId = Number(db.prepare("INSERT INTO contacts (customer_id,name,phone,email,designation,is_primary) VALUES (?,?,?,?,?,1)").run(cid, cn, `9${between(400000000, 899999999)}`, `${cn.split(" ")[0].toLowerCase()}@${name.split(" ")[0].toLowerCase()}.in`, pick(["Managing Director", "Plant Head", "GM Operations", "Purchase Manager", "Director"])).lastInsertRowid);
    return { cid, ctId, cn };
  };
  const mkLead = (o: { cid: number; ctId: number; name: string; city: string; kw: number; status: string; owner: number; source?: string; daysAgo: number; sla?: "met" | "breached" | "running"; respSec?: number; est?: number }) => {
    const vertical = industryOf(o.name) === "Healthcare" ? "Hospital" : industryOf(o.name) === "Educational" ? "School" : industryOf(o.name);
    const est = o.est ?? o.kw * 38000;
    const received = ts(o.daysAgo);
    const id = Number(
      db.prepare(
        `INSERT INTO leads (code,customer_id,contact_id,title,source,vertical,solar_type,capacity_kw,city,owner_id,status,temperature,priority,est_value,expected_close,received_at,first_response_at,sla_status,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(counter(db, "LEAD"), o.cid, o.ctId, `${o.name} — ${o.kw >= 1000 ? o.kw / 1000 + " MW" : o.kw + " kW"} Rooftop · ${o.city}`, o.source ?? pick(["website", "referral", "telegram", "email", "inner_circle", "campaign", "google_chat"]), vertical, "Rooftop", o.kw, o.city, o.owner, o.status, pick(["hot", "warm", "warm", "cold"]), pick(["high", "medium", "medium", "low"]), est, day(between(10, 60)), received, o.sla === "running" ? null : sqlTime(addMinutes(new Date(received.replace(" ", "T") + "Z"), Math.round((o.respSec ?? 90) / 60 * 10) / 10)), o.sla ?? "met", ts(Math.max(0, o.daysAgo - 1))).lastInsertRowid
    );
    db.prepare("INSERT INTO lead_status_history (lead_id,from_status,to_status,user_id,at) VALUES (?,NULL,'NEW',?,?)").run(id, o.owner, received);
    db.prepare("INSERT INTO lead_activities (lead_id,type,summary,user_id,created_at) VALUES (?,?,?,?,?)").run(id, "created", `Lead created`, o.owner, received);
    db.prepare("INSERT INTO lead_activities (lead_id,type,summary,user_id,created_at) VALUES (?,?,?,?,?)").run(id, "assigned", "Assigned by automation", null, received);
    if (o.status !== "NEW") db.prepare("INSERT INTO lead_activities (lead_id,type,summary,user_id,created_at) VALUES (?,?,?,?,?)").run(id, "status", `Status: NEW → ${o.status}`, o.owner, ts(Math.max(0, o.daysAgo - 1)));
    return id;
  };
  const mkSurveyAndDesign = (leadId: number, kw: number, city: string, done: "survey" | "task" | "design", pm: number, designer: number, daysAgo: number) => {
    const visit = Number(db.prepare("INSERT INTO site_visits (lead_id,scheduled_at,location,pm_id,designer_id,contact,status) VALUES (?,?,?,?,?,?,?)").run(leadId, ts(daysAgo + 2), `${city} plant`, pm, designer, "Site contact", "COMPLETED").lastInsertRowid);
    const sid = Number(
      db.prepare(
        `INSERT INTO site_surveys (lead_id,visit_id,pm_id,site_address,gps,site_type,roof_type,roof_area_sqm,available_area_sqm,orientation,shading,obstacles,structural,access,safety,eb_connection,sanctioned_load_kw,monthly_kwh,annual_kwh,existing_infra,notes,status,submitted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SUBMITTED',?)`
      ).run(leadId, visit, pm, `${city} industrial estate`, `${(10 + R() * 3).toFixed(4)}, ${(77 + R() * 3).toFixed(4)}`, "Factory shed", pick(["Metal sheet (trapezoidal)", "RCC flat roof", "Asbestos sheet"]), Math.round(kw * 11), Math.round(kw * 9.2), pick(["South", "South-East", "South-West"]), pick(["Minimal", "Partial (water tank)", "None"]), "HVAC ducts, skylights", "Purlins adequate; verified by site engineer", "Ladder + goods lift", "Fall-arrest required near skylights", "HT 11 kV, TANGEDCO", Math.round(kw * 1.1), Math.round(kw * 150), Math.round(kw * 1800), "DG set 250 kVA, APFC panel", "Roof in good condition.", ts(daysAgo + 1)).lastInsertRowid
    );
    [["Roof length", 68, "m"], ["Roof width", Math.round(kw * 0.16), "m"], ["Parapet height", 1.1, "m"]].forEach(([l, v, u]) => db.prepare("INSERT INTO site_measurements (survey_id,label,value,unit) VALUES (?,?,?,?)").run(sid, l, v, u));
    ["Roof", "Electrical panel", "EB meter", "Site surroundings"].forEach((c) => db.prepare("INSERT INTO site_photos (survey_id,category,file_path,caption) VALUES (?,?,?,?)").run(sid, c, "", `${c} photo`));
    const tid = Number(db.prepare("INSERT INTO design_tasks (lead_id,survey_id,designer_id,status,due_at,created_at) VALUES (?,?,?,?,?,?)").run(leadId, sid, designer, done === "design" ? "COMPLETED" : "PENDING", ts(daysAgo - 3), ts(daysAgo)).lastInsertRowid);
    if (done === "design") {
      const panels = Math.ceil((kw * 1000) / 540), invKw = kw >= 400 ? 100 : 50, invN = Math.ceil(kw / invKw);
      const did = Number(db.prepare("INSERT INTO designs (task_id,lead_id,capacity_kw,panel_brand,panel_wp,panel_count,inverter_brand,inverter_kw,inverter_count,structure,est_annual_kwh,tech_notes,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'COMPLETED')").run(tid, leadId, kw, pick(["Waaree", "Adani", "Vikram"]), 540, panels, pick(["Sungrow", "Huawei"]), invKw, invN, "Hot-dip galvanised MMS, 10° tilt", Math.round(kw * 1440), "String design verified; ACDB/DCDB with SPD.").lastInsertRowid);
      const bid = Number(db.prepare("INSERT INTO boqs (design_id,lead_id) VALUES (?,?)").run(did, leadId).lastInsertRowid);
      boqRows(kw, panels, invKw, invN).forEach((r) => db.prepare("INSERT INTO boq_items (boq_id,category,description,spec,qty,unit,unit_cost) VALUES (?,?,?,?,?,?,?)").run(bid, r.category, r.description, r.spec, r.qty, r.unit, r.unit_cost));
    }
    return { sid, tid };
  };

  const boqRows = (kw: number, panels: number, invKw: number, invN: number) => [
    { category: "Panels", description: "Solar PV modules", spec: "540 Wp mono PERC, Tier-1", qty: panels, unit: "nos", unit_cost: 12600 },
    { category: "Inverters", description: "String inverter", spec: `${invKw} kW, 3-phase, IP66`, qty: invN, unit: "nos", unit_cost: Math.round(invKw * 3900) },
    { category: "Structure", description: "Mounting structure", spec: "HDG, wind load 150 km/h", qty: kw, unit: "kWp", unit_cost: 3300 },
    { category: "Cables", description: "DC/AC cables, conduits & BOS", spec: "Polycab / equivalent", qty: kw, unit: "kWp", unit_cost: 4200 },
    { category: "Electrical", description: "ACDB, DCDB, earthing, LA, monitoring", spec: "As per design", qty: 1, unit: "lot", unit_cost: Math.round(kw * 2100) },
    { category: "Installation", description: "Installation, testing & commissioning", spec: "Turnkey", qty: kw, unit: "kWp", unit_cost: 3800 },
  ];

  const mkProposal = (leadId: number, custId: number, kw: number, custName: string, city: string, status: string, versions: number, daysAgo: number, terms = DEFAULT_SETTINGS.payment_templates[0].milestones) => {
    const panels = Math.ceil((kw * 1000) / 540), invKw = kw >= 400 ? 100 : 50, invN = Math.ceil(kw / invKw);
    const rows = boqRows(kw, panels, invKw, invN);
    const code = counter(db, "PROP");
    const pid = Number(db.prepare("INSERT INTO proposals (code,lead_id,customer_id,template_id,current_version,status,created_at) VALUES (?,?,?,?,?,?,?)").run(code, leadId, custId, tplId, versions, status, ts(daysAgo)).lastInsertRowid);
    let total = 0;
    for (let v = 1; v <= versions; v++) {
      const items = rows.map((r) => ({ description: r.description, spec: r.spec, qty: r.qty, unit: r.unit, rate: Math.round(r.unit_cost * (1 + 0.18 - (v - 1) * 0.03)) }));
      const pr = computePricing(items, 0, DEFAULT_SETTINGS.taxes);
      total = pr.total;
      const vars = { company_name: "ViryaSys Technologies", customer_name: custName, contact_person: (db.prepare("SELECT ct.name FROM contacts ct JOIN leads l ON l.contact_id = ct.id WHERE l.id = ?").get(leadId) as any)?.name ?? "Sir/Madam", site_location: city, system_capacity: kw >= 1000 ? `${kw / 1000} MW` : `${kw} kW`, panel_brand: "Waaree", panel_details: `${panels} × 540 Wp`, inverter_brand: "Sungrow", inverter_details: `${invN} × ${invKw} kW`, estimated_generation: `${new Intl.NumberFormat("en-IN").format(Math.round(kw * 1440))} kWh / year`, project_value: inr(pr.subtotal - pr.discount), tax: inr(pr.tax), total_value: inr(pr.total), payment_terms: terms.map((t) => `${t.pct}% ${t.name}`).join(" / "), validity: fmtDate(day(30)), proposal_date: fmtDMY(ts(daysAgo)), proposal_no: code, version: `V${v}` };
      const approval = v < versions ? "SENT" : status === "ACCEPTED" ? "ACCEPTED" : ["SENT", "NEGOTIATION"].includes(status) ? "SENT" : status === "APPROVED" ? "APPROVED" : "DRAFT";
      const vid = Number(db.prepare("INSERT INTO proposal_versions (proposal_id,version,sections,variables,subtotal,discount,tax,total,tax_breakdown,payment_terms,note,created_by,approval_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(pid, v, JSON.stringify(DEFAULT_TEMPLATE), JSON.stringify(vars), pr.subtotal, 0, pr.tax, pr.total, JSON.stringify(DEFAULT_SETTINGS.taxes), JSON.stringify(terms), v === 1 ? "Initial proposal" : "Revised after customer negotiation", U.arun, approval, ts(daysAgo - (v - 1) * 2)).lastInsertRowid);
      items.forEach((i, n) => db.prepare("INSERT INTO proposal_items (version_id,description,spec,qty,unit,rate,sort) VALUES (?,?,?,?,?,?,?)").run(vid, i.description, i.spec, i.qty, i.unit, i.rate, n));
    }
    return { pid, total, code, terms, panels, invKw, invN };
  };

  /* ───────────── pipeline leads (18 recent) ───────────── */
  const featured: [string, string, number, string, string, number, number][] = [
    // name, city, kw, status, owner key, daysAgo, respSec
    ["ABC Textiles", "Coimbatore", 750, "PROPOSAL", "arun", 9, 70],
    ["Sri Lakshmi Warehousing", "Chennai", 1200, "NEGOTIATION", "divya", 14, 55],
    ["Kaveri Hospitals", "Madurai", 350, "DESIGN", "arun", 7, 95],
    ["GreenTech Industries", "Hosur", 2000, "SITE_SURVEY", "divya", 6, 41],
    ["Vijay Educational Trust", "Chengalpattu", 500, "SITE_VISIT", "arun", 5, 88],
    ["Thirumala Warehousing", "Sriperumbudur", 800, "QUALIFIED", "divya", 4, 60],
    ["Sakthi Spinning Mills", "Tirupur", 1500, "CONTACTED", "arun", 2, 100],
    ["Annai Foods", "Salem", 300, "CONTACTED", "divya", 1, 75],
  ];
  const leadMeta: Record<string, { id: number; cid: number; kw: number; city: string }> = {};
  featured.forEach(([name, city, kw, status, ownerKey, daysAgo, resp]) => {
    const c = mkCustomer(name, city);
    const lid = mkLead({ cid: c.cid, ctId: c.ctId, name, city, kw, status, owner: U[ownerKey], daysAgo, sla: "met", respSec: resp, source: pick(["website", "referral", "telegram"]) });
    leadMeta[name] = { id: lid, cid: c.cid, kw, city };
  });
  // fresh uncontacted leads → SLA running/breached
  const fresh: [string, string, number, string, number][] = [["Pioneer Packaging", "Hosur", 450, "arun", 0], ["Nila Hospitals", "Vellore", 250, "divya", 26], ["Ganga Cold Storage", "Erode", 600, "arun", 190]];
  fresh.forEach(([name, city, kw, ownerKey, minsAgo], i) => {
    const c = mkCustomer(name, city);
    const id = mkLead({ cid: c.cid, ctId: c.ctId, name, city, kw, status: "NEW", owner: U[ownerKey], daysAgo: 0, sla: "running", source: i === 0 ? "website" : "telegram" });
    db.prepare("UPDATE leads SET received_at = ?, first_response_at = NULL WHERE id = ?").run(sqlTime(addMinutes(NOW, -(minsAgo === 0 ? 0.6 : minsAgo))), id);
  });
  // extra pipeline volume (fills board, keeps pipeline value realistic)
  for (let i = 0; i < 10; i++) {
    const [a, b] = COMPANY_PARTS[40 + i];
    const name = `${a} ${b}`, city = pick(CITIES), kw = pick([200, 250, 300, 400, 500, 600, 800, 1000]);
    const c = mkCustomer(name, city);
    const status = pick(["NEW", "CONTACTED", "CONTACTED", "QUALIFIED", "QUALIFIED", "SITE_VISIT", "SITE_SURVEY", "PROPOSAL", "NEGOTIATION"]);
    mkLead({ cid: c.cid, ctId: c.ctId, name, city, kw, status, owner: U[pick(["arun", "divya"])], daysAgo: between(2, 25), sla: status === "NEW" ? "breached" : "met", respSec: between(30, 110) });
  }
  db.prepare("UPDATE leads SET first_response_at = NULL WHERE status = 'NEW' AND sla_status = 'breached'").run();
  // a couple of lost / on-hold leads
  ["Rathna Garments", "Balaji Tanneries"].forEach((name, i) => {
    const c = mkCustomer(name, pick(CITIES));
    const id = mkLead({ cid: c.cid, ctId: c.ctId, name, city: "Salem", kw: 300, status: i ? "ON_HOLD" : "LOST", owner: U.arun, daysAgo: 30 });
    if (!i) db.prepare("UPDATE leads SET lost_reason = 'Chose a competitor on price' WHERE id = ?").run(id);
  });

  // survey / design / proposal chain for featured leads
  const L = (n: string) => leadMeta[n];
  mkSurveyAndDesign(L("ABC Textiles").id, 750, "Coimbatore", "design", U.senthil, U.meena, 8);
  mkSurveyAndDesign(L("Sri Lakshmi Warehousing").id, 1200, "Chennai", "design", U.karthik, U.vignesh, 13);
  mkSurveyAndDesign(L("Kaveri Hospitals").id, 350, "Madurai", "task", U.senthil, U.meena, 6);
  mkSurveyAndDesign(L("GreenTech Industries").id, 2000, "Hosur", "task", U.karthik, U.vignesh, 5);
  db.prepare("UPDATE design_tasks SET status = 'IN_PROGRESS' WHERE lead_id = ?").run(L("Kaveri Hospitals").id);
  const abcP = mkProposal(L("ABC Textiles").id, L("ABC Textiles").cid, 750, "ABC Textiles", "Coimbatore", "DRAFT", 1, 2);
  const slwP = mkProposal(L("Sri Lakshmi Warehousing").id, L("Sri Lakshmi Warehousing").cid, 1200, "Sri Lakshmi Warehousing", "Chennai", "NEGOTIATION", 3, 11, DEFAULT_SETTINGS.payment_templates[1].milestones);
  void abcP; void slwP;
  db.prepare("INSERT INTO lead_activities (lead_id,type,summary,user_id,created_at) VALUES (?,?,?,?,?)").run(L("Sri Lakshmi Warehousing").id, "negotiation", "Customer requested price revision — asked for 4% discount and 70/30 terms", U.divya, ts(7));
  db.prepare("INSERT INTO lead_activities (lead_id,type,summary,user_id,created_at) VALUES (?,?,?,?,?)").run(L("Sri Lakshmi Warehousing").id, "negotiation", "Scope change: added monitoring gateway for each inverter", U.divya, ts(4));

  // upcoming site visits for leads in SITE_VISIT
  db.prepare("INSERT INTO site_visits (lead_id,scheduled_at,location,pm_id,designer_id,contact,status) VALUES (?,?,?,?,?,?,'SCHEDULED')").run(L("Vijay Educational Trust").id, `${day(1)} 10:30:00`, "Chengalpattu campus", U.senthil, U.meena, "Mr. Anand");
  db.prepare("INSERT INTO site_visits (lead_id,scheduled_at,location,pm_id,designer_id,contact,status) VALUES (?,?,?,?,?,?,'SCHEDULED')").run(L("Thirumala Warehousing").id, `${day(3)} 14:00:00`, "Sriperumbudur yard", U.karthik, U.vignesh, "Mr. Selvam");
  db.prepare("UPDATE leads SET status='SITE_VISIT' WHERE id = ?").run(L("Thirumala Warehousing").id);

  // follow-ups
  const fu: [string, string, number, string][] = [["Sakthi Spinning Mills", "Send site visit slots", -1, "arun"], ["Annai Foods", "Call back with capacity options", 0, "divya"], ["Thirumala Warehousing", "Confirm decision-maker meeting", 0, "divya"], ["Vijay Educational Trust", "Collect last 12 months EB bills", 1, "arun"], ["ABC Textiles", "Walk customer through proposal V1", 2, "arun"], ["Kaveri Hospitals", "Follow up on structural drawing", -2, "arun"]];
  fu.forEach(([n, t, off, o]) => db.prepare("INSERT INTO lead_tasks (lead_id,title,due_at,assignee_id,status) VALUES (?,?,?,?, 'open')").run(L(n)?.id ?? leadMeta["ABC Textiles"].id, t, `${day(off)} 11:00:00`, U[o]));
  db.prepare("INSERT INTO lead_tasks (lead_id,title,due_at,assignee_id,status) VALUES (?,?,?,?, 'done')").run(L("Annai Foods").id, "Intro call", `${day(-1)} 10:00:00`, U.divya);

  /* ───────────── projects: 62 active + 8 completed ───────────── */
  const STAGES = ["PLANNING", "DESIGN", "PROCUREMENT", "MATERIAL_DELIVERY", "INSTALLATION", "COMMISSIONING", "METERING", "HANDOVER"];
  const stageDays = [3, 8, 24, 38, 55, 62, 72, 78, 80];
  const tasksBy: Record<string, string[]> = {
    PLANNING: ["Kickoff call with customer", "Confirm site access & permissions"], DESIGN: ["Freeze single-line diagram", "Utility / DISCOM approval submitted"], PROCUREMENT: ["All purchase orders confirmed"], MATERIAL_DELIVERY: ["All materials received & inspected"],
    INSTALLATION: ["Structure erection", "Panel mounting", "Inverter & wiring"], COMMISSIONING: ["Electrical completion checks", "System testing & performance run", "Final safety checks"], METERING: ["Meter installation / bidirectional meter", "Utility approval & documentation"], HANDOVER: ["Customer training", "Handover documents issued"],
  };
  const HAND = ["Installation completed", "Commissioning completed", "Metering completed", "Documentation completed", "Customer training", "App setup", "Handover documents", "Customer acknowledgement"];
  const STEPS = ["Structure", "Panels", "Inverter", "Wiring", "Testing"];
  // Stage distribution for 62 active (27 in "execution": procurement→metering).
  const dist: [string, number][] = [["PLANNING", 8], ["DESIGN", 11], ["PROCUREMENT", 7], ["MATERIAL_DELIVERY", 6], ["INSTALLATION", 8], ["COMMISSIONING", 3], ["METERING", 3], ["HANDOVER", 16]];
  const stageList: string[] = dist.flatMap(([s, n]) => Array(n).fill(s));
  const totalProjects = stageList.length + 8; // + completed
  const delayedIdx = new Set([3, 14, 22, 30, 41]); // 5 delayed projects
  const projectRefs: { id: number; stage: string; kw: number; code: string; proposalId: number; custId: number; age: number; idx: number }[] = [];

  for (let i = 0; i < totalProjects; i++) {
    const stage = i < stageList.length ? stageList[i] : "COMPLETED";
    const [a, b] = COMPANY_PARTS[i % COMPANY_PARTS.length];
    const name = i >= COMPANY_PARTS.length ? `${a} ${b} II` : `${a} ${b}`;
    const city = pick(CITIES);
    const kw = pick([100, 150, 200, 250, 350, 400, 500, 650, 750, 1000, 1200, 1500]);
    const c = mkCustomer(name, city);
    const DUE = [0, 3, 8, 24, 38, 55, 62, 72, 78, 80];
    const curIdx = stage === "COMPLETED" ? 9 : STAGES.indexOf(stage) + 1;
    // Age lands inside the current stage's window, early enough that nothing is overdue by accident.
    const age = stage === "COMPLETED" ? between(110, 240) : DUE[curIdx - 1] + Math.max(1, Math.round((DUE[curIdx] - DUE[curIdx - 1]) * (0.1 + R() * 0.4)));
    const lid = mkLead({ cid: c.cid, ctId: c.ctId, name, city, kw, status: "WON", owner: U[pick(["arun", "divya"])], daysAgo: age + 20, respSec: between(30, 110) });
    const pm = U[pick(["senthil", "karthik"])], designer = U[pick(["meena", "vignesh"])];
    const { sid } = mkSurveyAndDesign(lid, kw, city, "design", pm, designer, age + 16);
    void sid;
    const pt = pick([DEFAULT_SETTINGS.payment_templates[0], DEFAULT_SETTINGS.payment_templates[1], DEFAULT_SETTINGS.payment_templates[2]]).milestones;
    const prop = mkProposal(lid, c.cid, kw, name, city, "ACCEPTED", 1, age + 8, pt);
    const created = ts(age);
    const stageIdx = stage === "COMPLETED" ? 9 : STAGES.indexOf(stage) + 1; // index into PROJECT_STAGES (PLANNING=1)
    const pcode = counter(db, "PROJ");
    const design = db.prepare("SELECT * FROM designs WHERE lead_id = ?").get(lid) as any;
    const pid = Number(
      db.prepare(
        `INSERT INTO projects (code,lead_id,customer_id,proposal_id,name,capacity_kw,site,city,pm_id,designer_id,stage,health,value,start_date,target_end,install_progress,equipment,created_at,completed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'ON_TRACK',?,?,?,?,?,?,?)`
      ).run(pcode, lid, c.cid, prop.pid, `${name} — ${kw >= 1000 ? kw / 1000 + " MW" : kw + " kW"}`, kw, `${city} industrial estate`, city, pm, designer, stage, prop.total, day(-age), day(80 - age), stage === "INSTALLATION" ? between(30, 85) : ["COMMISSIONING", "METERING", "HANDOVER", "COMPLETED"].includes(stage) ? 100 : 0, JSON.stringify({ panels: `${design.panel_brand} ${design.panel_count}×540Wp`, inverters: `${design.inverter_brand} ${design.inverter_count}×${design.inverter_kw}kW` }), created, stage === "COMPLETED" ? ts(age - 80) : null).lastInsertRowid
    );
    // milestones
    const ALLS = ["PROJECT_CREATED", "PLANNING", "DESIGN", "PROCUREMENT", "MATERIAL_DELIVERY", "INSTALLATION", "COMMISSIONING", "METERING", "HANDOVER", "COMPLETED"];
    const names = ["Project created", "Planning & kickoff", "Final design & approvals", "Procurement", "Material delivery", "Installation", "Commissioning & testing", "Net metering", "Handover", "Completed"];
    const cur = ALLS.indexOf(stage);
    ALLS.forEach((s, n) => {
      const due = day(stageDays[Math.max(0, n - 1)] * (n === 0 ? 0 : 1) - age);
      const status = n < cur ? "DONE" : n === cur ? (s === "COMPLETED" ? "DONE" : "CURRENT") : "UPCOMING";
      db.prepare("INSERT INTO project_milestones (project_id,stage,name,owner_id,due_date,done_at,status,sort) VALUES (?,?,?,?,?,?,?,?)").run(pid, s, names[n], pm, n === 0 ? day(-age) : day(([0, 3, 8, 24, 38, 55, 62, 72, 78, 80][n]) - age), status === "DONE" ? ts(Math.max(0, age - n * 5)) : null, status, n);
      (tasksBy[s] ?? []).forEach((t) => db.prepare("INSERT INTO project_tasks (project_id,stage,title,assignee_id,due_date,status) VALUES (?,?,?,?,?,?)").run(pid, s, t, pm, day(([0, 3, 8, 24, 38, 55, 62, 72, 78, 80][n]) - age), n < cur ? "done" : "open"));
    });
    // installation steps + handover
    const inst = stage === "INSTALLATION" ? between(30, 85) : cur > 5 ? 100 : 0;
    STEPS.forEach((s, n) => db.prepare("INSERT INTO install_steps (project_id,name,pct,sort) VALUES (?,?,?,?)").run(pid, s, cur > 5 ? 100 : stage === "INSTALLATION" ? Math.max(0, Math.min(100, Math.round(inst * 5 - n * 100 + between(-10, 10)))) : 0, n));
    db.prepare("UPDATE projects SET install_progress = ? WHERE id = ?").run(inst, pid);
    HAND.forEach((h, n) => db.prepare("INSERT INTO handover_items (project_id,label,done,sort) VALUES (?,?,?,?)").run(pid, h, stage === "COMPLETED" || (stage === "HANDOVER" && n < between(2, 6)) ? 1 : 0, n));
    db.prepare("INSERT INTO project_activities (project_id,type,summary,user_id,customer_visible,created_at) VALUES (?,?,?,?,1,?)").run(pid, "created", `Project ${pcode} created from proposal ${prop.code}`, U.senthil, created);
    if (cur >= 3) db.prepare("INSERT INTO project_activities (project_id,type,summary,user_id,customer_visible,created_at) VALUES (?,?,?,?,1,?)").run(pid, "stage", `Stage moved: DESIGN → ${stage}`, pm, ts(Math.max(0, age - 20)));
    if (stage === "INSTALLATION") db.prepare("INSERT INTO installation_logs (project_id,log_date,team,workers,work_done,progress_pct,issues,user_id) VALUES (?,?,?,?,?,?,?,?)").run(pid, day(-1), "Team A", between(8, 16), "Panel mounting on rows 4–9, DC stringing", inst, null, pm);

    // payments + invoices
    const pays = computePayments(prop.terms, prop.total);
    const paidUpTo = stage === "PLANNING" || stage === "DESIGN" ? (i % 3 === 0 ? 0 : 1) : ["PROCUREMENT", "MATERIAL_DELIVERY", "INSTALLATION"].includes(stage) ? 1 : ["COMMISSIONING", "METERING"].includes(stage) ? 1 : stage === "HANDOVER" ? 2 : 2;
    pays.forEach((m, n) => {
      const paid = n < paidUpTo || stage === "COMPLETED";
      const mid = Number(db.prepare("INSERT INTO payment_milestones (project_id,name,pct,amount,status,sort) VALUES (?,?,?,?,?,?)").run(pid, m.name, m.pct, m.amount, "PENDING", n).lastInsertRowid);
      const shouldInvoice = paid || n === 0 || (n === 1 && cur >= 6);
      if (shouldInvoice) {
        const tax = Math.round((m.amount * 18) / 118), amt = m.amount - tax;
        const invDate = day(-Math.max(1, age - n * 40));
        const status = paid ? "PAID" : n === 0 ? "DRAFT" : "SENT";
        const iid = Number(db.prepare("INSERT INTO invoices (code,project_id,customer_id,milestone_id,amount,tax,total,status,issued_on,due_on,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(counter(db, "INV"), pid, c.cid, mid, amt, tax, m.amount, status, status === "DRAFT" ? null : invDate, status === "DRAFT" ? null : dateOnly(addDays(new Date(invDate), 15)), ts(age)).lastInsertRowid);
        db.prepare("UPDATE payment_milestones SET invoice_id = ?, status = ? WHERE id = ?").run(iid, paid ? "PAID" : status === "DRAFT" ? "INVOICE_DRAFT" : "INVOICED", mid);
        if (paid) db.prepare("INSERT INTO payments (invoice_id,project_id,amount,received_on,mode,reference,recorded_by) VALUES (?,?,?,?,?,?,?)").run(iid, pid, m.amount, invDate, pick(["NEFT", "RTGS", "Cheque"]), `UTR${between(100000, 999999)}`, U.lakshmi);
      }
    });
    projectRefs.push({ id: pid, stage, kw, code: pcode, proposalId: prop.pid, custId: c.cid, age, idx: i });
    db.prepare("UPDATE projects SET engineer_id = ? WHERE id = ?").run(U[i % 2 ? "prakash" : "vimal"], pid);
  }
  // Historical enquiries that didn't convert, so win-rate and source statistics are realistic.
  for (let i = 0; i < 34; i++) {
    const [a, b] = COMPANY_PARTS[(i * 2 + 5) % COMPANY_PARTS.length];
    const name = `${a} ${b} Enterprises`, city = pick(CITIES), kw = pick([100, 150, 200, 300, 400, 500]);
    const c = mkCustomer(name, city);
    const lid = mkLead({ cid: c.cid, ctId: c.ctId, name, city, kw, status: i % 6 === 0 ? "ON_HOLD" : i % 3 === 0 ? "DISQUALIFIED" : "LOST", owner: U[pick(["arun", "divya"])], daysAgo: between(10, 120), respSec: between(40, 200) });
    db.prepare("UPDATE leads SET lost_reason = ? WHERE id = ?").run(pick(["Chose a competitor on price", "Customer postponed the project", "Roof not suitable", "Budget not approved"]), lid);
  }

  // Fix the "advance pending" edge: projects at PROCUREMENT+ must have advance paid (already ensured). Force paidUpTo>=1 for those.
  db.prepare(
    `UPDATE payment_milestones SET status='PAID' WHERE sort=0 AND status!='PAID' AND project_id IN (SELECT id FROM projects WHERE stage IN ('PROCUREMENT','MATERIAL_DELIVERY','INSTALLATION','COMMISSIONING','METERING','HANDOVER','COMPLETED'))`
  ).run();
  db.prepare(`UPDATE invoices SET status='PAID' WHERE milestone_id IN (SELECT id FROM payment_milestones WHERE status='PAID') AND status!='PAID'`).run();

  /* Delayed projects: overdue milestones / procurement slips */
  [...delayedIdx].forEach((idx, n) => {
    const p = projectRefs[idx];
    if (!p) return;
    const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(p.id) as any;
    if (["PLANNING", "DESIGN"].includes(pr.stage) || n % 2 === 0) db.prepare("UPDATE project_milestones SET due_date = ? WHERE project_id = ? AND status = 'CURRENT'").run(day(-(4 + n)), p.id);
  });

  /* ───────────── inbound AI messages ───────────── */
  const inbound: [string, string, string, string, number][] = [
    ["telegram", "@ravi_sales", "", "New warehouse lead.\nChennai.\n500kw.\nRavi contact.\nNeed rooftop solar.", 3],
    ["email", "purchase@coimbatoreauto.in", "Rooftop solar enquiry", "Hello, we are Kovai Auto Components Pvt Ltd in Coimbatore. We are looking at a 350 kWp rooftop solar plant for our factory. Please call Mr. Naveen on 9840123456.", 12],
    ["google_chat", "Divya Raman", "Sales space", "Vijay Educational Trust college campus in Chengalpattu wants around 500 kW solar. Contact Anand.", 28],
    ["website", "info@sundaramfasteners.in", "Website enquiry", "Company: Sundaram Fasteners Ltd\nContact Suresh Kumar\nPhone 9884456712\nEmail info@sundaramfasteners.in\nLocation Hosur\nCapacity 2 MW\nWe need a ground mount solar plant.", 55],
    ["telegram", "@mohan", "", "Lunch at 1? Also send the AMC checklist for Kaveri.", 75],
    ["voice", "Voice note (Arun)", "", "Got a lead from a school in Salem, they want solar, about 150 kilowatt, contact is Meena.", 100],
  ];
  const { ai } = require("../providers") as typeof import("../providers");
  inbound.forEach(([source, sender, subject, body, mins], i) => {
    const ex = ai.extractLead(body);
    const isLead = !!ex.fields.intent || !!ex.fields.capacity_kw;
    const status = !isLead ? "NOT_A_LEAD" : ex.confidence < 0.75 || ex.ambiguities.length ? "REVIEW" : "READY";
    const mid = Number(db.prepare("INSERT INTO inbound_messages (source,external_id,sender,subject,body,received_at,processing_status,ai_result,confidence) VALUES (?,?,?,?,?,?,?,?,?)").run(source, `seed-${i}`, sender, subject || null, body, sqlTime(addMinutes(NOW, -mins)), status, JSON.stringify(ex), ex.confidence).lastInsertRowid);
    db.prepare("INSERT INTO ai_extractions (message_id,kind,fields,confidence,provider) VALUES (?,?,?,?,?)").run(mid, "lead", JSON.stringify(ex), ex.confidence, ai.name);
    if (status === "REVIEW") db.prepare("INSERT INTO ai_reviews (message_id,field,ai_value,status) VALUES (?,?,?,'OPEN')").run(mid, ex.ambiguities[0]?.field ?? "confidence", null);
  });

  /* ───────────── customer queries, documents, notifications ───────────── */
  const someProjects = projectRefs.slice(0, 12);
  [["Inverter app not showing generation data", "high", "OPEN"], ["Request for structural stability certificate", "medium", "OPEN"], ["Invoice GST number correction", "low", "IN_PROGRESS"], ["Need cleaning schedule for panels", "low", "WAITING"], ["When will net-meter be installed?", "high", "OPEN"], ["Copy of warranty documents", "low", "RESOLVED"]].forEach(([s, pr, st], i) => {
    const p = someProjects[i * 2 % someProjects.length];
    const pmId = (db.prepare("SELECT pm_id FROM projects WHERE id = ?").get(p.id) as any).pm_id;
    db.prepare("INSERT INTO customer_queries (code,project_id,customer_id,subject,description,priority,assigned_to,status,due_date,resolution,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(counter(db, "QRY"), p.id, p.custId, s, "Raised through the customer portal.", pr, pmId, st, day(i % 2 ? 2 : -1), st === "RESOLVED" ? "Documents emailed to customer." : null, ts(i + 1));
  });
  const docTypes = ["Customer Documents", "EB Documents", "Site Survey", "Design", "BOQ", "Proposal", "Purchase Orders", "Invoices", "Installation", "Warranty"];
  projectRefs.slice(0, 14).forEach((p, i) => {
    const pr = db.prepare("SELECT lead_id FROM projects WHERE id = ?").get(p.id) as any;
    docTypes.slice(0, 4 + (i % 5)).forEach((t) => db.prepare("INSERT INTO documents (customer_id,lead_id,project_id,module,doc_type,name,file_path,customer_visible,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(p.custId, pr.lead_id, p.id, t.toLowerCase().split(" ")[0], t, `${t} — ${p.code}.pdf`, null, ["Proposal", "Design", "Invoices", "Warranty", "Installation"].includes(t) ? 1 : 0, U.senthil, ts(between(1, 40))));
  });

  const N = (role: RoleKey | null, uid: number | null, type: string, title: string, body: string, link: string, mins: number, read = 0) =>
    db.prepare("INSERT INTO notifications (user_id,role,type,title,body,link,is_read,created_at) VALUES (?,?,?,?,?,?,?,?)").run(uid, uid ? null : role, type, title, body, link, read, sqlTime(addMinutes(NOW, -mins)));
  N("md", null, "sla_breach", "SLA breached: Ganga Cold Storage", "No response within 2 minutes (owner: Arun Kumar)", "/crm/leads", 180);
  N("md", null, "procurement_delay", "Procurement delay: 100 kW string inverter (+2d)", "Waaree / Sungrow", "/procurement/deliveries", 240);
  N("md", null, "payment_received", "Payment received: ₹18,50,000 — advance", "NEFT", "/finance/payments", 400, 1);
  N("md", null, "project_delay", "5 projects are delayed", "Milestones overdue or procurement slipped", "/projects?health=DELAYED", 600);
  N(null, U.arun, "new_lead", "New lead: Pioneer Packaging", "450 kW · Hosur", "/crm/leads", 1);
  N(null, U.arun, "sla_warning", "SLA: 01:27 remaining — Pioneer Packaging", "Respond now", "/crm/leads", 1);
  N(null, U.meena, "task_assigned", "Design task: Kaveri Hospitals", "350 kW · Madurai", "/design", 500);
  N("procurement", null, "procurement_delay", "Delivery delayed: inverter (+2d)", "Update project team", "/procurement/deliveries", 240);
  N("finance", null, "proposal_approved", "Project won — raise advance invoice", "Sri Lakshmi Warehousing", "/finance/invoices", 900);

  /* ───────────── automation rules ───────────── */
  const rule = (name: string, trigger: string, actions: unknown[], conditions: unknown[] = []) =>
    db.prepare("INSERT INTO automation_rules (name,trigger,conditions,actions,runs) VALUES (?,?,?,?,?)").run(name, trigger, JSON.stringify(conditions), JSON.stringify(actions), 0);
  rule("New lead → assign, start SLA, notify", "lead.created", [{ type: "assign_salesperson" }, { type: "start_sla" }, { type: "notify", to: "owner", notif: "new_lead", title: "New lead: {title}", body: "Respond within the SLA — timer is running.", link: "{link}" }]);
  rule("SLA breached → escalate to MD", "lead.sla_breached", [{ type: "escalate_manager", title: "SLA breached: {lead_code}" }]);
  rule("Site survey completed → design task + notify designer", "survey.submitted", [{ type: "create_design_task" }]);
  rule("Proposal accepted → create project + payment schedule + notify PM", "proposal.accepted", [{ type: "create_project" }, { type: "generate_payment_schedule" }, { type: "notify", to: "pm", notif: "proposal_approved", title: "Project {project_code} created", body: "A new project has been assigned to you.", link: "/projects" }]);
  rule("Customer advance satisfied → enable procurement", "payment.advance_received", [{ type: "enable_procurement" }, { type: "notify", role: "procurement", notif: "task_assigned", title: "Procurement unlocked for {project_code}", link: "{link}" }]);
  rule("PO approved → send PO to vendor", "po.approved", [{ type: "send_po" }]);
  rule("Vendor confirmed → create expected delivery", "vendor.confirmed", [{ type: "create_expected_delivery" }]);
  rule("Delivery date passed, not received → notify procurement + PM (+MD if critical)", "delivery.overdue", [
    { type: "notify", role: "procurement", notif: "delivery_delay", title: "Delivery delayed: {title} ({days}d)", body: "Expected {expected}", link: "{link}" },
    { type: "notify", to: "pm", notif: "delivery_delay", title: "Material delayed: {title} ({days}d)", body: "Expected {expected}", link: "{link}" },
    { type: "notify", role: "md", when: "critical", notif: "delivery_delay", title: "Critical delay ({risk}): {title}", body: "Project impact", link: "{link}" }]);
  rule("Material received → create inspection task", "material.received", [{ type: "create_inspection_task" }]);
  rule("Inspection completed → generate GRN + delivery note", "inspection.completed", [{ type: "generate_grn" }]);
  rule("Customer acknowledgement → close delivery", "delivery.acknowledged", [{ type: "close_delivery" }]);
  rule("Project completed → request material return", "project.completed", [{ type: "request_material_return" }]);

  /* customer portal demo login: linked to a customer with a project under installation */
  const portalCust = db.prepare("SELECT customer_id FROM projects WHERE stage='INSTALLATION' ORDER BY id LIMIT 1").get() as any;
  if (portalCust) db.prepare("INSERT INTO users (name,email,password_hash,role,customer_id) VALUES (?,?,?,?,?)").run("Customer Demo", "customer@demo.in", pw, "customer", portalCust.customer_id);

  /* procurement history: driven through the real services on a simulated clock */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./seed-procurement").seedProcurement(db, { projectRefs, vendorIds, U });
  db.prepare("UPDATE notifications SET is_read = 1 WHERE created_at < datetime('now','-8 hours')").run();

  /* audit seed */
  db.prepare("INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,old_value,new_value,at) VALUES (?,?,?,?,?,?,?,?)").run(U.kishore, "Kishore", "changed project status", "project", projectRefs[9]?.code, "INSTALLATION", "COMMISSIONING", ts(0, 45));
  db.prepare("INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,old_value,new_value,at) VALUES (?,?,?,?,?,?,?,?)").run(U.divya, "Divya Raman", "sent proposal", "proposal", slwP.code, null, "V3", ts(4));
}
