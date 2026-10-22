import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { getBranch } from '@/services/branches';
import { canDo } from '@/services/context';
import { getPatient } from '@/services/patients';
import { openBillsForReceipt } from '@/services/receipts';
import { patientAccount } from '@/services/reports';
import { PageHead } from '@/components/ui';
import ReceiptForm from './ReceiptForm';

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ patient?: string; amount?: string; again?: string }> }) {
  const ctx = await requireContext();
  const { patient: patientId = '', amount = '', again = '' } = await searchParams;
  // Only a plain rupee figure is accepted from the link; anything else starts empty.
  const initialAmount = /^\d{1,9}(\.\d{1,2})?$/.test(amount) ? amount : '';
  const patient = await getPatient(ctx, patientId);
  if (!patient) notFound();
  if (ctx.activeBranchId === 'all' || !canDo(ctx, 'receipt.record', ctx.activeBranchId)) {
    return (
      <>
        <PageHead title="Record payment" />
        <div className="callout warn">Pick the branch where the money was received in the sidebar.</div>
        <Link className="secondary" href={`/patients/${patient.id}`}>Back to {patient.fullName}</Link>
      </>
    );
  }
  const branch = await getBranch(ctx, ctx.activeBranchId);
  const [open, account] = await Promise.all([openBillsForReceipt(ctx, patient.id), patientAccount(ctx, patient.id)]);
  return (
    <>
      <PageHead eyebrow={branch.name} title={`Payment from ${patient.fullName}`} sub={patient.fileNumbers.join(', ')} />
      <ReceiptForm key={`${patient.id}:${again}`} initialAmount={initialAmount} patient={{ id: patient.id, name: patient.fullName }} branchName={branch.name} open={open} balancePaise={account.balancePaise} />
    </>
  );
}
