# ViryaSys OS

Operating system for ViryaSys Technologies (Solar EPC, Tamil Nadu): one record from first enquiry to handover.

```
Lead → Qualification → Site visit → Survey → Design/BOQ → Proposal → Negotiation → WON
     → Project → Procurement → Delivery → Installation → Commissioning → Metering → Handover → Customer portal
```

## Run

```bash
npm install
npm run dev          # http://localhost:4470  (fresh DB is created + seeded on first request)
npm run build && npm start
rm data/vos.db*      # reset to seed data (stop the server first)
```

Demo logins (password `viryasys123`): `kishore@` (MD), `arun@` (Sales), `senthil@` (PM), `meena@` (Designer), `ramesh@` (Procurement), `lakshmi@` (Finance), `admin@`, all `@viryasystech.com`; customer portal: `customer@demo.in`. The login page has one-click demo chips in development.

Secrets live in `.env.local` (`SESSION_SECRET`, `WEBHOOK_SECRET`). **Change both before any real deployment.**

## Architecture

| Layer | Where |
|---|---|
| Schema (relational, human-readable IDs `VS-LEAD-000001`) | `lib/db/schema.ts` |
| Business services (no logic in components) | `lib/services/*` — leads, inbox, design, proposals, projects, procurement, finance, automation, dashboard, misc, core (audit + notifications) |
| Provider abstractions (swap adapters, not callers) | `lib/providers/index.ts` — Telegram, Google Chat, website form, Gmail, Storage, AI, PDF |
| RBAC matrix (server-enforced in every page + action) | `lib/config.ts`, `lib/auth.ts` |
| Server actions | `app/actions/*` |
| Design system | `app/globals.css`, `components/ui.tsx`, `components/client.tsx` |
| Proposal engine (pure, shared by editor preview + PDF) | `lib/proposal-render.ts` |

**Automation engine** (`lib/services/automation.ts`): services fire triggers (`lead.created`, `survey.submitted`, `proposal.accepted`, `payment.advance_received`, `lead.sla_breached`); enabled rules in `automation_rules` decide what happens. Turning a rule off genuinely stops that step. See `/automation`.

**Inbound pipeline**: `POST /api/webhooks/{telegram|google_chat|website}` (shared-secret verified, idempotent) → `inbound_messages` (raw stored forever) → AI extraction → READY / REVIEW queue → human confirm → lead. Corrections are stored and teach the extractor.

## Honest status vs the brief

Working end to end (verified by a scripted lifecycle test and a 415-check route/RBAC smoke test): auth + RBAC, dashboard (role-specific), notifications, global search (⌘K), leads/pipeline/follow-ups/customers, 2-minute SLA with breach escalation, duplicate detection, AI inbox + review queue + learning, qualification with AI summary, site visits, mobile-friendly digital survey with photos, designer workspace + BOQ, solar calculation engine, proposal builder with editable template, variables, pricing/tax/payment engine, versioning, approve → send → negotiate → revise → accept, auto project creation with carried-forward data, project stages with gates + computed health, installation logging, handover checklist, procurement (auto PO drafts after advance, per-item dates, delay detection, receiving/inspection), invoices/payments, customer portal (isolated), queries, documents, analytics, automation view, users/roles, settings, audit log.

Development adapters / not yet real:
- **AI is a heuristic extractor**, not an LLM. Implement `AIProvider` (`lib/providers`) with Claude to upgrade; the pipeline, review queue and learning are already wired. EB-bill extraction exists on the provider but has no UI yet.
- **Database is SQLite** (zero-setup). Schema is plain relational SQL; moving to Postgres/Supabase means swapping `lib/db` (better-sqlite3 → pg) and `nextCode`.
- **Outgoing email needs SMTP** (`SMTP_*` in `.env.local`): approved proposals are emailed automatically once configured; until then they are prepared, not sent. Gmail polling and live Telegram/Google Chat bots need credentials wired to the webhooks.
- **PDF = browser Save-as-PDF** of the print view (`PdfProvider` is the swap point for headless Chrome).
- Storage is local disk (`data/uploads`); `StorageProvider` is the swap point for S3/GCS.
- Not built: Quotations as a separate module, design-file uploads, voice capture UI, vendor create/edit UI, password reset, role-matrix editing (matrix is read-only), true realtime push (pages auto-refresh every 20–30 s).

## Procurement & Material Control module

`/procurement` is the control tower. Code lives in `lib/services/proc/` (core · orders · logistics · ledger · intel · zoho), pages in `app/(app)/procurement/`, actions in `app/actions/procurement.ts`.

- **Hard lock** — no purchase request or PO without customer + project + approved customer order + the required advance (`procurementGate`). The advance auto-unlocks procurement and creates the plan (automation rule).
- **Plan → stages → requirements** from the approved BOQ (3-stage / 2-stage / single; add stages, move materials). Categories are rows in `material_categories` (criticality, project milestone, serialised), not code.
- **PO workflow** — DRAFT → PENDING_APPROVAL → APPROVED (MD or Finance, never the creator) → SENT (automatic) → VENDOR_CONFIRMED / PARTIALLY_CONFIRMED / REJECTED. Released POs are never edited.
- **Delivery-date versioning** — every promise is an append-only row (`vendor_delivery_updates`); the original is never overwritten. Delay = today > current promise and not received; total delay is measured from the *original*.
- **One PO, many deliveries** — deliveries are created per promised date, can be split, and carry partial quantities. Status is derived, never typed in (`intel.deriveLine`).
- **Receipt chain** — receive (short quantity → exception) → inspect (spec/qty/condition/packaging/serials/photos) → GRN + delivery note (automation) → customer acknowledgement (site signature pad or customer portal) → delivery closed.
- **Ledger** — `inventory_transactions` is append-only (SQLite triggers reject UPDATE/DELETE). Issue/consume/return/stock count post entries; balances are derived.
- **Intelligence** — health %, project-impact risk (delay + criticality + days-to-milestone + dependency), exceptions and alerts (auto-raised, auto-resolved), derived vendor performance (on-time vs *original* promise), cost control per project, analytics, calendar.
- **Zoho Books** — `zoho_sync_events` + `ZohoBooks` provider. Events queue as PENDING until Finance approves that event's mapping; failures are recorded with a reason and can be retried. No journal mapping is invented.
- **Roles** — added Site Engineer and Warehouse; project-level scope for PM / Site Engineer / Sales.

Demo history is produced by running the real services on a simulated clock (`lib/clock.ts`, `lib/db/seed-procurement.ts`).

Not built in this module: delivery map, QR/barcode scanning (codes are stable IDs, ready for it), PO revisions (a released PO is cancelled and re-raised), saved views are fixed presets rather than user-defined, and the material-return “inspection” step is captured as the condition on the return rather than a separate inspection record.
