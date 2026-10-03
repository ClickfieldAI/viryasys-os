"use server";
import bcrypt from "bcryptjs";
import { authorize } from "@/lib/auth";
import { act, s, n, req, type ActionResult } from "@/lib/action-utils";
import { getDb, settings, setSetting } from "@/lib/db";
import { audit } from "@/lib/services/core";
import { ROLES, type RoleKey } from "@/lib/config";

export async function createUserAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("system");
    const role = s(fd, "role") as RoleKey;
    if (!(role in ROLES)) throw new Error("Choose a role");
    const email = req(fd, "email").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email");
    const pw = req(fd, "password");
    if (pw.length < 8) throw new Error("Password must be at least 8 characters");
    if (getDb().prepare("SELECT id FROM users WHERE lower(email) = ?").get(email)) throw new Error("A user with this email already exists");
    const cust = role === "customer" ? n(fd, "customer_id") : null;
    if (role === "customer" && !cust) throw new Error("Link a customer account for portal users");
    getDb().prepare("INSERT INTO users (name,email,password_hash,role,customer_id) VALUES (?,?,?,?,?)").run(req(fd, "name"), email, bcrypt.hashSync(pw, 10), role, cust);
    audit(actor, "created user", "user", email, undefined, role);
  }, "User created");
}
export async function setUserActiveAction(id: number, active: boolean): Promise<ActionResult> {
  return act(async () => {
    const { actor, user } = await authorize("system");
    if (id === user.id) throw new Error("You can't deactivate your own account");
    getDb().prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
    audit(actor, active ? "activated user" : "deactivated user", "user", id);
  }, "User updated");
}
export async function changeRoleAction(id: number, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor, user } = await authorize("system");
    const role = s(fd, "role") as RoleKey;
    if (!(role in ROLES)) throw new Error("Invalid role");
    if (id === user.id) throw new Error("You can't change your own role");
    const old = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(id) as any).role;
    getDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    audit(actor, "changed user role", "user", id, old, role);
  }, "Role updated");
}
export async function saveSettingsAction(fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("system");
    const cur = settings();
    const names = fd.getAll("tax_name").map(String), pcts = fd.getAll("tax_pct").map(Number);
    const taxes = names.map((nm, i) => ({ name: nm.trim(), pct: pcts[i] })).filter((t) => t.name);
    if (taxes.some((t) => !Number.isFinite(t.pct) || t.pct < 0 || t.pct > 100)) throw new Error("Tax rates must be between 0 and 100");
    const num = (k: string, d: number) => { const v = n(fd, k); return v == null ? d : v; };
    const subject = s(fd, "email_subject"), body = s(fd, "email_body");
    if (!subject || !body) throw new Error("Email subject and body can't be empty");
    const next = {
      ...cur, taxes,
      email: { auto_send: s(fd, "email_auto") === "on", subject, body, from_name: s(fd, "email_from_name") || cur.email.from_name, cc: s(fd, "email_cc") },
      sla_seconds: Math.max(10, Math.round(num("sla_seconds", cur.sla_seconds))),
      proposal_validity_days: Math.max(1, Math.round(num("proposal_validity_days", cur.proposal_validity_days))),
      followup_days: Math.max(1, Math.round(num("followup_days", cur.followup_days ?? 10))),
      calc: {
        irradiation_kwh_m2_year: num("irradiation", cur.calc.irradiation_kwh_m2_year), panel_wp: num("panel_wp", cur.calc.panel_wp), area_sqm_per_kwp: num("area_per_kwp", cur.calc.area_sqm_per_kwp),
        performance_ratio: num("pr", cur.calc.performance_ratio), degradation_pct: num("degradation", cur.calc.degradation_pct), tariff_per_kwh: num("tariff", cur.calc.tariff_per_kwh), cost_per_kwp: num("cost_per_kwp", cur.calc.cost_per_kwp), area_sqft_per_kw: num("area_sqft", cur.calc.area_sqft_per_kw),
      },
    };
    if (next.calc.performance_ratio <= 0 || next.calc.performance_ratio > 1) throw new Error("Performance ratio must be between 0 and 1");
    // payment templates: "Name|Milestone:pct,Milestone:pct" per line
    const tplText = s(fd, "payment_templates");
    if (tplText) {
      const parsed = tplText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, rest] = l.split("|");
        const ms = (rest ?? "").split(",").map((x) => { const [mn, p] = x.split(":"); return { name: mn.trim(), pct: Number(p) }; });
        const sum = ms.reduce((a, m) => a + m.pct, 0);
        if (!name?.trim() || !ms.length || ms.some((m) => !m.name || !Number.isFinite(m.pct)) || Math.abs(sum - 100) > 0.01) throw new Error(`Payment template “${name}” must add up to 100%`);
        return { name: name.trim(), milestones: ms };
      });
      (next as any).payment_templates = parsed;
    }
    setSetting("org", next);
    audit(actor, "changed settings", "settings", "org", JSON.stringify({ taxes: cur.taxes, sla: cur.sla_seconds }), JSON.stringify({ taxes: next.taxes, sla: next.sla_seconds }));
  }, "Settings saved");
}
export async function toggleRuleAction(id: number, enabled: boolean): Promise<ActionResult> {
  return act(async () => {
    const { actor } = await authorize("automation");
    getDb().prepare("UPDATE automation_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    audit(actor, enabled ? "enabled automation" : "disabled automation", "automation_rule", id);
  }, "Automation updated");
}
