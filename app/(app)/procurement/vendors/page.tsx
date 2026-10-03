import Link from "next/link";
import { guard } from "@/lib/auth";
import { can } from "@/lib/config";
import { vendorStats } from "@/lib/services/procurement";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { VendorFormModal } from "@/components/vendor-form";
import { inrShort } from "@/lib/util";

export const metadata = { title: "Vendors" };
export const dynamic = "force-dynamic";

export default async function Vendors() {
  const user = await guard("procurement");
  const rows = vendorStats();
  return (
    <div>
      <PageHeader title="Vendors" sub="Performance is derived from real deliveries against the vendor’s original promise — never a manual rating." actions={can(user.role, "procurement", "w") ? <VendorFormModal /> : undefined} />
      <Card flush>{rows.length === 0 ? <EmptyState icon="users" title="No vendors yet" body="Add the suppliers you buy panels, inverters, structures and cables from." /> : (
        <div className="overflow-x-auto"><table className="tbl" style={{ minWidth: 1040 }}><thead><tr><th>Vendor</th><th>Categories</th><th className="r">POs</th><th className="r">Active</th><th className="r">Pending</th><th className="r">Delayed</th><th className="r">PO value</th><th className="r">On-time</th><th className="r">Avg delay</th><th className="r">Quality issues</th><th>Health</th></tr></thead>
          <tbody>{rows.map((v) => <tr key={v.id} className={v.active ? "" : "opacity-50"}><td><Link className="lnk" href={`/procurement/vendors/${v.id}`}>{v.name}</Link><div className="text-xs text-muted num">{v.code} · {v.city}</div></td><td className="text-xs">{(v.categories ?? "").replace(/,/g, ", ")}</td>
            <td className="r num">{v.pos}</td><td className="r num">{v.activePos}</td><td className="r num">{v.pendingPos || "—"}</td><td className={`r num ${v.delayedPos ? "font-bold text-[var(--red)]" : ""}`}>{v.delayedPos || "—"}</td><td className="r num">{inrShort(v.value)}</td>
            <td className="r num">{v.onTimePct == null ? <span className="text-faint">—</span> : `${v.onTimePct}%`}</td><td className="r num">{v.avgDelay == null ? "—" : `${v.avgDelay}d`}</td><td className="r num">{v.qualityPct == null ? "—" : `${v.qualityPct}%`}</td><td><StatusBadge status={v.health} /></td></tr>)}</tbody></table></div>)}</Card>
    </div>
  );
}
