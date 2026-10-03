import Link from "next/link";
import { guard } from "@/lib/auth";
import { settings, getSetting } from "@/lib/db";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm, ActionButton } from "@/components/client";
import { saveSettingsAction } from "@/app/actions/system";
import { toggleAutoCreateAction } from "@/app/actions/crm";
import { TaxRows } from "@/components/tax-rows";
import { Smtp } from "@/lib/providers";
import { VARIABLES } from "@/lib/proposal-render";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings() {
  await guard("system");
  const s = settings();
  const auto = getSetting("ai_auto_create", false);
  const tpl = s.payment_templates.map((t) => `${t.name}|${t.milestones.map((m) => `${m.name}:${m.pct}`).join(",")}`).join("\n");
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title="Settings" sub="Nothing commercial is hard-coded — tax, SLA, payment terms and calculation assumptions live here." actions={<Link className="btn" href="/system/proposal-template">Proposal template</Link>} />
      <ActionForm action={saveSettingsAction} resetOnSuccess={false} className="space-y-5">
        <Card title="Tax">
          <TaxRows initial={s.taxes} />
          <p className="hint mt-2">Applied to new proposals and purchase orders. Existing proposal versions keep the rates they were created with. Default: CGST 9% + SGST 9%.</p>
        </Card>
        <Card title="Sales & proposals">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lead response SLA (seconds)" hint="Default 120 = two minutes"><input name="sla_seconds" type="number" min="10" defaultValue={s.sla_seconds} className="input" /></Field>
            <Field label="Follow up idle proposals after (days)" hint="A lead that stays at Proposal this long without moving to Negotiation is added to Follow-ups (10 ≈ 1½ weeks)"><input name="followup_days" type="number" min="1" defaultValue={s.followup_days ?? 10} className="input" /></Field>
            <Field label="Proposal validity (days)"><input name="proposal_validity_days" type="number" min="1" defaultValue={s.proposal_validity_days} className="input" /></Field>
          </div>
          <Field label="Payment schedule templates" className="mt-3" hint="One per line: Name|Milestone:%,Milestone:% — each must total 100%"><textarea name="payment_templates" rows={4} defaultValue={tpl} className="input font-mono text-[12.5px]" /></Field>
        </Card>
        <Card title="Proposal email">
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md p-2.5 text-[13px] ${Smtp.configured() ? "bg-[var(--green-50)] text-[var(--green-700)]" : "bg-[var(--orange-50)] text-[var(--orange)]"}`}>
            <span>{Smtp.configured() ? `Outgoing email is connected (${process.env.SMTP_HOST}, sending as ${process.env.SMTP_FROM || process.env.SMTP_USER}).` : "Outgoing email is not connected. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM) in .env.local and restart. Until then approved proposals are prepared but not sent."}</span>
          </div>
          <label className="mb-3 flex items-start gap-2 text-[13px]"><input type="checkbox" name="email_auto" defaultChecked={s.email.auto_send} className="mt-0.5 h-4 w-4 accent-[var(--green-600)]" /><span><b>Email the customer automatically when a proposal is approved</b><br /><span className="text-muted">The editable Word proposal and any uploaded plan view are attached. Approval is the review step — nothing is sent before it.</span></span></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sender name"><input name="email_from_name" defaultValue={s.email.from_name} className="input" /></Field>
            <Field label="CC (comma separated, optional)"><input name="email_cc" defaultValue={s.email.cc} className="input" placeholder="accounts@viryasystech.com" /></Field>
          </div>
          <Field label="Subject" className="mt-3"><input name="email_subject" defaultValue={s.email.subject} required className="input" /></Field>
          <Field label="Email body" className="mt-3" hint={`Variables: ${VARIABLES.map((v) => `{{${v.key}}}`).join("  ")}`}><textarea name="email_body" rows={16} defaultValue={s.email.body} required className="input font-mono text-[12.5px]" /></Field>
        </Card>
        <Card title="Solar calculation assumptions">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Irradiation (kWh/m²/yr)"><input name="irradiation" type="number" step="any" defaultValue={s.calc.irradiation_kwh_m2_year} className="input" /></Field>
            <Field label="Performance ratio (0–1)"><input name="pr" type="number" step="any" defaultValue={s.calc.performance_ratio} className="input" /></Field>
            <Field label="Panel wattage (Wp)"><input name="panel_wp" type="number" step="any" defaultValue={s.calc.panel_wp} className="input" /></Field>
            <Field label="Area per kWp (sq m)"><input name="area_per_kwp" type="number" step="any" defaultValue={s.calc.area_sqm_per_kwp} className="input" /></Field>
            <Field label="Degradation (%/yr)"><input name="degradation" type="number" step="any" defaultValue={s.calc.degradation_pct} className="input" /></Field>
            <Field label="Tariff (₹/kWh)"><input name="tariff" type="number" step="any" defaultValue={s.calc.tariff_per_kwh} className="input" /></Field>
            <Field label="Area required (sq ft per kW)"><input name="area_sqft" type="number" step="any" defaultValue={s.calc.area_sqft_per_kw} className="input" /></Field>
            <Field label="Indicative cost (₹/kWp)"><input name="cost_per_kwp" type="number" step="any" defaultValue={s.calc.cost_per_kwp} className="input" /></Field>
          </div>
        </Card>
        <div className="flex justify-end"><button type="submit" className="btn btn-primary">Save settings</button></div>
      </ActionForm>
      <Card title="AI capture" className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-md text-[13px]"><b>Auto-create leads</b><p className="text-muted">When on, messages the AI understands with ≥90% confidence and no duplicate become leads without a human click. Everything else goes to the review queue.</p></div>
          <ActionButton action={toggleAutoCreateAction.bind(null, !auto)} className={`btn ${auto ? "btn-primary" : ""}`}>{auto ? "On — click to turn off" : "Off — click to turn on"}</ActionButton>
        </div>
      </Card>
    </div>
  );
}
