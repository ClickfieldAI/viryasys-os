// Shared server-rendered form fragments.
import { Field } from "./ui";
import { LEAD_SOURCES, VERTICALS } from "@/lib/config";

export function Select({ name, options, defaultValue, required, placeholder, className = "" }: { name: string; options: (string | [string, string])[]; defaultValue?: string | number | null; required?: boolean; placeholder?: string; className?: string }) {
  return (
    <select name={name} required={required} defaultValue={defaultValue ?? ""} className={`input ${className}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
    </select>
  );
}

export function LeadFormFields() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Company" hint="Leave blank if unknown"><input name="company" className="input" placeholder="e.g. ABC Industries" /></Field>
      <Field label="Contact name *"><input name="contact" required className="input" /></Field>
      <Field label="Phone"><input name="phone" className="input" inputMode="tel" placeholder="98xxxxxxxx" /></Field>
      <Field label="Email"><input name="email" type="email" className="input" /></Field>
      <Field label="Location *"><input name="location" required className="input" placeholder="City" /></Field>
      <Field label="Capacity (kW)"><input name="capacity_kw" type="number" min="1" step="any" className="input" /></Field>
      <Field label="Vertical"><Select name="vertical" placeholder="Select…" options={[...VERTICALS]} /></Field>
      <Field label="Solar type"><Select name="solar_type" placeholder="Select…" options={["Rooftop", "Ground mount", "Carport"]} /></Field>
      <Field label="Source"><Select name="source" defaultValue="manual" options={Object.entries(LEAD_SOURCES) as [string, string][]} /></Field>
      <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="force" value="1" className="h-4 w-4 accent-[var(--green-600)]" /> Create anyway if a duplicate is found</label>
    </div>
  );
}
