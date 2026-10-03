import Link from "next/link";
import { guard } from "@/lib/auth";
import { can, DOC_TYPES } from "@/lib/config";
import { listDocuments } from "@/lib/services/misc";
import { getDb } from "@/lib/db";
import { PageHeader, Card, EmptyState, Field } from "@/components/ui";
import { ModalButton, ActionForm, SearchBox } from "@/components/client";
import { Select } from "@/components/forms";
import { uploadDocumentAction } from "@/app/actions/ops";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function Documents({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await guard("documents");
  const sp = await searchParams;
  const rows = listDocuments({ q: sp.q, type: sp.type, project: sp.project ? Number(sp.project) : undefined });
  const w = can(user.role, "documents", "w");
  const projects = getDb().prepare("SELECT id, code, name FROM projects ORDER BY id DESC LIMIT 100").all() as any[];
  return (
    <div>
      <PageHeader title="Documents" sub="Every document belongs to a customer, lead, project, module and type."
        actions={<><SearchBox defaultValue={sp.q} placeholder="Search documents…" />{w && (
          <ModalButton label="Upload" icon="upload" title="Upload document" width={500}>
            <ActionForm action={uploadDocumentAction} submitLabel="Upload" className="space-y-3">
              <Field label="Project *"><Select name="project_id" required placeholder="Select…" options={projects.map((p) => [String(p.id), `${p.code} — ${p.name}`] as [string, string])} /></Field>
              <Field label="Document type *"><Select name="doc_type" required options={[...DOC_TYPES]} /></Field>
              <Field label="File * (max 15 MB)"><input name="file" type="file" required className="input !h-auto py-1.5 text-xs" /></Field>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="customer_visible" className="h-4 w-4 accent-[var(--green-600)]" /> Show in customer portal</label>
            </ActionForm>
          </ModalButton>)}</>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/documents" className={`btn btn-sm ${!sp.type ? "btn-dark" : ""}`}>All types</Link>
        {DOC_TYPES.map((t) => <Link key={t} href={`/documents?type=${encodeURIComponent(t)}`} className={`btn btn-sm ${sp.type === t ? "btn-dark" : ""}`}>{t}</Link>)}
      </div>
      <Card flush>
        {rows.length === 0 ? <EmptyState icon="folder" title="No documents" body="Upload documents, or they arrive automatically from surveys, designs and proposals." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Customer</th><th>Lead</th><th>Project</th><th>Portal</th><th>Added</th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}><td className="font-semibold">{d.file_path ? <a className="lnk" href={`/api/files/${d.file_path}`} target="_blank">{d.name}</a> : d.name}</td><td>{d.doc_type}</td><td>{d.customer_name}</td><td className="num">{d.lead_code ?? "—"}</td><td>{d.project_id ? <Link className="lnk num" href={`/projects/${d.project_id}`}>{d.project_code}</Link> : "—"}</td><td>{d.customer_visible ? <span className="badge b-green">Visible</span> : <span className="badge">Internal</span>}</td><td>{fmtDate(d.created_at)}</td></tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
