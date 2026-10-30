import { describe, expect, it } from 'vitest';
import {
  areaCost,
  areaCostDetail,
  checkPrice,
  costText,
  costTooLarge,
  needsPackSize,
  packCost,
  packCostDetail,
  toKopecks,
} from './cost';

// Контрольные примеры — «Стоимость» в docs/calculators/*.md (посчитаны вручную).
const nbsp = ' ';
const cans = ['банка', 'банки', 'банок'] as const;

describe('цена', () => {
  it('пусто — можно; 0–1 000 000 ₽; не точнее копейки', () => {
    expect(checkPrice(null)).toBeNull();
    expect(checkPrice(0)).toBeNull();
    expect(checkPrice(1_000_000)).toBeNull();
    expect(checkPrice(2379.99)).toBeNull();
    expect(checkPrice(-1)).toBe('Значение не может быть отрицательным.');
    expect(checkPrice(1_000_000.01)).toBe('Не больше 1000000 ₽.');
    expect(checkPrice(2379.999)).toBe('Не точнее 1 копейки.');
  });

  it('рубли → целые копейки без двоичных дробей', () => {
    expect(toKopecks(2379.99)).toBe(237_999);
    expect(toKopecks(0.29)).toBe(29);
    expect(toKopecks(1849.9)).toBe(184_990);
  });
});

describe('стоимость упаковок', () => {
  it('П9, П13, Ш13, Шп15: упаковки × цена в копейках', () => {
    expect(packCost(5, 238_000)).toEqual({ ok: true, kopecks: 1_190_000 });
    expect(packCost(5, 237_999)).toEqual({ ok: true, kopecks: 1_189_995 });
    expect(packCost(23, 54_990)).toEqual({ ok: true, kopecks: 1_264_770 });
    expect(packCost(6, 84_550)).toEqual({ ok: true, kopecks: 507_300 });
    expect(packCost(5, 0)).toEqual({ ok: true, kopecks: 0 });
  });

  it('Ш15 — предел ещё точный; Т14 — больше 2⁵³ копеек — ошибка, а не неточное число', () => {
    expect(packCost(37_500_000, 100_000_000)).toEqual({ ok: true, kopecks: 3_750_000_000_000_000 });
    expect(packCost(1_875_000_000, 100_000_000)).toEqual({ ok: false, error: costTooLarge });
  });
});

describe('стоимость площади', () => {
  it('Т7, Т8, Т12: мм² × копейки за м² / 10⁶', () => {
    expect(areaCost(19_200_000, 125_000)).toEqual({ ok: true, kopecks: 2_400_000 });
    expect(areaCost(18_480_000, 125_000)).toEqual({ ok: true, kopecks: 2_310_000 });
    expect(areaCost(3_960_000, 99_000)).toEqual({ ok: true, kopecks: 392_040 });
  });

  it('Т9: округление до копейки, половина вверх; Т15 — большая площадь точно', () => {
    // 18 480 000 · 124 999 / 10⁶ = 2 309 981,52 → 2 309 982.
    expect(areaCost(18_480_000, 124_999)).toEqual({ ok: true, kopecks: 2_309_982 });
    expect(areaCost(1_500_000, 1)).toEqual({ ok: true, kopecks: 2 }); // 1,5 → 2
    expect(areaCost(1_400_000, 1)).toEqual({ ok: true, kopecks: 1 }); // 1,4 → 1
    expect(areaCost(750_000_000_000, 100_000_000)).toEqual({
      ok: true,
      kopecks: 75_000_000_000_000,
    });
  });
});

describe('вывод', () => {
  it('«Стоимость ≈ 11 900 ₽», разбивка «5 банок × 2 380 ₽», копейки — только ненулевые', () => {
    expect(costText(11_900)).toBe(`Стоимость ≈ 11${nbsp}900${nbsp}₽`);
    expect(costText(11_899.95)).toBe(`Стоимость ≈ 11${nbsp}899,95${nbsp}₽`);
    expect(packCostDetail(5, cans, 2380)).toBe(`5 банок × 2${nbsp}380${nbsp}₽`);
    expect(packCostDetail(1, cans, 4760)).toBe(`1 банка × 4${nbsp}760${nbsp}₽`);
    expect(areaCostDetail(18.48, 1250)).toBe(`18,48${nbsp}м² × 1${nbsp}250${nbsp}₽/м²`);
  });

  it('подсказка «укажите размер упаковки»: цена есть, упаковки нет', () => {
    expect(needsPackSize('2380', '')).toBe(true);
    expect(needsPackSize('0', '')).toBe(true);
    expect(needsPackSize('2380', '2,7')).toBe(false);
    expect(needsPackSize('', '')).toBe(false);
    expect(needsPackSize('много', '')).toBe(false);
    expect(needsPackSize('2380', '0')).toBe(true);
  });
});
