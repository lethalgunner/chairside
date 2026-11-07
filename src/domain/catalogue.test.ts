import { describe, expect, it } from 'vitest';
import { checkCatalogueItem, GST_RATES_BP, isGoodsCategory, suggestItemCode, type CatalogueItemInput } from './catalogue';

const base: CatalogueItemInput = {
  code: ' ngd ',
  name: '  Night   guard ',
  category: 'Prosthodontics',
  price: '2,500.50',
  taxCategory: 'goods_prosthetic',
  hsnSacCode: '9021',
  gstRateBp: 500,
};

describe('price list validation (T15)', () => {
  it('normalises code and name and stores the price as integer paise', () => {
    const r = checkCatalogueItem(base);
    expect(r).toEqual({
      ok: true,
      value: { code: 'NGD', name: 'Night guard', category: 'Prosthodontics', defaultPricePaise: 250_050, taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 500, isGoods: true },
    });
  });

  it('accepts a free item and refuses negative or malformed prices', () => {
    expect(checkCatalogueItem({ ...base, price: '0' })).toMatchObject({ ok: true, value: { defaultPricePaise: 0 } });
    expect(checkCatalogueItem({ ...base, price: '-1' })).toMatchObject({ ok: false, fieldErrors: { price: expect.stringMatching(/negative/) } });
    for (const price of ['', 'abc', '12.345', '1e3']) expect(checkCatalogueItem({ ...base, price }).ok, price).toBe(false);
  });

  it('allows only 0, 5, 12, 18, 28 and 40 % (stored as basis points)', () => {
    expect([...GST_RATES_BP]).toEqual([0, 500, 1200, 1800, 2800, 4000]);
    for (const rate of GST_RATES_BP) expect(checkCatalogueItem({ ...base, gstRateBp: rate }).ok).toBe(true);
    for (const rate of [3, 250, 1000, 1801, 5000, -500]) expect(checkCatalogueItem({ ...base, gstRateBp: rate }).ok, String(rate)).toBe(false);
  });

  it('forces exempt healthcare to 0 % whatever is sent', () => {
    const r = checkCatalogueItem({ ...base, taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 1800 });
    expect(r).toMatchObject({ ok: true, value: { gstRateBp: 0, isGoods: false } });
  });

  it('derives goods from the tax category, as the seed does', () => {
    expect(isGoodsCategory('goods_prosthetic')).toBe(true);
    expect(isGoodsCategory('goods_retail')).toBe(true);
    expect(isGoodsCategory('cosmetic_service')).toBe(false);
    expect(isGoodsCategory('exempt_healthcare')).toBe(false);
    expect(checkCatalogueItem({ ...base, taxCategory: 'cosmetic_service', hsnSacCode: '9997', gstRateBp: 1800 })).toMatchObject({ ok: true, value: { isGoods: false } });
  });

  it('checks code, name, HSN/SAC and tax category', () => {
    const r = checkCatalogueItem({ ...base, code: 'has space', name: 'X', hsnSacCode: '99', taxCategory: 'luxury' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(['code', 'hsnSacCode', 'name', 'taxCategory']);
    expect(checkCatalogueItem({ ...base, hsnSacCode: '902110' }).ok).toBe(true);
    expect(checkCatalogueItem({ ...base, hsnSacCode: '90211000' }).ok).toBe(true);
    expect(checkCatalogueItem({ ...base, hsnSacCode: '90211' }).ok).toBe(false);
    expect(checkCatalogueItem({ ...base, category: '' })).toMatchObject({ ok: true, value: { category: null } });
  });
});

describe('code for an item added from the bill', () => {
  const none = new Set<string>();
  it('uses initials for several words and the word for one', () => {
    expect(suggestItemCode('Root canal treatment', none)).toBe('RCT');
    expect(suggestItemCode('Scaling', none)).toBe('SCALING');
    expect(suggestItemCode('Bleaching (in-office)', none)).toBe('BIO');
    expect(suggestItemCode('Orthodontics', none)).toBe('ORTHODON');
  });
  it('falls back when the name has no usable letters', () => {
    expect(suggestItemCode('दांत', none)).toBe('ITEM');
    expect(suggestItemCode('X', none)).toBe('ITEM');
    expect(suggestItemCode('X ray', none)).toBe('XR');
  });
  it('adds a number when the code is taken', () => {
    expect(suggestItemCode('Root canal treatment', new Set(['RCT']))).toBe('RCT-2');
    expect(suggestItemCode('Root canal treatment', new Set(['RCT', 'RCT-2']))).toBe('RCT-3');
  });
  it('always passes the price list code rule', () => {
    const taken = new Set<string>();
    for (const name of ['Orthodontics', 'A b c d e f g h i j', 'दांत', 'Zirconia crown', 'Q']) {
      for (let i = 0; i < 12; i++) {
        const code = suggestItemCode(name, taken);
        taken.add(code);
        const r = checkCatalogueItem({ code, name: 'Valid name', category: '', price: '100', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 });
        expect(r.ok, code).toBe(true);
      }
    }
  });
});
