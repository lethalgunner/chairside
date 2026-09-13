/**
 * GST for a dental practice.
 *
 * The rule most clinic software gets wrong: the healthcare exemption attaches
 * to the SERVICE, not to the goods. So a single invoice routinely mixes
 *
 *   - a root canal      exempt,  SAC 9993, 0%
 *   - a lab-made crown  taxable, HSN 9021, 12%
 *   - a toothbrush      taxable, HSN 3306, 18%
 *   - teeth whitening   taxable, cosmetic, outside the healthcare exemption
 *
 * and each of those has to print its own code, rate and amount. Tax is a
 * property of the LINE, never of the document.
 *
 * Two further rules encoded here:
 *   - A branch that is not GST-registered charges no tax on anything, whatever
 *     the catalogue says. Because healthcare is exempt, a branch whose TAXABLE
 *     turnover sits under the threshold need not register — and a chain can
 *     legitimately have registered and unregistered branches at once.
 *   - CGST and SGST are derived by splitting the total tax in two rather than
 *     computing each at half the rate independently, so they always sum back
 *     to the tax actually charged. Half-rate-each rounds twice and can drift a
 *     paisa, which is exactly the kind of thing an auditor circles.
 *
 * NOT LEGAL ADVICE. This encodes a planning summary from public sources as of
 * September 2026. BRD section 10.1 and open question Q5: a practising CA must
 * confirm the treatment — particularly the implant and cosmetic boundaries —
 * before any of it is represented to a customer.
 */

import {
  type Paise,
  ZERO,
  paise,
  add,
  subtract,
  multiply,
  applyRate,
  basisPoints,
  allocate,
  roundToRupee,
  isNegative,
} from './money';

export type TaxCategory =
  | 'exempt_healthcare'
  | 'goods_prosthetic'
  | 'goods_retail'
  | 'cosmetic_service'
  | 'other_taxable';

export interface CategoryDefault {
  hsnSacCode: string;
  gstRateBp: number;
  isGoods: boolean;
  label: string;
}

/**
 * Sensible defaults when a catalogue item is created. The item still stores its
 * own code and rate explicitly — these only prefill the form, so that a rate
 * change in a future budget does not silently rewrite the catalogue.
 */
export const CATEGORY_DEFAULTS: Record<TaxCategory, CategoryDefault> = {
  exempt_healthcare: {
    hsnSacCode: '9993',
    gstRateBp: 0,
    isGoods: false,
    label: 'Exempt healthcare service',
  },
  goods_prosthetic: {
    hsnSacCode: '9021',
    gstRateBp: 1200,
    isGoods: true,
    label: 'Dental prosthetic or implant component',
  },
  goods_retail: {
    hsnSacCode: '3306',
    gstRateBp: 1800,
    isGoods: true,
    label: 'Oral care product sold at reception',
  },
  cosmetic_service: {
    hsnSacCode: '9997',
    gstRateBp: 1800,
    isGoods: false,
    label: 'Cosmetic procedure (outside the healthcare exemption)',
  },
  other_taxable: {
    hsnSacCode: '',
    gstRateBp: 1800,
    isGoods: false,
    label: 'Other taxable supply',
  },
};

export interface TaxProfile {
  /** When false, no tax is charged on anything at this branch. */
  gstRegistered: boolean;
  gstin?: string | null;
  /** Two-letter or full state name; only used to decide intra vs inter-state. */
  placeOfSupplyState?: string | null;
}

export interface LineInput {
  description: string;
  quantity: number;
  unitPricePaise: Paise;
  discountPaise?: Paise;
  discountReason?: string;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
  catalogueItemId?: string;
  procedureId?: string;
}

export interface ComputedLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPricePaise: Paise;
  discountPaise: Paise;
  discountReason?: string;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  /** The rate actually applied — 0 if the branch is unregistered. */
  gstRateBp: number;
  /** Value after discount, on which tax is computed. */
  taxableValuePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  lineTotalPaise: Paise;
  isExempt: boolean;
  catalogueItemId?: string;
  procedureId?: string;
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  /** Gross of discount, before tax. */
  subtotalPaise: Paise;
  discountPaise: Paise;
  /** Net value of lines that carry tax. */
  taxablePaise: Paise;
  /** Net value of lines that do not. */
  exemptPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  /** Difference between the raw total and the rounded payable figure. */
  roundingPaise: Paise;
  totalPaise: Paise;
}

export class TaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxError';
  }
}

/** True when the supply crosses a state line and so attracts IGST instead of CGST+SGST. */
function isInterState(branchState?: string | null, placeOfSupply?: string | null): boolean {
  if (!branchState || !placeOfSupply) return false;
  return branchState.trim().toLowerCase() !== placeOfSupply.trim().toLowerCase();
}

/**
 * Compute one invoice from its lines.
 *
 * `branchState` is where the clinic is; `profile.placeOfSupplyState` is where
 * the supply is deemed to occur. For a patient walking into a clinic these are
 * the same and the answer is CGST + SGST, which is the overwhelmingly common
 * case for dentistry.
 */
export function computeInvoice(
  lines: LineInput[],
  profile: TaxProfile,
  branchState?: string | null,
): ComputedInvoice {
  if (lines.length === 0) {
    throw new TaxError('An invoice must have at least one line.');
  }

  const interState = isInterState(branchState, profile.placeOfSupplyState);
  const computed: ComputedLine[] = [];

  lines.forEach((line, i) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new TaxError(
        `Line ${i + 1} (${line.description}) has quantity ${line.quantity}; must be a positive whole number.`,
      );
    }
    if (isNegative(line.unitPricePaise)) {
      throw new TaxError(`Line ${i + 1} (${line.description}) has a negative price.`);
    }

    const gross = multiply(line.unitPricePaise, line.quantity);
    const discount = line.discountPaise ?? ZERO;
    if (isNegative(discount)) {
      throw new TaxError(`Line ${i + 1} (${line.description}) has a negative discount.`);
    }
    if (discount > gross) {
      throw new TaxError(
        `Line ${i + 1} (${line.description}) has a discount of ${discount} paise ` +
          `exceeding its value of ${gross} paise.`,
      );
    }

    const netValue = subtract(gross, discount);

    // An unregistered branch charges nothing, whatever the item says.
    const effectiveRateBp = profile.gstRegistered ? line.gstRateBp : 0;
    if (effectiveRateBp < 0) {
      throw new TaxError(`Line ${i + 1} (${line.description}) has a negative GST rate.`);
    }

    const totalTax = applyRate(netValue, basisPoints(effectiveRateBp));

    let cgst = ZERO;
    let sgst = ZERO;
    let igst = ZERO;
    if (totalTax !== 0) {
      if (interState) {
        igst = totalTax;
      } else {
        // Split rather than compute each half independently, so the two halves
        // always sum exactly to the tax charged.
        const [c, s] = allocate(totalTax, [1, 1]);
        cgst = c ?? ZERO;
        sgst = s ?? ZERO;
      }
    }

    computed.push({
      lineNumber: i + 1,
      description: line.description,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      discountPaise: discount,
      discountReason: line.discountReason,
      taxCategory: line.taxCategory,
      hsnSacCode: line.hsnSacCode,
      gstRateBp: effectiveRateBp,
      taxableValuePaise: netValue,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      lineTotalPaise: add(netValue, cgst, sgst, igst),
      isExempt: effectiveRateBp === 0,
      catalogueItemId: line.catalogueItemId,
      procedureId: line.procedureId,
    });
  });

  const subtotal = add(...computed.map((l) => multiply(l.unitPricePaise, l.quantity)));
  const discount = add(...computed.map((l) => l.discountPaise));
  const taxable = add(...computed.filter((l) => !l.isExempt).map((l) => l.taxableValuePaise));
  const exempt = add(...computed.filter((l) => l.isExempt).map((l) => l.taxableValuePaise));
  const cgst = add(...computed.map((l) => l.cgstPaise));
  const sgst = add(...computed.map((l) => l.sgstPaise));
  const igst = add(...computed.map((l) => l.igstPaise));

  const rawTotal = add(taxable, exempt, cgst, sgst, igst);
  const rounded = roundToRupee(rawTotal);
  const rounding = subtract(rounded, rawTotal);

  return {
    lines: computed,
    subtotalPaise: subtotal,
    discountPaise: discount,
    taxablePaise: taxable,
    exemptPaise: exempt,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    roundingPaise: rounding,
    totalPaise: rounded,
  };
}

/**
 * Outward supply summary for the GST working papers — the split an accountant
 * needs in order to file, grouped by HSN/SAC as the return expects.
 */
export interface HsnSummaryRow {
  hsnSacCode: string;
  taxCategory: TaxCategory;
  gstRateBp: number;
  valuePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export function summariseByHsn(invoices: ComputedInvoice[]): HsnSummaryRow[] {
  const rows = new Map<string, HsnSummaryRow>();
  for (const inv of invoices) {
    for (const line of inv.lines) {
      const key = `${line.hsnSacCode}|${line.taxCategory}|${line.gstRateBp}`;
      const existing = rows.get(key);
      if (existing) {
        existing.valuePaise = add(existing.valuePaise, line.taxableValuePaise);
        existing.cgstPaise = add(existing.cgstPaise, line.cgstPaise);
        existing.sgstPaise = add(existing.sgstPaise, line.sgstPaise);
        existing.igstPaise = add(existing.igstPaise, line.igstPaise);
      } else {
        rows.set(key, {
          hsnSacCode: line.hsnSacCode,
          taxCategory: line.taxCategory,
          gstRateBp: line.gstRateBp,
          valuePaise: line.taxableValuePaise,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          igstPaise: line.igstPaise,
        });
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.hsnSacCode.localeCompare(b.hsnSacCode) || a.gstRateBp - b.gstRateBp,
  );
}

/**
 * Proportion of input tax credit a branch may claim, as basis points.
 *
 * Where inputs serve both exempt and taxable supplies, credit is available only
 * in the proportion that taxable supplies bear to total supplies. A clinic
 * doing mostly exempt treatment recovers very little — which is itself worth
 * showing the owner, because it changes how they think about pricing goods.
 */
export function itcEligibleBp(taxableValue: Paise, exemptValue: Paise): number {
  const total = add(taxableValue, exemptValue);
  if (total === 0) return 0;
  return Math.round((taxableValue / total) * 10_000);
}

/** Convenience for tests and seeds: build a line from a category's defaults. */
export function lineFromCategory(
  description: string,
  unitPricePaise: Paise,
  taxCategory: TaxCategory,
  opts: { quantity?: number; discountPaise?: Paise } = {},
): LineInput {
  const d = CATEGORY_DEFAULTS[taxCategory];
  return {
    description,
    quantity: opts.quantity ?? 1,
    unitPricePaise,
    discountPaise: opts.discountPaise ?? paise(0),
    taxCategory,
    hsnSacCode: d.hsnSacCode,
    gstRateBp: d.gstRateBp,
  };
}
