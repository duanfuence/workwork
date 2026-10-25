/**
 * Новые контрольные примеры аудита (К1–К12). Ожидаемые значения посчитаны вручную до запуска —
 * расчёты приведены в docs/calculators/WALLPAPER.md, раздел «Аудит: контрольные примеры».
 * Общие параметры: рулон 0,53 × 10,05 м, подрезка 10 см, без раппорта, без проёмов.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateWallpaper,
  type WallpaperErrors,
  type WallpaperInput,
  type WallpaperResult,
} from './wallpaper';

const room: WallpaperInput = {
  roomLength: 2.65,
  roomWidth: 2.12,
  wallHeight: 2.5,
  rollWidth: 0.53,
  rollLength: 10.05,
  windowCount: null,
  windowWidth: null,
  windowHeight: null,
  doorCount: null,
  doorWidth: null,
  doorHeight: null,
  patternRepeat: null,
  trimAllowance: 10,
  rollPrice: null,
};

function calc(overrides: Partial<WallpaperInput>): WallpaperResult {
  const calculation = calculateWallpaper({ ...room, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

function errorsOf(overrides: Partial<WallpaperInput>): WallpaperErrors {
  const calculation = calculateWallpaper({ ...room, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка');
  return calculation.errors;
}

describe('К1: стены делятся на ширину рулона нацело', () => {
  it('2,65 × 2,12 м: 2·5 + 2·4 = 18 полос, 3 из рулона, 6 рулонов', () => {
    const result = calc({});
    expect(result.perimeter).toBe(9.54);
    expect(result.wallArea).toBe(23.85);
    expect(result.stripsForWalls).toBe(18);
    expect(result.stripsPerRoll).toBe(3);
    expect(result.rolls).toBe(6);
  });
});

describe('К2: длина комнаты по обе стороны границы (±1 мм)', () => {
  it.each([
    [2.649, 18, 6],
    [2.65, 18, 6],
    [2.651, 20, 7],
  ])('длина %d м → %i полос, %i рулонов', (roomLength, strips, rolls) => {
    const result = calc({ roomLength });
    expect(result.stripsForWalls).toBe(strips);
    expect(result.rolls).toBe(rolls);
  });
});

describe('К3: высота по обе стороны границы полос из рулона (1 мм)', () => {
  it('2,412 м: полоса 2,512 м, 4 · 2 512 = 10 048 ≤ 10 050 → 4 из рулона, 5 рулонов', () => {
    const result = calc({ wallHeight: 2.412 });
    expect(result.stripsPerRoll).toBe(4);
    expect(result.rolls).toBe(5);
  });

  it('2,413 м: 4 · 2 513 = 10 052 > 10 050 → 3 из рулона, 6 рулонов', () => {
    const result = calc({ wallHeight: 2.413 });
    expect(result.stripsPerRoll).toBe(3);
    expect(result.rolls).toBe(6);
  });
});

describe('К4: разные раппорты', () => {
  it.each([
    // [раппорт см, высота м, шаг полосы м, полос из рулона, рулонов]
    [10, 2.5, 2.6, 3, 6], // ⌊(10 050 − 100 − 2 600) / 2 600⌋ + 1 = 3
    [53, 2.5, 2.65, 3, 6], // шаг 5 · 530; ⌊(10 050 − 530 − 2 600) / 2 650⌋ + 1 = 3
    [150, 2.5, 3, 2, 9], // шаг 2 · 1 500; ⌊(10 050 − 1 500 − 2 600) / 3 000⌋ + 1 = 2
    [25, 2.4, 2.5, 3, 6], // шаг 10 · 250; ⌊(10 050 − 250 − 2 500) / 2 500⌋ + 1 = 3
  ])('раппорт %i см, высота %d м → шаг %d м, %i из рулона, %i рулонов', (r, h, step, k, n) => {
    const result = calc({ patternRepeat: r, wallHeight: h });
    expect(result.stripLength).toBe(step);
    expect(result.rollStartAllowance).toBe(r / 100);
    expect(result.stripsPerRoll).toBe(k);
    expect(result.rolls).toBe(n);
  });
});

describe('К5: из рулона выходит только одна полоса', () => {
  it('рулон 5 м, высота 2,7 м: ⌊5 000 / 2 800⌋ = 1 → 18 рулонов', () => {
    const result = calc({ rollLength: 5, wallHeight: 2.7 });
    expect(result.stripsPerRoll).toBe(1);
    expect(result.rolls).toBe(18);
  });
});

describe('К6: из рулона нельзя получить ни одной полосы', () => {
  it('рулон 2,5 м короче полосы 2,6 м — ошибка, а не 0 или Infinity рулонов', () => {
    expect(errorsOf({ rollLength: 2.5 }).rollLength).toBe(
      'Полоса (2,6 м с подрезкой) длиннее рулона.',
    );
  });

  it('раппорт 50 см: рулон 3 м — ровно одна полоса (0,5 + 2,5 = 3), рулон 2,99 м — ни одной', () => {
    const fits = calc({ wallHeight: 2.4, patternRepeat: 50, rollLength: 3 });
    expect(fits.stripsPerRoll).toBe(1);
    expect(fits.rolls).toBe(18);
    expect(errorsOf({ wallHeight: 2.4, patternRepeat: 50, rollLength: 2.99 }).rollLength).toBe(
      'Полоса (2,5 м с подрезкой) вместе с подгонкой рисунка (до 0,5 м) длиннее рулона.',
    );
  });
});

describe('К7: несколько окон и дверь', () => {
  const input: Partial<WallpaperInput> = {
    roomLength: 6,
    roomWidth: 4,
    wallHeight: 2.7,
    windowCount: 3,
    windowWidth: 1.2,
    windowHeight: 1.5,
    doorCount: 1,
    doorWidth: 0.8,
    doorHeight: 2.1,
  };

  it('6 × 4 × 2,7 м, 3 окна 1,2 × 1,5, дверь 0,8 × 2,1 → 13 рулонов (без проёмов 14)', () => {
    const result = calc(input);
    expect(result.perimeter).toBe(20);
    expect(result.wallArea).toBe(54);
    expect(result.openingsArea).toBe(7.08);
    expect(result.stripsForWalls).toBe(40);
    expect(result.stripsSavedByOpenings).toBe(3);
    expect(result.fullStrips).toBe(37);
    expect(result.rollsForFullStrips).toBe(13);
    expect(result.shortPieces).toBe(3);
    expect(result.shortPiecesLength).toBe(4.2);
    expect(result.extraRollsForShortPieces).toBe(0);
    expect(result.rolls).toBe(13);
    expect(calc({ roomLength: 6, roomWidth: 4, wallHeight: 2.7 }).rolls).toBe(14);
  });

  it('К12: стоимость 13 × 890,50 ₽ = 11 576,50 ₽', () => {
    expect(calc({ ...input, rollPrice: 890.5 }).totalCost).toBe(11576.5);
  });
});

describe('К8: куски претендуют на одни и те же остатки', () => {
  it('3 окна 1,6 × 1,2: 6 кусков по 1,5 м, 4 остатка по 2,25 м вмещают по одному → +1 рулон', () => {
    const result = calc({ windowCount: 3, windowWidth: 1.6, windowHeight: 1.2 });
    expect(result.stripsSavedByOpenings).toBe(6);
    expect(result.fullStrips).toBe(12);
    expect(result.rollsForFullStrips).toBe(4);
    expect(result.shortPieces).toBe(6);
    expect(result.extraRollsForShortPieces).toBe(1);
    expect(result.rolls).toBe(5);
  });
});

describe('К9: дверь при раппорте', () => {
  it('двустворчатая дверь 1,6 × 2,0, раппорт 64: кусок над дверью 0,6 м → 1 раппорт 0,64 м', () => {
    const result = calc({ patternRepeat: 64, doorCount: 1, doorWidth: 1.6, doorHeight: 2 });
    expect(result.stripsPerRoll).toBe(3);
    expect(result.stripsSavedByOpenings).toBe(2);
    expect(result.shortPiecesLength).toBe(1.28);
    expect(result.extraRollsForShortPieces).toBe(0);
    expect(result.rolls).toBe(6);
  });
});

describe('К10: большой раппорт съедает экономию на окне', () => {
  it('раппорт 100 см, окно 1,6 × 0,9: кусок ⌈1,8 / 1⌉ + 1 = 3 м ≥ шага полосы 3 м → экономии нет', () => {
    const result = calc({
      patternRepeat: 100,
      windowCount: 1,
      windowWidth: 1.6,
      windowHeight: 0.9,
    });
    expect(result.stripLength).toBe(3);
    expect(result.stripsSavedByOpenings).toBe(0);
    expect(result.shortPieces).toBe(0);
    expect(result.rolls).toBe(6);
  });
});

describe('К11: куски окна и двери в одних остатках', () => {
  it('окно 1,6 × 1,2 и дверь 1,6 × 2,0: куски 1,5; 1,5; 0,6; 0,6 м помещаются в 2 остатка', () => {
    const result = calc({
      windowCount: 1,
      windowWidth: 1.6,
      windowHeight: 1.2,
      doorCount: 1,
      doorWidth: 1.6,
      doorHeight: 2,
    });
    expect(result.stripsSavedByOpenings).toBe(4);
    expect(result.fullStrips).toBe(14);
    expect(result.rollsForFullStrips).toBe(5);
    expect(result.shortPieces).toBe(4);
    expect(result.shortPiecesLength).toBe(4.2);
    expect(result.extraRollsForShortPieces).toBe(0);
    expect(result.rolls).toBe(5);
  });
});
