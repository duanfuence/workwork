/**
 * Контрольные примеры docs/calculators/TILE.md (Т1–Т6). Числа взяты из документа, где они посчитаны вручную.
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
