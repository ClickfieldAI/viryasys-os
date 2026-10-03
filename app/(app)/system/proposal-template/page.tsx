import { guard } from "@/lib/auth";
import { getTemplate } from "@/lib/services/proposals";
import { buildSampleVars } from "@/lib/services/proposals-sample";
import { PageHeader } from "@/components/ui";
import { ProposalEditor } from "@/components/proposal-editor";
import { saveTemplateAction, uploadLogoAction } from "@/app/actions/work";

export const metadata = { title: "Proposal template" };
export const dynamic = "force-dynamic";

export default async function TemplatePage() {
  await guard("system", "w");
  const t = getTemplate();
  const { vars, items, taxes, terms } = buildSampleVars();
  return (
    <div>
      <PageHeader crumbs={[{ label: "Proposals", href: "/proposals" }]} title="Proposal template" sub="Edit sections, wording, order, visibility, branding and variables. New proposals are generated from this template; existing versions keep the wording they were created with." />
      <ProposalEditor key={t.id} mode="template" editable doc={t.doc} vars={vars} items={items} discount={0} taxes={taxes} terms={terms} save={saveTemplateAction.bind(null, t.id)} uploadLogo={uploadLogoAction} />
    </div>
  );
}
