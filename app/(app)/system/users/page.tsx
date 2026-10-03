import { guard } from "@/lib/auth";
import { ROLES, RBAC, type RoleKey, type ModuleKey } from "@/lib/config";
import { getDb } from "@/lib/db";
import { PageHeader, Card, StatusBadge, Field } from "@/components/ui";
import { ModalButton, ActionForm, ActionButton } from "@/components/client";
import { Select } from "@/components/forms";
import { createUserAction, setUserActiveAction, changeRoleAction } from "@/app/actions/system";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Users & Roles" };
export const dynamic = "force-dynamic";
const MODS: [ModuleKey, string][] = [["crm", "CRM"], ["ai", "AI Inbox"], ["survey", "Survey"], ["design", "Design"], ["proposals", "Proposals"], ["projects", "Projects"], ["procurement", "Procurement"], ["receiving", "Receiving"], ["finance", "Finance"], ["documents", "Docs"], ["queries", "Queries"], ["analytics", "Analytics"], ["automation", "Automation"], ["system", "System"], ["portal", "Portal"]];

export default async function Users() {
  const me = await guard("system");
  const users = getDb().prepare("SELECT u.*, c.name customer FROM users u LEFT JOIN customers c ON c.id = u.customer_id ORDER BY u.active DESC, u.id").all() as any[];
  const customers = getDb().prepare("SELECT id, name FROM customers ORDER BY name LIMIT 300").all() as any[];
  const roleOpts = (Object.keys(ROLES) as RoleKey[]).map((r) => [r, ROLES[r].name] as [string, string]);
  return (
    <div>
      <PageHeader title="Users & roles" sub="Access is enforced on the server for every page and action."
        actions={<ModalButton label="Add user" icon="plus" title="Add user" width={480}>
          <ActionForm action={createUserAction} submitLabel="Create user" className="space-y-3">
            <Field label="Name *"><input name="name" required className="input" /></Field>
            <Field label="Email *"><input name="email" type="email" required className="input" /></Field>
            <Field label="Role *"><Select name="role" required options={roleOpts} /></Field>
            <Field label="Customer (portal users only)"><Select name="customer_id" placeholder="—" options={customers.map((c) => [String(c.id), c.name] as [string, string])} /></Field>
            <Field label="Temporary password *" hint="Minimum 8 characters"><input name="password" type="password" minLength={8} required className="input" autoComplete="new-password" /></Field>
          </ActionForm>
        </ModalButton>} />
      <Card flush className="mb-5">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Since</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className={u.active ? "" : "opacity-50"}>
              <td className="font-semibold">{u.name}{u.customer && <div className="text-xs font-normal text-muted">Portal · {u.customer}</div>}</td><td>{u.email}</td><td>{ROLES[u.role as RoleKey]?.name ?? u.role}</td><td><StatusBadge status={u.active ? "DONE" : "CLOSED"}>{u.active ? "Active" : "Disabled"}</StatusBadge></td><td>{fmtDate(u.created_at)}</td>
              <td className="r whitespace-nowrap">{u.id !== me.id && <span className="inline-flex gap-1.5">
                <ModalButton label="Role" title={`Change role — ${u.name}`} className="btn btn-sm" width={380}><ActionForm action={changeRoleAction.bind(null, u.id)} submitLabel="Change role" className="space-y-3"><Field label="Role"><Select name="role" defaultValue={u.role} options={roleOpts} /></Field></ActionForm></ModalButton>
                <ActionButton action={setUserActiveAction.bind(null, u.id, !u.active)} className="btn btn-sm" confirm={u.active ? `Disable ${u.name}? They will be signed out.` : `Re-enable ${u.name}?`} confirmLabel={u.active ? "Disable" : "Enable"} danger={!!u.active}>{u.active ? "Disable" : "Enable"}</ActionButton></span>}</td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      <Card title="Role permission matrix" flush>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Role</th>{MODS.map(([, l]) => <th key={l} className="text-center">{l}</th>)}</tr></thead>
          <tbody>{(Object.keys(ROLES) as RoleKey[]).map((r) => (
            <tr key={r}><td className="font-semibold">{ROLES[r].name}<div className="text-[11px] font-normal text-faint">{ROLES[r].description}</div></td>{MODS.map(([m]) => { const a = RBAC[r][m]; return <td key={m} className="text-center">{a === "w" ? <span className="badge b-green">Edit</span> : a === "r" ? <span className="badge">View</span> : <span className="text-faint">—</span>}</td>; })}</tr>))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
