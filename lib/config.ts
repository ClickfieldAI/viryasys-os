// Shared domain constants: roles, RBAC matrix, lifecycle stages, status vocabularies.

export type RoleKey = "md" | "admin" | "sales" | "pm" | "designer" | "procurement" | "finance" | "site_engineer" | "warehouse" | "customer";
export type Access = "w" | "r";
export type ModuleKey =
  | "dashboard" | "crm" | "ai" | "survey" | "design" | "proposals" | "projects"
  | "procurement" | "receiving" | "finance" | "documents" | "queries" | "analytics" | "automation" | "system" | "portal";

export const ROLES: Record<RoleKey, { name: string; description: string }> = {
  md: { name: "MD / Owner", description: "Complete visibility across the business" },
  admin: { name: "Admin", description: "System configuration, users and permissions" },
  sales: { name: "Sales", description: "CRM, leads, proposals, follow-ups" },
  pm: { name: "Project Manager", description: "Projects, site surveys, installation, customer" },
  designer: { name: "Designer", description: "Assigned design tasks, site survey inputs, technical documents" },
  procurement: { name: "Procurement", description: "BOQ, vendors, purchase orders, deliveries" },
  finance: { name: "Finance", description: "Invoices, payments, financial records, PO approval, accounting integration" },
  site_engineer: { name: "Site Engineer", description: "Assigned project deliveries: receive, inspect and acknowledge material" },
  warehouse: { name: "Warehouse / Store", description: "Material receipt, issue, return and stock" },
  customer: { name: "Customer", description: "Customer portal only" },
};

const ALL_R: ModuleKey[] = ["dashboard", "crm", "ai", "survey", "design", "proposals", "projects", "procurement", "receiving", "finance", "documents", "queries", "analytics", "automation", "system"];

function matrix(w: ModuleKey[], r: ModuleKey[]): Partial<Record<ModuleKey, Access>> {
  const m: Partial<Record<ModuleKey, Access>> = {};
  r.forEach((k) => (m[k] = "r"));
  w.forEach((k) => (m[k] = "w"));
  return m;
}

export const RBAC: Record<RoleKey, Partial<Record<ModuleKey, Access>>> = {
  md: matrix([...ALL_R], []),
  admin: matrix(["system", "dashboard"], ALL_R),
  sales: matrix(["crm", "ai", "proposals", "documents", "queries", "dashboard"], ["survey", "design", "projects", "procurement"]),
  pm: matrix(["projects", "survey", "queries", "documents", "dashboard", "receiving"], ["crm", "design", "procurement", "proposals"]),
  designer: matrix(["design", "dashboard"], ["survey", "documents", "proposals"]),
  procurement: matrix(["procurement", "receiving", "dashboard", "documents"], ["projects", "design"]),
  finance: matrix(["finance", "dashboard"], ["projects", "proposals", "documents", "procurement"]),
  site_engineer: matrix(["receiving", "dashboard", "documents"], ["procurement", "projects"]),
  warehouse: matrix(["receiving", "dashboard"], ["procurement", "projects"]),
  customer: { portal: "w" },
};

export function can(role: RoleKey, module: ModuleKey, need: Access = "r"): boolean {
  const a = RBAC[role]?.[module];
  if (!a) return false;
  return need === "r" ? true : a === "w";
}

export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT", "SITE_SURVEY", "DESIGN", "PROPOSAL", "NEGOTIATION", "WON"] as const;
export const LEAD_SIDE = ["LOST", "ON_HOLD", "DISQUALIFIED"] as const;
export const ALL_LEAD_STATUSES = [...LEAD_STAGES, ...LEAD_SIDE] as const;

export const PROJECT_STAGES = ["PROJECT_CREATED", "PLANNING", "DESIGN", "PROCUREMENT", "MATERIAL_DELIVERY", "INSTALLATION", "COMMISSIONING", "METERING", "HANDOVER", "COMPLETED"] as const;

export const LEAD_SOURCES: Record<string, string> = {
  website: "Website", email: "Email", google_chat: "Google Chat", telegram: "Telegram", referral: "Referral",
  inner_circle: "Inner circle", manual: "Manual", campaign: "Marketing campaign", voice: "Voice",
};

export const VERTICALS = ["Residential", "Commercial", "Industrial", "Warehouse", "School", "Hospital", "Other"] as const;

export const PO_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "VENDOR_CONFIRMED", "PARTIALLY_CONFIRMED", "REJECTED", "CANCELLED"] as const;

export const DOC_TYPES = ["Customer Documents", "Site Survey", "EB Documents", "Design", "BOQ", "Proposal", "Quotation", "Purchase Orders", "Invoices", "Vendor Documents", "Installation", "Commissioning", "Handover", "Warranty"] as const;

export const SIDEBAR: { group: string; items: { label: string; href: string; module: ModuleKey; icon: string; soon?: boolean }[] }[] = [
  { group: "Overview", items: [{ label: "Dashboard", icon: "home", href: "/", module: "dashboard" }] },
  {
    group: "Commercial",
    items: [
      { label: "Leads", icon: "funnel", href: "/crm/leads", module: "crm" },
      { label: "Pipeline", icon: "layers", href: "/crm/pipeline", module: "crm" },
      { label: "Follow-ups", icon: "clipboard", href: "/crm/followups", module: "crm" },
      { label: "Customers", icon: "users", href: "/crm/customers", module: "crm" },
      { label: "Proposals", icon: "file", href: "/proposals", module: "proposals" },
    ],
  },
  {
    group: "Projects",
    items: [
      { label: "Projects", icon: "grid", href: "/projects", module: "projects" },
      { label: "Site Surveys", icon: "map", href: "/survey", module: "survey" },
      { label: "Design", icon: "tool", href: "/design", module: "design" },
      { label: "Layouts", icon: "panel", href: "/design/layouts", module: "design" },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Procurement", icon: "truck", href: "/procurement", module: "procurement" },
      { label: "Purchase Orders", icon: "receipt", href: "/procurement/orders", module: "procurement" },
      { label: "Deliveries", icon: "truck", href: "/procurement/deliveries", module: "procurement" },
      { label: "Material Receipt", icon: "cube", href: "/procurement/receipts", module: "procurement" },
      { label: "Inventory", icon: "folder", href: "/procurement/inventory", module: "procurement" },
      { label: "Vendors", icon: "users", href: "/procurement/vendors", module: "procurement" },
      { label: "Material Issues", icon: "upload", href: "/procurement/issues", module: "procurement" },
      { label: "Material Returns", icon: "refresh", href: "/procurement/returns", module: "procurement" },
    ],
  },
  {
    group: "Customer",
    items: [
      { label: "Customer Queries", icon: "chat", href: "/queries", module: "queries" },
      { label: "Documents", icon: "folder", href: "/documents", module: "documents" },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { label: "AI Inbox", icon: "inbox", href: "/ai-inbox", module: "ai" },
      { label: "Analytics", icon: "chart", href: "/analytics", module: "analytics" },
      { label: "Automation", icon: "bolt", href: "/automation", module: "automation" },
      { label: "Calculator", icon: "sun", href: "/design/calculator", module: "design" },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Notifications", icon: "bell", href: "/notifications", module: "dashboard" },
      { label: "Users & Roles", icon: "shield", href: "/system/users", module: "system" },
      { label: "Settings", icon: "gear", href: "/system/settings", module: "system" },
      { label: "Audit Log", icon: "eye", href: "/system/audit", module: "system" },
    ],
  },
];

export const label = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
