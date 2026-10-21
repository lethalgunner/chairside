import { requireContext } from '@/lib/auth';
import { CATEGORY_DEFAULTS } from '@/domain/tax';
import { GST_RATES_BP, TAX_CATEGORIES } from '@/domain/catalogue';
import { toRupeeString } from '@/domain/money';
import { listCatalogueForSettings } from '@/services/catalogue';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import CatalogueEditor from './CatalogueEditor';

export default async function CataloguePage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).catalogue) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Price list" />
        <Empty>Only the owner or a branch manager can change the price list.</Empty>
      </>
    );
  }
  const items = await listCatalogueForSettings(ctx);
  return (
    <>
      <PageHead eyebrow="Settings" title="Price list" sub="One price list for every branch. Deactivated items stay on old bills but can’t be added to new ones." />
      <div className="callout warn" role="note">GST rates are not yet confirmed by a CA. Issued bills keep the rate they were issued with.</div>
      <CatalogueEditor
        items={items.map((i) => ({ ...i, price: toRupeeString(i.pricePaise) }))}
        taxCategories={TAX_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_DEFAULTS[c].label, hsnSacCode: CATEGORY_DEFAULTS[c].hsnSacCode, gstRateBp: CATEGORY_DEFAULTS[c].gstRateBp }))}
        rates={[...GST_RATES_BP]}
      />
    </>
  );
}
