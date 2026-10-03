// Procurement demo history. Everything goes through the real services on a simulated clock, so the
// promise history, ledger, exceptions and alerts are exactly what production code would have produced.
import type { DB } from "./index";
import { withClock } from "../clock";
import { addDays, dateOnly } from "../util";
import type { Actor } from "../services/core";
import * as core from "../services/proc/core";
import * as orders from "../services/proc/orders";
import * as logi from "../services/proc/logistics";
import * as ledger from "../services/proc/ledger";
import * as intel from "../services/proc/intel";

type Group = "Structure" | "Panels" | "Inverters" | "Cables";
type Up = "draft" | "pending" | "sent" | "confirmed";
type Del = "none" | "transit" | "received" | "inspected" | "ack";
interface PoPlan {
  group: Group; up: Up; createdAgo: number; confirmAgo?: number; promise?: number; slips?: { agoDays: number; to: number }[];
  paid?: boolean; delivery?: Del; receivedAgo?: number; short?: number; damaged?: number; reliable?: boolean; partial?: boolean;
}

const GROUP_OF: Record<string, Group> = { Structure: "Structure", Panels: "Panels", Inverters: "Inverters", Cables: "Cables", Electrical: "Cables", Other: "Cables" };
const VENDOR_CATS: Record<Group, string> = { Structure: "Structure", Panels: "Panels", Inverters: "Inverters", Cables: "Cables" };
// Index 0 of each list is the reliable vendor, the rest slip more often (so vendor performance is meaningful).
const RELIABLE_FIRST: Record<Group, number[]> = { Structure: [1, 0], Panels: [0, 1, 2], Inverters: [0, 1, 2], Cables: [0, 1] };

export function seedProcurement(db: DB, ctx: { projectRefs: { id: number; stage: string; kw: number; code: string; age: number; idx: number }[]; vendorIds: Record<string, number[]>; U: Record<string, number> }) {
  const { U } = ctx;
  const md: Actor = { id: U.kishore, name: "Kishore", role: "md" };
  const buyer: Actor = { id: U.ramesh, name: "Ramesh Naidu", role: "procurement" };
  const fin: Actor = { id: U.lakshmi, name: "Lakshmi Subramanian", role: "finance" };
  const store: Actor = { id: U.mohan, name: "Mohan Kumar", role: "warehouse" };
  const site = (idx: number): Actor => ({ id: U[idx % 2 ? "prakash" : "vimal"], name: idx % 2 ? "Prakash Selvam" : "Vimal Raj", role: "site_engineer" });
  const ago = (days: number) => new Date(Date.now() - days * 86400000);
  const dayStr = (offset: number) => dateOnly(addDays(new Date(), offset));
  let seq = 0;
  const rnd = () => { seq = (seq * 9301 + 49297) % 233280; return seq / 233280; };
  seq = 4242;

  const groupCats = (g: Group) => (g === "Cables" ? ["Cables", "Electrical", "Other"] : [g]);

  for (const p of ctx.projectRefs) {
    const k = p.idx % 5;
    const pm = db.prepare("SELECT pm_id FROM projects WHERE id = ?").get(p.id) as any;
    void pm;
    const paid = (db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE project_id = ?").get(p.id) as any).s > 0;
    const A = p.age;
    // 1. customer order + authorization once the advance is in
    withClock(ago(A - 0.2), () => core.createCustomerOrder(p.id, md));
    if (!paid) continue; // procurement stays LOCKED for projects still waiting on the advance
    const template = p.idx % 7 === 0 ? "2-stage" : p.idx % 11 === 0 ? "single" : "3-stage";
    withClock(ago(Math.max(0.3, A - 1)), () => core.authorizeProcurement(p.id, buyer, template));

    if (["PLANNING", "DESIGN"].includes(p.stage)) {
      if (p.idx % 2 === 0) withClock(ago(0.5), () => {
        const st = db.prepare("SELECT s.id FROM procurement_stages s JOIN procurement_plans pl ON pl.id = s.plan_id WHERE pl.project_id = ? ORDER BY s.sort LIMIT 1").get(p.id) as any;
        core.createRequestsForStage(st.id, buyer);
      });
      continue;
    }

    const plans = planFor(p.stage, k, A);
    for (const pl of plans) runPo(p, pl);

    // material movements after deliveries
    afterDelivery(p, k);
  }

  intel.procurementTick(true);

  /* ───────── helpers ───────── */
  function planFor(stage: string, k: number, age: number): PoPlan[] {
    const base = (g: Group, extra: Partial<PoPlan>): PoPlan => ({ group: g, up: "confirmed", createdAgo: Math.max(1, age - 2), confirmAgo: Math.max(0.6, age - 3), paid: true, reliable: true, ...extra });
    if (stage === "PROCUREMENT") {
      if (k === 0) return [base("Structure", { up: "draft", createdAgo: 1 }), base("Panels", { up: "pending", createdAgo: 1.2 }), base("Inverters", { up: "draft", createdAgo: 0.6 })];
      if (k === 1) return [base("Structure", { up: "sent", createdAgo: 0.35 }), base("Panels", { up: "sent", createdAgo: 1.6 }), base("Inverters", { up: "sent", createdAgo: 0.5 })];
      if (k === 2) return [base("Structure", { confirmAgo: 3, createdAgo: 4, promise: 3, paid: false }), base("Panels", { confirmAgo: 3, createdAgo: 4, promise: 5, paid: false }), base("Inverters", { up: "sent", createdAgo: 2.6 })];
      if (k === 3) return [base("Structure", { createdAgo: 3, confirmAgo: 2.5, promise: 3, slips: [{ agoDays: 1, to: 3 }], reliable: false }), base("Panels", { createdAgo: 3, confirmAgo: 2.4, promise: 4 }), base("Inverters", { createdAgo: 3, confirmAgo: 2.4, promise: 6 })];
      return [base("Structure", { createdAgo: 7, confirmAgo: 6.5, promise: -2, slips: [{ agoDays: 3, to: -2 }], reliable: false }), base("Panels", { createdAgo: 6, confirmAgo: 5.5, promise: 3 }), base("Inverters", { createdAgo: 6, confirmAgo: 5.5, promise: 5 })];
    }
    if (stage === "MATERIAL_DELIVERY") {
      const s1 = base("Structure", { createdAgo: 24, confirmAgo: 23.5, promise: -17, delivery: "ack", receivedAgo: 17 });
      const cab = base("Cables", { createdAgo: 20, confirmAgo: 19.5, promise: 3 + (k % 2), paid: k !== 2 });
      const panels: PoPlan = [
        base("Panels", { createdAgo: 22, confirmAgo: 21.5, promise: 0, delivery: "transit" }),
        base("Panels", { createdAgo: 22, confirmAgo: 21.5, promise: -1, delivery: "received", receivedAgo: 1 }),
        base("Panels", { createdAgo: 22, confirmAgo: 21.5, promise: -9, delivery: "inspected", receivedAgo: 9, short: 6, reliable: false }),
        base("Panels", { createdAgo: 22, confirmAgo: 21.5, promise: -8, delivery: "ack", receivedAgo: 8 }),
        base("Panels", { createdAgo: 22, confirmAgo: 21.5, promise: -3, delivery: "inspected", receivedAgo: 3, damaged: 2, reliable: false }),
      ][k];
      const inv: PoPlan = [
        base("Inverters", { createdAgo: 22, confirmAgo: 21.5, promise: 1, delivery: "transit" }),
        base("Inverters", { createdAgo: 22, confirmAgo: 21.5, promise: 2 }),
        base("Inverters", { createdAgo: 22, confirmAgo: 21.5, promise: -7, delivery: "ack", receivedAgo: 7 }),
        base("Inverters", { createdAgo: 22, confirmAgo: 21.5, promise: -3, slips: [{ agoDays: 8, to: -3 }], reliable: false }),
        base("Inverters", { createdAgo: 22, confirmAgo: 21.5, promise: 1, delivery: "transit" }),
      ][k];
      return [s1, panels, inv, cab];
    }
    // installation and beyond: everything delivered and acknowledged; some vendors slipped along the way
    const d = Math.max(4, age - 24);
    return [
      base("Structure", { createdAgo: age - 3, confirmAgo: age - 3.4, promise: -(d + 12), delivery: "ack", receivedAgo: d + 12 }),
      base("Panels", { createdAgo: age - 4, confirmAgo: age - 4.4, promise: -(d + 8), delivery: "ack", receivedAgo: d + 8 - (k === 1 ? 2 : 0), slips: k === 1 ? [{ agoDays: d + 12, to: -(d + 8) }] : undefined, reliable: k !== 1 }),
      base("Inverters", { createdAgo: age - 4, confirmAgo: age - 4.4, promise: -(d + 6), delivery: "ack", receivedAgo: d + 6 - (k === 3 ? 4 : 0), slips: k === 3 ? [{ agoDays: d + 10, to: -(d + 6) }] : undefined, reliable: k !== 3 }),
      base("Cables", { createdAgo: age - 5, confirmAgo: age - 5.4, promise: -(d + 4), delivery: "ack", receivedAgo: d + 4 }),
    ];
  }

  function runPo(p: { id: number; idx: number; stage: string }, pl: PoPlan) {
    const reqs = db.prepare("SELECT r.*, s.sort ssort FROM material_requirements r LEFT JOIN procurement_stages s ON s.id = r.stage_id WHERE r.project_id = ? ORDER BY r.id").all(p.id) as any[];
    const lines = reqs.filter((r) => groupCats(pl.group).includes(GROUP_OF[r.category] === pl.group ? r.category : "__none"));
    if (!lines.length) return;
    const order = RELIABLE_FIRST[pl.group];
    const vlist = ctx.vendorIds[VENDOR_CATS[pl.group]] ?? ctx.vendorIds[pl.group === "Cables" ? "Cables" : pl.group];
    const vendor = vlist[pl.reliable === false ? order[order.length - 1] % vlist.length : order[p.idx % Math.max(1, order.length - 1)] % vlist.length];
    const factor = rnd() < 0.7 ? 0.98 + rnd() * 0.04 : rnd() < 0.7 ? 1.03 + rnd() * 0.02 : 1.06 + rnd() * 0.03;
    const stageId = lines[0].stage_id;
    let po!: { id: number; code: string };
    withClock(ago(pl.createdAgo), () => {
      po = orders.createPO({ project_id: p.id, vendor_id: vendor, stage_id: stageId, payment_terms: pl.paid === false ? "30 days from confirmation" : "Advance", lines: lines.map((r) => ({ requirement_id: r.id, qty: r.qty, rate: Math.round(r.est_unit_cost * factor), tax_pct: 18 })) }, buyer);
    });
    if (pl.up === "draft") return;
    withClock(ago(pl.createdAgo - 0.06), () => orders.submitPO(po.id, buyer));
    if (pl.up === "pending") return;
    withClock(ago(pl.createdAgo - 0.12), () => orders.approvePO(po.id, md)); // automation "PO approved → send vendor PO" releases it
    if (pl.up === "sent") return;
    const items = db.prepare("SELECT * FROM purchase_order_items WHERE po_id = ?").all(po.id) as any[];
    const confirmAgo = pl.confirmAgo ?? Math.max(0.5, pl.createdAgo - 0.5);
    const firstPromise = pl.slips ? pl.slips[0].to - Math.round(1 + rnd() * 3) : pl.promise ?? 3;
    withClock(ago(confirmAgo), () => orders.recordConfirmation(po.id, items.map((i) => ({ po_item_id: i.id, status: "ACCEPTED" as const, confirmed_qty: i.qty, expected_date: dayStr(firstPromise), expected_time: "10:00", remarks: "Confirmed" })), buyer));
    for (const sl of pl.slips ?? []) withClock(ago(sl.agoDays), () => { for (const i of items) orders.updatePromise(i.id, dayStr(sl.to), undefined, ["Vendor stock delay", "Transporter delay", "Production delay"][Math.floor(rnd() * 3)], buyer); });
    if (pl.paid) withClock(ago(Math.max(0.1, confirmAgo - 0.3)), () => {
      const total = (db.prepare("SELECT total FROM purchase_orders WHERE id = ?").get(po.id) as any).total;
      if (rnd() < 0.35) { orders.recordVendorPayment(po.id, Math.round(total / 2), "NEFT", `UTR${100000 + Math.floor(rnd() * 899999)}`, "Advance", fin); orders.recordVendorPayment(po.id, Math.round((total - Math.round(total / 2)) * 100) / 100, "NEFT", `UTR${100000 + Math.floor(rnd() * 899999)}`, "Balance", fin); }
      else orders.recordVendorPayment(po.id, total, "NEFT", `UTR${100000 + Math.floor(rnd() * 899999)}`, "Full payment", fin);
    });
    if (!pl.delivery || pl.delivery === "none") return;
    walk(p, po.id, pl);
  }

  function walk(p: { id: number; idx: number }, poId: number, pl: PoPlan) {
    const dels = db.prepare("SELECT * FROM deliveries WHERE po_id = ? ORDER BY id").all(poId) as any[];
    const eng = site(p.idx);
    const cust = (db.prepare("SELECT ct.name FROM contacts ct JOIN projects pr ON pr.customer_id = ct.customer_id WHERE pr.id = ? LIMIT 1").get(p.id) as any)?.name ?? "Customer";
    const recvAgo = pl.receivedAgo ?? 0;
    for (const d of dels) {
      withClock(ago(recvAgo + 0.6), () => { logi.markReady(d.id, buyer); });
      withClock(ago(recvAgo + 0.45), () => logi.dispatch(d.id, `TN ${10 + (d.id % 80)} AB ${1000 + d.id * 7}`, ["Murugan", "Selvam", "Karthi", "Anbu"][d.id % 4], buyer));
      if (pl.delivery === "transit") continue;
      const dis = db.prepare("SELECT di.*, i.category FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = ?", ).all(d.id) as any[];
      withClock(ago(recvAgo), () => logi.receiveDelivery(d.id, { received_by: eng.name, vehicle: undefined, driver: undefined, notes: pl.short ? "Short delivery noted at unloading" : undefined,
        items: dis.map((x, n) => ({ delivery_item_id: x.id, qty_received: n === 0 && pl.short ? Math.max(0, x.qty_dispatched - pl.short) : x.qty_dispatched })) }, eng));
      if (pl.delivery === "received") continue;
      withClock(ago(recvAgo - 0.12), () => {
        const rows = db.prepare("SELECT di.*, i.category, i.description FROM delivery_items di JOIN purchase_order_items i ON i.id = di.po_item_id WHERE di.delivery_id = ?").all(d.id) as any[];
        logi.inspectDelivery(d.id, { remarks: pl.damaged ? "Cracked glass on top layer of pallet" : undefined, items: rows.map((x, n) => {
          const dmg = n === 0 ? pl.damaged ?? 0 : 0;
          const serialised = ["Inverters"].includes(x.category);
          return { delivery_item_id: x.id, spec_match: true, condition: dmg ? "Minor damage" : "Good", packaging: "Intact", remarks: dmg ? "Damaged units set aside" : undefined, qty_accepted: x.qty_received - dmg, qty_damaged: dmg, qty_rejected: 0,
            serials: serialised ? Array.from({ length: Math.min(x.qty_received - dmg, 12) }, (_, m) => `SN${String(d.id).padStart(4, "0")}${String(x.id).padStart(4, "0")}${String(m + 1).padStart(2, "0")}`).join(",") : undefined };
        }) }, eng);
      });
      if (pl.delivery === "inspected") continue;
      withClock(ago(recvAgo - 0.25), () => logi.acknowledgeDelivery(d.id, { customer_name: cust, remarks: "Material received at site", via: "site" }, eng));
    }
  }

  function afterDelivery(p: { id: number; idx: number; stage: string; age: number }, k: number) {
    if (!["INSTALLATION", "COMMISSIONING", "METERING", "HANDOVER", "COMPLETED"].includes(p.stage)) return;
    const eng = site(p.idx);
    const reqs = db.prepare("SELECT * FROM material_requirements WHERE project_id = ? ORDER BY id").all(p.id) as any[];
    const late = ["COMMISSIONING", "METERING", "HANDOVER", "COMPLETED"].includes(p.stage);
    const frac = p.stage === "INSTALLATION" ? 0.45 + (k * 0.11) : 1;
    const t0 = Math.max(2, p.age - 30);
    for (const r of reqs) {
      const bal = ledger.balanceOf(r.id);
      if (bal.store <= 0) continue;
      const cat = r.category;
      const issue = Math.floor(bal.store * (cat === "Panels" || cat === "Structure" ? Math.min(1, frac + 0.15) : cat === "Inverters" ? (p.stage === "INSTALLATION" && k < 2 ? 0 : 1) : Math.min(1, frac)) * 100) / 100;
      if (issue <= 0) continue;
      const chunks = issue > 40 ? [0.6, 0.4] : [1];
      chunks.forEach((c, n) => withClock(ago(t0 - n * 1.5), () => ledger.issueMaterial({ project_id: p.id, requirement_id: r.id, qty: Math.max(0.01, Math.round(issue * c * 100) / 100), issued_by: store.name, received_by: eng.name, purpose: "Installation", install_stage: cat === "Structure" ? "Structure erection" : cat === "Panels" ? "Panel mounting" : cat === "Inverters" ? "Inverter & wiring" : "Cabling & earthing" }, store)));
      const site$ = ledger.balanceOf(r.id).site;
      const use = Math.round(site$ * (p.stage === "HANDOVER" || p.stage === "COMPLETED" ? 0.94 : late ? 0.97 : 0.7) * 100) / 100;
      if (use > 0) withClock(ago(Math.max(0.3, t0 - 3)), () => ledger.consumeMaterial({ project_id: p.id, requirement_id: r.id, qty: use, note: "Installed" }, eng));
    }
    if (["HANDOVER", "COMPLETED"].includes(p.stage)) {
      for (const r of reqs) {
        const b = ledger.balanceOf(r.id);
        if (b.onHand > 0.001) {
          if (b.store > 0) withClock(ago(2), () => ledger.issueMaterial({ project_id: p.id, requirement_id: r.id, qty: b.store, issued_by: store.name, received_by: eng.name, purpose: "Final balance", install_stage: "Handover" }, store));
          const s = ledger.balanceOf(r.id).site;
          if (s > 0 && r.category !== "Panels") withClock(ago(1), () => ledger.consumeMaterial({ project_id: p.id, requirement_id: r.id, qty: Math.floor(s * 0.9 * 100) / 100, note: "Installed" }, eng));
        }
        const left = ledger.balanceOf(r.id).onHand;
        if (left > 0.001) {
          withClock(ago(0.8), () => ledger.returnMaterial({ project_id: p.id, requirement_id: r.id, qty: Math.round(left * 0.85 * 100) / 100 || left, condition: "Good", returned_by: eng.name, received_by: store.name, reason: "Unused at project completion" }, store));
          const rest = ledger.balanceOf(r.id).onHand;
          if (rest > 0.001 && k === 0 && p.idx % 2 === 0) withClock(ago(0.5), () => ledger.reconcile(p.id, r.id, Math.max(0, rest - (k === 0 ? 1 : 0)), "Closing stock count", store));
        }
      }
    }
  }
}
