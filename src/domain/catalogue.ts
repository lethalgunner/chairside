/**
 * Price list rules (Pilot 0 slice 2, T15). Pure and unit-tested; the settings
 * screen and the service both use them.
 *
 * UNVERIFIED (Q6): the permitted GST rates are deliberately permissive until a
 * CA confirms the treatment of each item. GST 2.0 (22 Sep 2025) moved most
 * goods to 5/18/40 %, but 12 and 28 stay allowed so nothing already loaded
 * becomes unsavable. Issued bills keep the rate snapshotted on their lines.
 */
import { fromRupeeString, type Paise } from './money';
import type { Checked, FieldErrors } from './staff';
import type { TaxCategory } from './tax';

export const GST_RATES_BP = [0, 500, 1200, 1800, 2800, 4000] as const;

export const TAX_CATEGORIES: readonly TaxCategory[] = ['exempt_healthcare', 'goods_prosthetic', 'goods_retail', 'cosmetic_service', 'other_taxable'];

/** Goods rather than services: drives inventory and ITC later. Same rule the seed has always used. */
export function isGoodsCategory(c: TaxCategory): boolean {
  return c.startsWith('goods');
}

export interface CatalogueItemInput {
  code: string;
  name: string;
  category: string;
  /** Rupees as typed, e.g. "1500" or "1,500.50". */
  price: string;
  taxCategory: string;
  hsnSacCode: string;
  gstRateBp: number;
}

export interface CatalogueItemValues {
  code: string;
  name: string;
  category: string | null;
  defaultPricePaise: Paise;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
  isGoods: boolean;
}

export function checkCatalogueItem(input: CatalogueItemInput): Checked<CatalogueItemValues> {
  const fieldErrors: FieldErrors = {};
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(code)) fieldErrors.code = 'Use 1 to 12 letters, digits or dashes, like RCT or CRN-ZR.';
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) fieldErrors.name = 'Enter a name (2 to 80 characters).';
  const category = input.category.trim().replace(/\s+/g, ' ') || null;
  if (category && category.length > 40) fieldErrors.category = 'Keep the category under 40 characters.';

  let price: Paise | null = null;
  try {
    price = fromRupeeString(input.price);
    if (price < 0) {
      price = null;
      fieldErrors.price = 'The price can’t be negative.';
    }
  } catch {
    fieldErrors.price = 'Enter the price in rupees, like 1500 or 1500.50.';
  }

  const taxCategory = TAX_CATEGORIES.find((c) => c === input.taxCategory);
  if (!taxCategory) fieldErrors.taxCategory = 'Pick how GST treats this item.';
  const hsnSacCode = input.hsnSacCode.trim();
  if (!/^\d{4}(\d{2}){0,2}$/.test(hsnSacCode)) fieldErrors.hsnSacCode = 'HSN/SAC is 4, 6 or 8 digits, like 9993.';

  // Exempt healthcare is always 0 %, whatever was sent.
  const gstRateBp = taxCategory === 'exempt_healthcare' ? 0 : input.gstRateBp;
  if (!(GST_RATES_BP as readonly number[]).includes(gstRateBp)) fieldErrors.gstRateBp = 'GST rate must be 0, 5, 12, 18, 28 or 40 %.';

  if (Object.keys(fieldErrors).length > 0 || price === null || !taxCategory) return { ok: false, fieldErrors };
  return { ok: true, value: { code, name, category, defaultPricePaise: price, taxCategory, hsnSacCode, gstRateBp, isGoods: isGoodsCategory(taxCategory) } };
}
