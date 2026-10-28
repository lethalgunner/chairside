import { requireContext } from '@/lib/auth';
import { STATES } from '@/domain/branch';
import { toRupeeString } from '@/domain/money';
import { listBranchSettings } from '@/services/branches';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import BranchForm from './BranchForm';

export default async function BranchesPage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).branches) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Branches" />
        <Empty>Only the owner can change branch details.</Empty>
      </>
    );
  }
  const branches = await listBranchSettings(ctx);
  return (
    <>
      <PageHead eyebrow="Settings" title="Branches" sub="Bills already issued keep the GST status and GSTIN they were issued under." />
      {branches.map((b) => (
        <BranchForm
          key={b.id}
          states={[...STATES]}
          branch={{
            id: b.id,
            code: b.code,
            name: b.name,
            addressLine: b.addressLine ?? '',
            city: b.city ?? '',
            state: b.state ?? '',
            phone: b.phone ?? '',
            gstRegistered: b.gstRegistered,
            gstin: b.gstin ?? '',
            dayCloseTolerance: toRupeeString(b.dayCloseTolerancePaise),
            defaultFloat: toRupeeString(b.defaultFloatPaise),
            upiId: b.upiId ?? '',
            upiPayee: b.upiPayee ?? '',
          }}
        />
      ))}
    </>
  );
}
