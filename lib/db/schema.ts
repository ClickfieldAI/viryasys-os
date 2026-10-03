// Relational schema for ViryaSys OS. SQLite today; every table is plain SQL with
// integer PKs + human-readable `code` columns so it ports 1:1 to PostgreSQL/Supabase.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, gstin TEXT, address TEXT, phone TEXT, email TEXT);

CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL, customer_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS roles (key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS permissions (role TEXT NOT NULL, module TEXT NOT NULL, access TEXT NOT NULL, PRIMARY KEY (role, module));

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, industry TEXT,
  city TEXT, address TEXT, gstin TEXT, website TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT, email TEXT, designation TEXT, is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lead_sources (key TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id), contact_id INTEGER REFERENCES contacts(id),
  title TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', vertical TEXT, solar_type TEXT,
  capacity_kw REAL, city TEXT, owner_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'NEW', temperature TEXT NOT NULL DEFAULT 'warm', priority TEXT NOT NULL DEFAULT 'medium',
  est_value REAL, expected_close TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')), first_response_at TEXT,
  sla_seconds INTEGER NOT NULL DEFAULT 120, sla_status TEXT NOT NULL DEFAULT 'running',
  lost_reason TEXT, qualification TEXT, ai_summary TEXT, inbound_message_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL, summary TEXT NOT NULL, user_id INTEGER, meta TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_act_lead ON lead_activities(lead_id);
CREATE TABLE IF NOT EXISTS lead_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'follow_up', due_at TEXT, assignee_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lead_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL, user_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL, location TEXT, pm_id INTEGER, designer_id INTEGER, engineer_id INTEGER,
  contact TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS site_surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES site_visits(id), pm_id INTEGER,
  site_address TEXT, gps TEXT, site_type TEXT, roof_type TEXT, roof_area_sqm REAL, available_area_sqm REAL,
  orientation TEXT, shading TEXT, obstacles TEXT, structural TEXT, access TEXT, safety TEXT,
  eb_connection TEXT, sanctioned_load_kw REAL, monthly_kwh REAL, annual_kwh REAL, existing_infra TEXT, notes TEXT, details TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT', submitted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS site_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, survey_id INTEGER NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
  label TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'm'
);
CREATE TABLE IF NOT EXISTS site_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, survey_id INTEGER NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
  category TEXT NOT NULL, file_path TEXT NOT NULL, caption TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS design_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  survey_id INTEGER REFERENCES site_surveys(id), designer_id INTEGER, status TEXT NOT NULL DEFAULT 'PENDING',
  due_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS design_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE, task_id INTEGER, designer_id INTEGER NOT NULL,
  message TEXT, snapshot TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', sent_by INTEGER, sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL, project_id INTEGER, title TEXT NOT NULL,
  sheet TEXT NOT NULL, drawing TEXT NOT NULL, aerial_path TEXT, rev TEXT NOT NULL DEFAULT 'A', status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS layout_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, layout_id INTEGER NOT NULL REFERENCES layouts(id) ON DELETE CASCADE, rev TEXT NOT NULL, sheet TEXT NOT NULL, drawing TEXT NOT NULL,
  aerial_path TEXT, issued_by INTEGER, issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES design_tasks(id), lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  capacity_kw REAL, panel_brand TEXT, panel_wp REAL, panel_count INTEGER, inverter_brand TEXT, inverter_kw REAL, inverter_count INTEGER,
  structure TEXT, est_annual_kwh REAL, tech_notes TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS boqs (id INTEGER PRIMARY KEY AUTOINCREMENT, design_id INTEGER REFERENCES designs(id) ON DELETE CASCADE, lead_id INTEGER REFERENCES leads(id));
CREATE TABLE IF NOT EXISTS boq_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, boq_id INTEGER NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
  category TEXT NOT NULL, description TEXT NOT NULL, spec TEXT, qty REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'nos', unit_cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS solar_calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, inputs TEXT NOT NULL, outputs TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS proposal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sections TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, lead_id INTEGER NOT NULL REFERENCES leads(id),
  customer_id INTEGER REFERENCES customers(id), template_id INTEGER REFERENCES proposal_templates(id),
  current_version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS proposal_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, sections TEXT NOT NULL, variables TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  tax_breakdown TEXT, payment_terms TEXT, note TEXT, created_by INTEGER, approval_status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (proposal_id, version)
);
CREATE TABLE IF NOT EXISTS proposal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version_id INTEGER NOT NULL REFERENCES proposal_versions(id) ON DELETE CASCADE,
  description TEXT NOT NULL, spec TEXT, qty REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'nos', rate REAL NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS proposal_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES proposal_templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, lead_id INTEGER REFERENCES leads(id), customer_id INTEGER REFERENCES customers(id),
  proposal_id INTEGER REFERENCES proposals(id), name TEXT NOT NULL, capacity_kw REAL, site TEXT, city TEXT,
  pm_id INTEGER, designer_id INTEGER, engineer_id INTEGER,
  stage TEXT NOT NULL DEFAULT 'PROJECT_CREATED', health TEXT NOT NULL DEFAULT 'ON_TRACK', value REAL NOT NULL DEFAULT 0,
  start_date TEXT, target_end TEXT, install_progress INTEGER NOT NULL DEFAULT 0, equipment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, name TEXT NOT NULL, owner_id INTEGER, due_date TEXT, done_at TEXT, status TEXT NOT NULL DEFAULT 'UPCOMING', sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage TEXT, title TEXT NOT NULL, assignee_id INTEGER, due_date TEXT, status TEXT NOT NULL DEFAULT 'open', depends_on INTEGER
);
CREATE TABLE IF NOT EXISTS project_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, summary TEXT NOT NULL, user_id INTEGER, customer_visible INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS installation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL, team TEXT, workers INTEGER, work_done TEXT, progress_pct INTEGER, issues TEXT, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS install_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, pct INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS handover_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);

/* ───────── Procurement & Material Control ─────────
   History is append-only: promises, confirmations, inspections, ledger and activity are never overwritten. */
CREATE TABLE IF NOT EXISTS material_categories (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, criticality TEXT NOT NULL DEFAULT 'medium', milestone_stage TEXT,
  serialized INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS material_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, spec TEXT, unit TEXT NOT NULL DEFAULT 'nos', rate REAL NOT NULL DEFAULT 0, tax_pct REAL NOT NULL DEFAULT 18, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT, categories TEXT, products TEXT,
  city TEXT, address TEXT, gstin TEXT, contact TEXT, phone TEXT, email TEXT, payment_terms TEXT, rating REAL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customer_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, project_id INTEGER UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id INTEGER, proposal_id INTEGER, order_value REAL NOT NULL, subtotal REAL NOT NULL DEFAULT 0, required_advance_pct REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'APPROVED', approved_by INTEGER, approved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS procurement_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'AUTHORIZED',
  start_date TEXT, target_install TEXT, template TEXT, authorized_by INTEGER, authorized_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS procurement_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL REFERENCES procurement_plans(id) ON DELETE CASCADE, name TEXT NOT NULL,
  required_date TEXT, sort INTEGER NOT NULL DEFAULT 0, depends_on INTEGER
);
CREATE TABLE IF NOT EXISTS material_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, plan_id INTEGER, stage_id INTEGER,
  category TEXT NOT NULL, name TEXT NOT NULL, spec TEXT, qty REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'nos', required_date TEXT,
  est_unit_cost REAL NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'BOQ', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_req_project ON material_requirements(project_id);
CREATE TABLE IF NOT EXISTS purchase_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id), stage_id INTEGER, requirement_id INTEGER,
  material TEXT NOT NULL, spec TEXT, category TEXT, qty REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'nos', required_by TEXT, priority TEXT NOT NULL DEFAULT 'NORMAL',
  preferred_vendor_id INTEGER, notes TEXT, status TEXT NOT NULL DEFAULT 'OPEN', po_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, version INTEGER NOT NULL DEFAULT 1, project_id INTEGER REFERENCES projects(id), vendor_id INTEGER REFERENCES vendors(id),
  stage_id INTEGER, status TEXT NOT NULL DEFAULT 'DRAFT', po_date TEXT, required_date TEXT, billing_address TEXT, delivery_address TEXT, payment_terms TEXT, delivery_terms TEXT, notes TEXT,
  subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, owner_id INTEGER, submitted_at TEXT, approved_by INTEGER, approved_at TEXT,
  sent_at TEXT, cancelled_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, requirement_id INTEGER, request_id INTEGER, category TEXT,
  description TEXT NOT NULL, spec TEXT, qty REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'nos', rate REAL NOT NULL DEFAULT 0, tax_pct REAL NOT NULL DEFAULT 18, required_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_poi_req ON purchase_order_items(requirement_id);
CREATE TABLE IF NOT EXISTS vendor_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, po_item_id INTEGER NOT NULL, status TEXT NOT NULL,
  confirmed_qty REAL NOT NULL DEFAULT 0, expected_date TEXT, expected_time TEXT, remarks TEXT, recorded_by INTEGER, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vc_item ON vendor_confirmations(po_item_id);
CREATE TABLE IF NOT EXISTS vendor_delivery_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, po_item_id INTEGER NOT NULL, seq INTEGER NOT NULL, promised_date TEXT NOT NULL, expected_time TEXT, reason TEXT,
  source TEXT NOT NULL DEFAULT 'CONFIRMATION', recorded_by INTEGER, at TEXT NOT NULL, UNIQUE (po_item_id, seq)
);
CREATE TABLE IF NOT EXISTS vendor_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, amount REAL NOT NULL, paid_on TEXT NOT NULL,
  mode TEXT, reference TEXT, note TEXT, recorded_by INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, project_id INTEGER, vendor_id INTEGER,
  status TEXT NOT NULL DEFAULT 'READY_FOR_DISPATCH', expected_date TEXT, dispatched_at TEXT, vehicle TEXT, driver TEXT, site TEXT, notes TEXT,
  received_at TEXT, closed_at TEXT, created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_del_po ON deliveries(po_id);
CREATE INDEX IF NOT EXISTS idx_del_status ON deliveries(status);
CREATE TABLE IF NOT EXISTS delivery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, po_item_id INTEGER NOT NULL,
  qty_dispatched REAL NOT NULL, qty_received REAL NOT NULL DEFAULT 0, qty_accepted REAL NOT NULL DEFAULT 0, qty_damaged REAL NOT NULL DEFAULT 0,
  qty_rejected REAL NOT NULL DEFAULT 0, qty_short REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_di_item ON delivery_items(po_item_id);
CREATE INDEX IF NOT EXISTS idx_di_del ON delivery_items(delivery_id);
CREATE TABLE IF NOT EXISTS material_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, delivery_id INTEGER UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, received_by TEXT, vehicle TEXT, driver TEXT,
  notes TEXT, received_at TEXT NOT NULL, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS material_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, inspector_id INTEGER, inspector_name TEXT,
  result TEXT NOT NULL, remarks TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inspection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inspection_id INTEGER NOT NULL REFERENCES material_inspections(id) ON DELETE CASCADE, delivery_item_id INTEGER NOT NULL,
  spec_match INTEGER NOT NULL DEFAULT 1, qty_match INTEGER NOT NULL DEFAULT 1, condition TEXT, packaging TEXT, serials TEXT, remarks TEXT,
  qty_received REAL NOT NULL DEFAULT 0, qty_accepted REAL NOT NULL DEFAULT 0, qty_damaged REAL NOT NULL DEFAULT 0, qty_rejected REAL NOT NULL DEFAULT 0, qty_short REAL NOT NULL DEFAULT 0, result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, delivery_id INTEGER UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, inspection_id INTEGER, po_id INTEGER,
  project_id INTEGER, vendor_id INTEGER, inspector_name TEXT, remarks TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, delivery_id INTEGER UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, project_id INTEGER, customer_id INTEGER,
  received_by TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, dn_id INTEGER, customer_name TEXT NOT NULL,
  signature TEXT, remarks TEXT, photo_path TEXT, via TEXT NOT NULL DEFAULT 'site', recorded_by INTEGER, ack_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS serial_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, po_id INTEGER, vendor_id INTEGER, delivery_item_id INTEGER, material TEXT NOT NULL, model TEXT, brand TEXT,
  serial TEXT UNIQUE NOT NULL, received_on TEXT, installed_on TEXT, location TEXT, warranty_months INTEGER
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, requirement_id INTEGER, material TEXT NOT NULL, unit TEXT, type TEXT NOT NULL,
  qty REAL NOT NULL, store_delta REAL NOT NULL DEFAULT 0, site_delta REAL NOT NULL DEFAULT 0, ref_type TEXT, ref_id INTEGER, ref_code TEXT, note TEXT, user_id INTEGER, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_itx_proj ON inventory_transactions(project_id, requirement_id);
CREATE TABLE IF NOT EXISTS material_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL, requirement_id INTEGER NOT NULL, qty REAL NOT NULL, issued_by TEXT, received_by TEXT,
  purpose TEXT, install_stage TEXT, at TEXT NOT NULL, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS material_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, requirement_id INTEGER NOT NULL, qty REAL NOT NULL, note TEXT, user_id INTEGER, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS material_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL, requirement_id INTEGER NOT NULL, qty REAL NOT NULL, condition TEXT, returned_by TEXT,
  received_by TEXT, reason TEXT, at TEXT NOT NULL, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS procurement_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, key TEXT UNIQUE, type TEXT NOT NULL, severity TEXT NOT NULL, project_id INTEGER, po_id INTEGER, requirement_id INTEGER,
  material TEXT, vendor_id INTEGER, owner_id INTEGER, due_date TEXT, status TEXT NOT NULL DEFAULT 'OPEN', resolution TEXT, detail TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_exc_status ON procurement_exceptions(status);
CREATE TABLE IF NOT EXISTS procurement_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, project_id INTEGER, po_id INTEGER, link TEXT,
  severity TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS procurement_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, po_id INTEGER, delivery_id INTEGER, doc_type TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT, uploaded_by INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS procurement_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, po_id INTEGER, delivery_id INTEGER, type TEXT NOT NULL, summary TEXT NOT NULL, meta TEXT, user_id INTEGER, user_name TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pal_po ON procurement_activity_logs(po_id);
CREATE INDEX IF NOT EXISTS idx_pal_proj ON procurement_activity_logs(project_id);
CREATE TABLE IF NOT EXISTS zoho_sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, ref TEXT, payload TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT
);
CREATE TABLE IF NOT EXISTS zoho_event_mappings (
  event_type TEXT PRIMARY KEY, label TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, approved_by TEXT, approved_at TEXT, note TEXT
);
-- Immutability: the ledger and every history table can only be appended to.
CREATE TRIGGER IF NOT EXISTS itx_no_update BEFORE UPDATE ON inventory_transactions BEGIN SELECT RAISE(ABORT, 'inventory transactions are immutable — post a correcting transaction'); END;
CREATE TRIGGER IF NOT EXISTS itx_no_delete BEFORE DELETE ON inventory_transactions BEGIN SELECT RAISE(ABORT, 'inventory transactions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS pal_no_update BEFORE UPDATE ON procurement_activity_logs BEGIN SELECT RAISE(ABORT, 'activity log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS pal_no_delete BEFORE DELETE ON procurement_activity_logs BEGIN SELECT RAISE(ABORT, 'activity log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vdu_no_update BEFORE UPDATE ON vendor_delivery_updates BEGIN SELECT RAISE(ABORT, 'delivery promise history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vdu_no_delete BEFORE DELETE ON vendor_delivery_updates BEGIN SELECT RAISE(ABORT, 'delivery promise history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vc_no_update BEFORE UPDATE ON vendor_confirmations BEGIN SELECT RAISE(ABORT, 'vendor confirmations are append-only'); END;

CREATE TABLE IF NOT EXISTS payment_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, pct REAL NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', invoice_id INTEGER, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, project_id INTEGER REFERENCES projects(id), customer_id INTEGER REFERENCES customers(id),
  milestone_id INTEGER REFERENCES payment_milestones(id), amount REAL NOT NULL, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', issued_on TEXT, due_on TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER REFERENCES invoices(id), project_id INTEGER REFERENCES projects(id),
  amount REAL NOT NULL, received_on TEXT NOT NULL, mode TEXT, reference TEXT, recorded_by INTEGER
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, lead_id INTEGER, project_id INTEGER, module TEXT NOT NULL,
  doc_type TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT, customer_visible INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customer_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, project_id INTEGER REFERENCES projects(id), customer_id INTEGER REFERENCES customers(id),
  subject TEXT NOT NULL, description TEXT, priority TEXT NOT NULL DEFAULT 'medium', assigned_to INTEGER, status TEXT NOT NULL DEFAULT 'OPEN',
  due_date TEXT, resolution TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_name TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  old_value TEXT, new_value TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, proposal_id INTEGER REFERENCES proposals(id), lead_id INTEGER, to_addr TEXT, cc TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
  attachments TEXT, status TEXT NOT NULL, error TEXT, trigger TEXT, sent_at TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inbound_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT, sender TEXT, subject TEXT, body TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')), raw_data TEXT, processing_status TEXT NOT NULL DEFAULT 'PENDING',
  ai_result TEXT, confidence REAL, linked_entity TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_ext ON inbound_messages(source, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ai_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER REFERENCES inbound_messages(id), kind TEXT NOT NULL, fields TEXT NOT NULL,
  confidence REAL NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER REFERENCES inbound_messages(id), field TEXT NOT NULL,
  ai_value TEXT, human_value TEXT, status TEXT NOT NULL DEFAULT 'OPEN', reviewer_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, trigger TEXT NOT NULL, conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, runs INTEGER NOT NULL DEFAULT 0, last_run_at TEXT
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER, trigger TEXT NOT NULL, context TEXT, result TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
