import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { getBranch } from '@/services/branches';
import { listCatalogue, listDoctors } from '@/services/catalogue';
import { canDo } from '@/services/context';
import { settingsAccess } from '@/services/settings';
import { CATEGORY_DEFAULTS } from '@/domain/tax';
import { GST_RATES_BP, TAX_CATEGORIES } from '@/domain/catalogue';
import { getPatient } from '@/services/patients';
import { unbilledProcedures } from '@/services/reports';
import { PageHead } from '@/components/ui';
import { formatIndianMobile } from '@/domain/phone';
import BillBuilder from './BillBuilder';

export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const ctx = await requireContext();
  const { patient: patientId = '' } = await searchParams;
  const patient = await getPatient(ctx, patientId);
  if (!patient) notFound();
  if (ctx.activeBranchId === 'all' || !canDo(ctx, 'invoice.issue', ctx.activeBranchId)) {
    return (
      <>
        <PageHead title="New bill" />
        <div className="callout warn">Pick the branch you are billing from in the branch menu. A bill can’t move branches once it has a number.</div>
        <Link className="secondary" href={`/patients/${patient.id}`}>Back to {patient.fullName}</Link>
      </>
    );
  }
  const branchId = ctx.activeBranchId;
  const [branch, catalogue, doctors, unbilled] = await Promise.all([
    getBranch(ctx, branchId),
    listCatalogue(ctx, branchId),
    listDoctors(ctx, branchId),
    unbilledProcedures(ctx, [branchId]),
  ]);
  const pending = unbilled.filter((u) => u.patientId === patient.id);
  // Owner only: "+ New item" adds to the price list from here (catalogue.manage, same as Settings → Price list).
  const canAddItems = settingsAccess(ctx).catalogue;
  const missing = doctors.length === 0 ? 'doctors' : catalogue.length === 0 && !canAddItems ? 'price list' : null;

  return (
    <>
      <PageHead eyebrow={`${branch.name} · ${patient.fileNumbers.join(', ')}`} title={`Bill for ${patient.fullName}`} sub={patient.age !== null ? `${patient.age} yrs · ${formatIndianMobile(patient.phone)}` : formatIndianMobile(patient.phone)} />
      {missing ? (
        <div className="callout warn">This branch has no {missing} set up yet. Ask the owner to add {missing === 'doctors' ? 'them' : 'it'}.</div>
      ) : (
        <BillBuilder
          patient={{ id: patient.id, name: patient.fullName }}
          branch={{ id: branch.id, name: branch.name, gstRegistered: branch.gstRegistered, gstin: branch.gstin, state: branch.state }}
          catalogue={catalogue}
          doctors={doctors}
          newItem={canAddItems ? { taxCategories: TAX_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_DEFAULTS[c].label, hsnSacCode: CATEGORY_DEFAULTS[c].hsnSacCode, gstRateBp: CATEGORY_DEFAULTS[c].gstRateBp })), rates: [...GST_RATES_BP] } : null}
          unbilled={pending.map((u) => ({ procedureId: u.procedureId, name: u.itemName, doctorName: u.doctorName, valuePaise: u.valuePaise }))}
        />
      )}
    </>
  );
}
