import { requireContext } from '@/lib/auth';
import { FORM_LABEL, MEDICINE_FORMS } from '@/domain/rx';
import { listCatalogue } from '@/services/catalogue';
import { canAnywhere } from '@/services/context';
import { listMedicines, listTemplates } from '@/services/rx';
import { Empty, PageHead } from '@/components/ui';
import MedicinesEditor from './MedicinesEditor';
import TemplatesEditor from './TemplatesEditor';

/** Settings → Medicines and templates (Sprint 5, LET-172). Owner, managers and doctors. */
export default async function MedicinesPage() {
  const ctx = await requireContext();
  if (!canAnywhere(ctx, 'medicine.manage')) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Medicines and templates" />
        <Empty>Medicines are managed by the owner, managers and doctors.</Empty>
      </>
    );
  }
  const branch = ctx.activeBranchId === 'all' ? ctx.branchIds[0]! : ctx.activeBranchId;
  const [meds, templates, catalogue] = await Promise.all([listMedicines(ctx), listTemplates(ctx), listCatalogue(ctx, branch)]);
  return (
    <>
      <PageHead eyebrow="Settings" title="Medicines and templates" sub="Doses here are only defaults that fill the prescription; the doctor checks every prescription before signing." />
      <MedicinesEditor medicines={meds} forms={MEDICINE_FORMS.map((f) => ({ value: f, label: FORM_LABEL[f] }))} />
      <TemplatesEditor templates={templates} medicines={meds.filter((m) => m.active)} treatments={catalogue.map((c) => ({ id: c.id, name: c.name }))} />
    </>
  );
}
