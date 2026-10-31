/**
 * Контрольные примеры docs/calculators/TILE.md (Т1–Т6, стоимость Т7–Т15). Числа взяты из документа, где они посчитаны вручную.
 */
import { describe, expect, it } from 'vitest';
import { calculateTile, type TileErrors, type TileInput, type TileResult } from './tile';

const base: TileInput = {
  surface: 'floor',
  surfaceLength: 2,
  surfaceWidth: 1.5,
  surfaceCount: 1,
  tileLength: 300,
  tileWidth: 300,
  joint: 2,
  reserve: 0,
  tilesPerPack: null,
  tilePrice: null,
  tilePriceUnit: 'm2',
};

function calc(overrides: Partial<TileInput>): TileResult {
  const calculation = calculateTile({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

function errorsOf(overrides: Partial<TileInput>): TileErrors {
  const calculation = calculateTile({ ...base, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка');
  return calculation.errors;
}

describe('контрольные примеры Т1–Т6', () => {
  it('Т1: пол 2,0 × 1,5 м, 300 × 300, шов 2 — 7 × 5 = 35; запас 10 % → 39; по 11 → 4 упаковки (44)', () => {
    const result = calc({ reserve: 10, tilesPerPack: 11 });
    expect([result.alongLength, result.alongWidth, result.tiles]).toEqual([7, 5, 35]);
    expect([result.tilesWithReserve, result.packs, result.tilesToBuy]).toEqual([39, 4, 44]);
    expect([result.area, result.areaTiles]).toEqual([3, 34]);
  });

  it('Т2: ровно по сетке 1,21 × 0,61 м, 600 × 300, шов 10 — 2 × 2 = 4, без лишнего ряда; по площади 5', () => {
    const result = calc({ surfaceLength: 1.21, surfaceWidth: 0.61, tileLength: 600, joint: 10 });
    expect([result.alongLength, result.alongWidth, result.tiles]).toEqual([2, 2, 4]);
    expect(result.areaTiles).toBe(5);
    expect(result.area).toBeCloseTo(0.7381, 10);
  });

  it('Т3: 2 стены 2,5 × 2,7 м, 600 × 200 — 5 × 14 × 2 = 140; запас 10 % → 154; по 8 → 20 упаковок (160)', () => {
    const result = calc({
      surface: 'wall',
      surfaceLength: 2.5,
      surfaceWidth: 2.7,
      surfaceCount: 2,
      tileLength: 600,
      tileWidth: 200,
      reserve: 10,
      tilesPerPack: 8,
    });
    expect([result.surface, result.alongLength, result.alongWidth, result.tiles]).toEqual([
      'wall',
      5,
      14,
      140,
    ]);
    expect([result.tilesWithReserve, result.packs, result.tilesToBuy]).toEqual([154, 20, 160]);
    expect([result.area, result.areaTiles]).toEqual([13.5, 113]);
  });

  it('Т4: запас 5 % → ⌈36,75⌉ = 37; 0 % и пусто → 35', () => {
    expect(calc({ reserve: 5 }).tilesWithReserve).toBe(37);
    expect(calc({ reserve: 0 }).tilesWithReserve).toBe(35);
    expect(calc({ reserve: null }).tilesWithReserve).toBe(35);
  });

  it('Т5: плитка больше поверхности 0,2 × 0,2 м — 1 плитка; запас 10 % → 2', () => {
    const result = calc({
      surfaceLength: 0.2,
      surfaceWidth: 0.2,
      tileLength: 600,
      tileWidth: 600,
      reserve: 10,
    });
    expect([result.tiles, result.tilesWithReserve, result.areaTiles]).toEqual([1, 2, 1]);
  });

  it('Т6: 3,0 × 2,0 м без шва — 10 × 7 = 70; запас 10 % → ровно 77, не 78', () => {
    const result = calc({ surfaceLength: 3, surfaceWidth: 2, joint: 0, reserve: 10 });
    expect([result.alongLength, result.alongWidth, result.tiles, result.tilesWithReserve]).toEqual([
      10, 7, 70, 77,
    ]);
    expect(result.areaTiles).toBe(67);
  });

  it('шов увеличивает шаг: 2,0 м плиткой 300 мм — без шва 7 (2100 ≥ 2000), со швом 20 мм — ⌈2020/320⌉ = 7, 50 мм нельзя', () => {
    expect(calc({ joint: 0 }).alongLength).toBe(7);
    expect(calc({ joint: 20 }).alongLength).toBe(7);
    expect(calc({ joint: 1.5 }).joint).toBe(1.5);
  });
});

describe('проверка ввода', () => {
  it('пустые обязательные поля и тип поверхности', () => {
    expect(
      errorsOf({
        surface: null,
        surfaceLength: null,
        surfaceWidth: null,
        tileLength: null,
        tileWidth: null,
      }),
    ).toEqual({
      surface: 'Выберите тип поверхности.',
      surfaceLength: 'Заполните поле.',
      surfaceWidth: 'Заполните поле.',
      tileLength: 'Заполните поле.',
      tileWidth: 'Заполните поле.',
    });
    expect(errorsOf({ surface: 'roof' }).surface).toBe('Выберите тип поверхности.');
  });

  it('размеры поверхности: 0, −1 и 100,1 м — ошибки; 0,1 и 100 допустимы', () => {
    expect(errorsOf({ surfaceLength: 0 }).surfaceLength).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ surfaceWidth: -1 }).surfaceWidth).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ surfaceLength: 100.1 }).surfaceLength).toBe('Не больше 100 м.');
    expect(calc({ surfaceLength: 0.1, surfaceWidth: 0.1 }).tiles).toBe(1);
    expect(calc({ surfaceLength: 100, surfaceWidth: 100, joint: 0 }).tiles).toBe(334 * 334);
  });

  it('плитка: 19, 3001, 300,5 мм — ошибки; 20 и 3000 допустимы', () => {
    expect(errorsOf({ tileLength: 19 }).tileLength).toBe('Не меньше 20 мм.');
    expect(errorsOf({ tileWidth: 3001 }).tileWidth).toBe('Не больше 3000 мм.');
    expect(errorsOf({ tileLength: 300.5 }).tileLength).toBe('Введите целое число.');
    expect(calc({ tileLength: 3000, tileWidth: 20, joint: 0 }).tiles).toBe(75);
  });

  it('шов: −1, 21, 2,55 мм — ошибки; 0 и 20 допустимы', () => {
    expect(errorsOf({ joint: -1 }).joint).toBe('Значение не может быть отрицательным.');
    expect(errorsOf({ joint: 21 }).joint).toBe('Не больше 20 мм.');
    expect(errorsOf({ joint: 2.55 }).joint).toBe('Не больше одного знака после запятой.');
  });

  it('поверхностей 0 и 1,5, запас 51 и 5,55, в упаковке 0 и 1,5 — ошибки у полей', () => {
    expect(errorsOf({ surfaceCount: 0 }).surfaceCount).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ surfaceCount: 1.5 }).surfaceCount).toBe('Введите целое число.');
    expect(errorsOf({ reserve: 51 }).reserve).toBe('Не больше 50 %.');
    expect(errorsOf({ reserve: 5.55 }).reserve).toBe('Не больше одного знака после запятой.');
    expect(errorsOf({ tilesPerPack: 0 }).tilesPerPack).toBe('Не меньше 1 шт.');
    expect(errorsOf({ tilesPerPack: 1.5 }).tilesPerPack).toBe('Введите целое число.');
  });
});

describe('стоимость Т7–Т15 (D-033)', () => {
  const t3: Partial<TileInput> = {
    surface: 'wall',
    surfaceLength: 2.5,
    surfaceWidth: 2.7,
    surfaceCount: 2,
    tileLength: 600,
    tileWidth: 200,
    reserve: 10,
    tilesPerPack: 8,
  };

  it('Т7: за м² — купленная площадь 20 упаковок × 8 × 0,12 = 19,2 м² × 1 250 ₽ = 24 000 ₽', () => {
    const result = calc({ ...t3, tilePrice: 1250 });
    expect([result.packs, result.boughtArea, result.totalCost]).toEqual([20, 19.2, 24_000]);
    expect([result.tilePriceUnit, result.costNeedsPack]).toEqual(['m2', false]);
  });

  it('Т8, Т9: за м² без числа в упаковке — 154 плитки × 0,12 = 18,48 м²; копейки округляются', () => {
    const t8 = calc({ ...t3, tilesPerPack: null, tilePrice: 1250 });
    expect([t8.packs, t8.boughtArea, t8.totalCost, t8.costNeedsPack]).toEqual([
      null,
      18.48,
      23_100,
      false,
    ]);
    // 18 480 000 мм² · 124 999 коп. / 10⁶ = 2 309 981,52 → 2 309 982 коп.
    expect(calc({ ...t3, tilesPerPack: null, tilePrice: 1249.99 }).totalCost).toBe(23_099.82);
  });

  it('Т10, Т11: за упаковку — 20 × 1 890 ₽ = 37 800 ₽; без числа в упаковке — подсказка', () => {
    const t10 = calc({ ...t3, tilePrice: 1890, tilePriceUnit: 'pack' });
    expect([t10.totalCost, t10.costNeedsPack]).toEqual([37_800, false]);
    const t11 = calc({ ...t3, tilesPerPack: null, tilePrice: 1890, tilePriceUnit: 'pack' });
    expect([t11.totalCost, t11.costNeedsPack]).toEqual([null, true]);
  });

  it('Т12: Т1 (4 упаковки по 11, 300 × 300) по 990 ₽ за м² — 3,96 м², 3 920,40 ₽', () => {
    const result = calc({ reserve: 10, tilesPerPack: 11, tilePrice: 990 });
    expect([result.boughtArea, result.totalCost]).toEqual([3.96, 3920.4]);
  });

  it('Т13: цена 0 — 0 ₽ за м² и за упаковку', () => {
    expect(calc({ ...t3, tilePrice: 0 }).totalCost).toBe(0);
    expect(calc({ ...t3, tilePrice: 0, tilePriceUnit: 'pack' }).totalCost).toBe(0);
  });

  it('Т14, Т15: предел — за упаковку больше 2⁵³ копеек — ошибка у цены; за м² — точно', () => {
    const limit: Partial<TileInput> = {
      surfaceLength: 100,
      surfaceWidth: 100,
      surfaceCount: 50,
      tileLength: 20,
      tileWidth: 20,
      joint: 0,
      reserve: 50,
      tilesPerPack: 1,
      tilePrice: 1_000_000,
    };
    expect(errorsOf({ ...limit, tilePriceUnit: 'pack' }).tilePrice).toBe(
      'Слишком большая сумма для расчёта — проверьте цену.',
    );
    const perM2 = calc(limit);
    expect([perM2.tilesWithReserve, perM2.boughtArea, perM2.totalCost]).toEqual([
      1_875_000_000, 750_000, 750_000_000_000,
    ]);
  });

  it('без цены — без стоимости; цена без единицы — ошибка выбора', () => {
    expect([calc(t3).totalCost, calc(t3).costNeedsPack]).toEqual([null, false]);
    expect(errorsOf({ ...t3, tilePrice: 100, tilePriceUnit: null }).tilePriceUnit).toBe(
      'Выберите, за что указана цена.',
    );
    expect(errorsOf({ ...t3, tilePrice: 99.999 }).tilePrice).toBe('Не точнее 1 копейки.');
  });
});
