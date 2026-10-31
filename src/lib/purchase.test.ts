import { describe, expect, it } from 'vitest';
import { packagePurchase } from './purchase';

const cans = ['банка', 'банки', 'банок'] as const;
const bags = ['мешок', 'мешка', 'мешков'] as const;
const packs = ['упаковка', 'упаковки', 'упаковок'] as const;

describe('«К покупке» — упаковки', () => {
  it('главная цифра — число упаковок, подпись склоняется по числу', () => {
    expect(packagePurchase(1, cans, '30 л', '26,8 л')).toEqual({
      number: '1',
      unit: 'банка по 30 л',
      summary: '1 банка по 30 л',
      purchase: '1 банка по 30 л — нужно 26,8 л',
    });
    expect(packagePurchase(23, bags, '25 кг', '568,4 кг').summary).toBe('23 мешка по 25 кг');
    expect(packagePurchase(18, packs, '11 шт.', '196 плиток').purchase).toBe(
      '18 упаковок по 11 шт. — нужно 196 плиток',
    );
  });

  it('склонения: 2–4, 5–20, 11–14, 21, 22', () => {
    expect(
      [2, 5, 11, 14, 21, 22].map((count) => packagePurchase(count, cans, '2,7 л', '').unit),
    ).toEqual([
      'банки по 2,7 л',
      'банок по 2,7 л',
      'банок по 2,7 л',
      'банок по 2,7 л',
      'банка по 2,7 л',
      'банки по 2,7 л',
    ]);
  });
});
