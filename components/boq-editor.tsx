"use client";
import { useState } from "react";
import { Icon } from "./ui";
import { inr } from "@/lib/util";

export interface BoqRow { category: string; description: string; spec: string; qty: number; unit: string; unit_cost: number }
const CATS = ["Panels", "Inverters", "Structure", "Cables", "Electrical", "Installation", "Other"];

export function BoqEditor({ initial, disabled }: { initial: BoqRow[]; disabled?: boolean }) {
  const [rows, setRows] = useState<BoqRow[]>(initial.length ? initial : [{ category: "Panels", description: "", spec: "", qty: 1, unit: "nos", unit_cost: 0 }]);
  const set = (i: number, k: keyof BoqRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: ["qty", "unit_cost"].includes(k) ? Number(v) : v } : r)));
  const total = rows.reduce((a, r) => a + r.qty * r.unit_cost, 0);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl" style={{ minWidth: 820 }}>
          <thead><tr><th style={{ width: 120 }}>Category</th><th>Description</th><th>Specification</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 70 }}>Unit</th><th style={{ width: 110 }}>Unit cost (₹)</th><th className="r" style={{ width: 110 }}>Amount</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><select name="boq_category" className="input" value={r.category} onChange={(e) => set(i, "category", e.target.value)} disabled={disabled}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></td>
                <td><input name="boq_description" className="input" value={r.description} onChange={(e) => set(i, "description", e.target.value)} disabled={disabled} aria-label="Description" /></td>
                <td><input name="boq_spec" className="input" value={r.spec} onChange={(e) => set(i, "spec", e.target.value)} disabled={disabled} aria-label="Specification" /></td>
                <td><input name="boq_qty" type="number" min="0" step="any" className="input" value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} disabled={disabled} aria-label="Quantity" /></td>
                <td><input name="boq_unit" className="input" value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} disabled={disabled} aria-label="Unit" /></td>
                <td><input name="boq_cost" type="number" min="0" step="any" className="input" value={r.unit_cost} onChange={(e) => set(i, "unit_cost", e.target.value)} disabled={disabled} aria-label="Unit cost" /></td>
                <td className="r num font-semibold">{inr(r.qty * r.unit_cost)}</td>
                <td>{!disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove row"><Icon name="x" size={14} /></button>}</td>
              </tr>))}
          </tbody>
          <tfoot><tr><td colSpan={6} className="r font-bold" style={{ padding: "10px 14px" }}>Total cost inputs</td><td className="r num font-extrabold">{inr(total)}</td><td /></tr></tfoot>
        </table>
      </div>
      {!disabled && <button type="button" className="btn btn-sm mt-3" onClick={() => setRows((rs) => [...rs, { category: "Other", description: "", spec: "", qty: 1, unit: "nos", unit_cost: 0 }])}><Icon name="plus" size={13} /> Add line</button>}
    </div>
  );
}
