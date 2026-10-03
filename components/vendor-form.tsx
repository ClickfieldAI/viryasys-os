import { Field } from "./ui";
import { ActionForm, ModalButton } from "./client";
import { saveVendorAction } from "@/app/actions/procurement";
import { getDb } from "@/lib/db";

export function VendorFormModal({ vendor, label = "Add vendor", className = "btn btn-primary" }: { vendor?: any; label?: string; className?: string }) {
  const cats = (getDb().prepare("SELECT key FROM material_categories WHERE active = 1 ORDER BY sort").all() as any[]).map((c) => c.key as string);
  const mine = (vendor?.categories ?? "").split(",").filter(Boolean);
  return (
    <ModalButton label={label} title={vendor ? `Edit ${vendor.name}` : "Add vendor"} className={className} width={620} icon={vendor ? "edit" : "plus"}>
      <ActionForm action={saveVendorAction.bind(null, vendor?.id ?? null)} submitLabel={vendor ? "Save vendor" : "Create vendor"} className="space-y-3" resetOnSuccess={!vendor}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor name *" className="sm:col-span-2"><input name="name" required defaultValue={vendor?.name} className="input" /></Field>
          <Field label="Contact person"><input name="contact" defaultValue={vendor?.contact ?? ""} className="input" /></Field>
          <Field label="Phone"><input name="phone" defaultValue={vendor?.phone ?? ""} className="input" /></Field>
          <Field label="Email"><input name="email" type="email" defaultValue={vendor?.email ?? ""} className="input" /></Field>
          <Field label="City"><input name="city" defaultValue={vendor?.city ?? ""} className="input" /></Field>
          <Field label="Address" className="sm:col-span-2"><input name="address" defaultValue={vendor?.address ?? ""} className="input" /></Field>
          <Field label="GSTIN" hint="15 characters"><input name="gstin" defaultValue={vendor?.gstin ?? ""} maxLength={15} className="input uppercase" /></Field>
          <Field label="Payment terms"><input name="payment_terms" defaultValue={vendor?.payment_terms ?? ""} className="input" placeholder="30 days / Advance" /></Field>
        </div>
        <div><label className="label">Categories supplied</label><div className="flex flex-wrap gap-3">{cats.map((c) => <label key={c} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="categories" value={c} defaultChecked={mine.includes(c)} className="accent-[var(--green-600)]" />{c}</label>)}</div></div>
        <Field label="Products"><input name="products" defaultValue={vendor?.products ?? ""} className="input" placeholder="e.g. 540 Wp mono PERC, bifacial" /></Field>
        {vendor && <Field label="Status"><select name="active" defaultValue={vendor.active ? "yes" : "no"} className="input"><option value="yes">Active</option><option value="no">Inactive (can't receive new POs)</option></select></Field>}
      </ActionForm>
    </ModalButton>
  );
}
