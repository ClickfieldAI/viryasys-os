"use client";
import { useState } from "react";
import { Icon } from "./ui";

export function TaxRows({ initial }: { initial: { name: string; pct: number }[] }) {
  const [rows, setRows] = useState(initial);
  const total = rows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input name="tax_name" className="input" style={{ maxWidth: 200 }} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Tax name" required />
          <input name="tax_pct" type="number" min="0" max="100" step="any" className="input" style={{ maxWidth: 110 }} value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} aria-label="Tax percent" required /> %
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove tax"><Icon name="x" size={14} /></button>
        </div>))}
      <div className="flex items-center gap-3"><button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { name: "", pct: 0 }])}>+ Add tax line</button><span className="text-xs text-muted">Combined rate: <b className="num">{total}%</b></span></div>
    </div>
  );
}
