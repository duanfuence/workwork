/**
 * Контрольные примеры docs/calculators/PAINT.md (П1–П8). Числа взяты из документа, где они посчитаны вручную.
 */
import { describe, expect, it } from 'vitest';
import { calculatePaint, type PaintErrors, type PaintInput, type PaintResult } from './paint';

const base: PaintInput = {
  roomLength: 4,
  roomWidth: 3,
  wallHeight: 2.7,
  openingsArea: null,
  ceiling: 'no',
  coats: 2,
  coverage: 10,
  reserve: 0,
  canVolume: null,
};

function calc(overrides: Partial<PaintInput>): PaintResult {
  const calculation = calculatePaint({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

function errorsOf(overrides: Partial<PaintInput>): PaintErrors {
  const calculation = calculatePaint({ ...base, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка');
  return calculation.errors;
}

describe('контрольные примеры П1–П8', () => {
  it('П1: стены 4 × 3 × 2,7 м = 37,8 м², 2 слоя по 10 м²/л → 7,56 л, показ 7,6 л', () => {
    const result = calc({});
    expect([result.perimeter, result.wallArea, result.paintArea]).toEqual([14, 37.8, 37.8]);
    expect([result.ceilingArea, result.openingsArea]).toEqual([0, 0]);
    expect(result.liters).toBe(7.6);
    expect(result.litersWithReserve).toBe(7.6);
    expect([result.cans, result.litersToBuy]).toEqual([null, null]);
  });

  it('П2: запас 10 % → 8,316 л, показ 8,4 л; банка 2,5 л → 4 банки, 10 л', () => {
    const result = calc({ reserve: 10, canVolume: 2.5 });
    expect([result.liters, result.litersWithReserve]).toEqual([7.6, 8.4]);
    expect([result.cans, result.litersToBuy]).toEqual([4, 10]);
  });

  it('П3: та же потребность, банка 9 л → 1 банка', () => {
    expect(calc({ reserve: 10, canVolume: 9 }).cans).toBe(1);
  });

  it('П4: проёмы 3,9 м² → 33,9 м², 6,78 л (6,8), с запасом 7,458 (7,5), банок 2,5 л — 3', () => {
    const result = calc({ openingsArea: 3.9, reserve: 10, canVolume: 2.5 });
    expect(result.paintArea).toBeCloseTo(33.9, 10);
    expect([result.liters, result.litersWithReserve, result.cans]).toEqual([6.8, 7.5, 3]);
  });

  it('П5: проёмы 3,9 + потолок 12 → 45,9 м², c = 8 → 11,475 л (11,5), с запасом 12,6225 (12,7), банок 2,7 л — 5', () => {
    const result = calc({
      openingsArea: 3.9,
      ceiling: 'yes',
      coverage: 8,
      reserve: 10,
      canVolume: 2.7,
    });
    expect([result.ceilingIncluded, result.ceilingArea]).toEqual([true, 12]);
    expect(result.paintArea).toBeCloseTo(45.9, 10);
    expect([result.liters, result.litersWithReserve, result.cans]).toEqual([11.5, 12.7, 5]);
    expect(result.litersToBuy).toBeCloseTo(13.5, 10);
  });

  it('П6: 3 слоя → 11,34 л, показ 11,4; слои пропорциональны', () => {
    expect(calc({ coats: 3 }).liters).toBe(11.4);
    expect(calc({ coats: 1 }).liters).toBe(3.8);
  });

  it('П7: ровно 2,0 л и 2,1 л с запасом 5 % — без лишних 0,1 л; банка 2,1 л — ровно одна', () => {
    const result = calc({
      roomLength: 2.5,
      roomWidth: 2.5,
      wallHeight: 2,
      coats: 1,
      reserve: 5,
      canVolume: 2.1,
    });
    expect([result.wallArea, result.liters, result.litersWithReserve, result.cans]).toEqual([
      20, 2, 2.1, 1,
    ]);
  });

  it('П8: проёмы равны стенам, потолок красится → 12 м², 2,4 л', () => {
    const result = calc({ openingsArea: 37.8, ceiling: 'yes' });
    expect([result.paintArea, result.liters]).toEqual([12, 2.4]);
  });
});

describe('проверка ввода', () => {
  it('пустые обязательные поля', () => {
    expect(
      errorsOf({
        roomLength: null,
        roomWidth: null,
        wallHeight: null,
        coats: null,
        coverage: null,
      }),
    ).toEqual({
      roomLength: 'Заполните поле.',
      roomWidth: 'Заполните поле.',
      wallHeight: 'Заполните поле.',
      coats: 'Заполните поле.',
      coverage: 'Заполните поле.',
    });
  });

  it('проёмы больше стен и проёмы во все стены без потолка — ошибка у поля проёмов', () => {
    expect(errorsOf({ openingsArea: 37.9 }).openingsArea).toBe('Больше площади стен (37,8 м²).');
    expect(errorsOf({ openingsArea: 37.8 }).openingsArea).toMatch(/красить нечего/);
    expect(errorsOf({ openingsArea: -1 }).openingsArea).toBe(
      'Значение не может быть отрицательным.',
    );
  });

  it('слои: 0, 1,5 и 11 — ошибки; 1 и 10 допустимы', () => {
    expect(errorsOf({ coats: 0 }).coats).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ coats: 1.5 }).coats).toBe('Введите целое число.');
    expect(errorsOf({ coats: 11 }).coats).toBe('Не больше 10 слоёв.');
    expect(calc({ coats: 10 }).liters).toBe(37.8);
  });

  it('укрывистость: 0, 0,4, 51, 8,55 — ошибки; 0,5 и 50 допустимы', () => {
    expect(errorsOf({ coverage: 0 }).coverage).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ coverage: 0.4 }).coverage).toBe('Не меньше 0,5 м²/л.');
    expect(errorsOf({ coverage: 51 }).coverage).toBe('Не больше 50 м²/л.');
    expect(errorsOf({ coverage: 8.55 }).coverage).toBe('Не больше одного знака после запятой.');
    expect(calc({ coverage: 0.5 }).liters).toBe(151.2);
    expect(calc({ coverage: 50 }).liters).toBe(1.6);
  });

  it('запас: пусто — 0 %, 50 допустимо, 50,1 и 5,55 — ошибки', () => {
    expect(calc({ reserve: null }).reserve).toBe(0);
    expect(calc({ reserve: 50 }).litersWithReserve).toBe(11.4);
    expect(errorsOf({ reserve: 50.1 }).reserve).toBe('Не больше 50 %.');
    expect(errorsOf({ reserve: 5.55 }).reserve).toBe('Не больше одного знака после запятой.');
  });

  it('банка: 0,05 и 2,5555 л — ошибки, 0,1 и 100 допустимы', () => {
    expect(errorsOf({ canVolume: 0.05 }).canVolume).toBe('Не меньше 0,1 л.');
    expect(errorsOf({ canVolume: 2.5555 }).canVolume).toBe(
      'Не точнее 1 мл (три знака после запятой).',
    );
    expect(calc({ canVolume: 0.1 }).cans).toBe(76);
    expect(calc({ canVolume: 100 }).cans).toBe(1);
  });

  it('потолок — только «yes» или «no»', () => {
    expect(errorsOf({ ceiling: null }).ceiling).toBe('Выберите, красить ли потолок.');
    expect(errorsOf({ ceiling: 'maybe' }).ceiling).toBe('Выберите, красить ли потолок.');
  });

  it('границы размеров: 0,1 × 0,1 × 0,5 м и 100 × 100 × 10 м с потолком считаются без NaN и Infinity', () => {
    const small = calc({ roomLength: 0.1, roomWidth: 0.1, wallHeight: 0.5 });
    expect([small.wallArea, small.liters]).toEqual([0.2, 0.1]);
    const large = calc({
      roomLength: 100,
      roomWidth: 100,
      wallHeight: 10,
      ceiling: 'yes',
      coats: 10,
      coverage: 0.5,
      reserve: 50,
      canVolume: 0.1,
    });
    expect(large.paintArea).toBe(14_000);
    expect(large.liters).toBe(280_000);
    expect(large.litersWithReserve).toBe(420_000);
    expect(large.cans).toBe(4_200_000);
    expect(errorsOf({ roomLength: 100.1 }).roomLength).toBe('Не больше 100 м.');
    expect(errorsOf({ wallHeight: 0.4 }).wallHeight).toBe('Не меньше 0,5 м.');
  });
});
