import { requireContext } from '@/lib/auth';
import { getPrintHeader, listBranches } from '@/services/branches';
import { canDo } from '@/services/context';
import { Empty, PageHead } from '@/components/ui';
import PrintHeaderForm from './PrintHeaderForm';

/** Settings → Bill header (Sprint 5, LET-174). Owner only, one header per branch. */
export default async function PrintSettingsPage() {
  const ctx = await requireContext();
  const branches = (await listBranches(ctx)).filter((b) => canDo(ctx, 'branch.manage', b.id));
  if (branches.length === 0) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Bill header" />
        <Empty>Only the owner can change what prints on bills.</Empty>
      </>
    );
  }
  const headers = await Promise.all(branches.map((b) => getPrintHeader(ctx, b.id)));
  return (
    <>
      <PageHead eyebrow="Settings" title="Bill header" sub="What prints at the top and bottom of bills, estimates and prescriptions. Empty fields use the branch details. GSTIN prints only for a GST-registered branch." />
      {headers.map((h, i) => (
        <PrintHeaderForm key={h.branchId} branchId={h.branchId} branchName={branches[i]!.name} initial={h.settings} preview={{ name: h.name, addressLines: h.addressLines, phone: h.phone, email: h.email, gstin: h.gstin, footer: h.footer, logo: h.logo }} />
      ))}
    </>
  );
}
