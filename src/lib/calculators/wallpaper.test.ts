/**
 * Ожидаемые значения рассчитаны вручную — см. docs/calculators/WALLPAPER.md,
 * раздел «Контрольные примеры». Номера примеров совпадают.
 */
import { describe, expect, it } from 'vitest';
import { calculateWallpaper, type WallpaperInput, type WallpaperResult } from './wallpaper';

const base: WallpaperInput = {
  roomLength: 4,
  roomWidth: 3,
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
  const calculation = calculateWallpaper({ ...base, ...overrides });
  if (!calculation.ok) {
    throw new Error(`Ожидался успешный расчёт, ошибки: ${JSON.stringify(calculation.errors)}`);
  }
  return calculation.result;
}

function errorsOf(overrides: Partial<WallpaperInput>) {
  const calculation = calculateWallpaper({ ...base, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка проверки, но расчёт выполнен');
  return calculation.errors;
}

describe('пример 1: обычная комната без рисунка', () => {
  it('4 × 3 × 2,5 м, рулон 0,53 × 10,05 → 9 рулонов', () => {
    expect(calc({})).toEqual({
      perimeter: 14,
      wallArea: 35,
      openingsArea: 0,
      netArea: 35,
      stripsAroundPerimeter: 27,
      stripsSavedByOpenings: 0,
      fullStrips: 27,
      stripLength: 2.6,
      stripsPerRoll: 3,
      rollsForFullStrips: 9,
      shortPieces: 0,
      shortPiecesLength: 0,
      extraRollsForShortPieces: 0,
      rolls: 9,
      patternRepeat: 0,
      trimAllowance: 10,
      totalCost: null,
    });
  });
});

describe('пример 2: раппорт', () => {
  it('без раппорта при высоте 2,3 м — 4 полосы из рулона, 7 рулонов', () => {
    const result = calc({ wallHeight: 2.3 });
    expect(result.stripLength).toBe(2.4);
    expect(result.stripsPerRoll).toBe(4);
    expect(result.rolls).toBe(7);
  });

  it('раппорт 64 см удлиняет полосу до 2,56 м — 3 полосы из рулона, 9 рулонов', () => {
    const result = calc({ wallHeight: 2.3, patternRepeat: 64 });
    expect(result.stripLength).toBe(2.56);
    expect(result.stripsPerRoll).toBe(3);
    expect(result.rolls).toBe(9);
    expect(result.patternRepeat).toBe(64);
  });

  it('длина полосы, уже кратная раппорту, не увеличивается', () => {
    // 2,46 + 0,10 = 2,56 = 4 · 0,64
    expect(calc({ wallHeight: 2.46, patternRepeat: 64 }).stripLength).toBe(2.56);
  });
});

describe('пример 3: чувствительность к высоте', () => {
  it('2,41 м → полоса 2,51 м, 4 из рулона, 7 рулонов', () => {
    const result = calc({ wallHeight: 2.41 });
    expect(result.stripsPerRoll).toBe(4);
    expect(result.rolls).toBe(7);
  });

  it('2,42 м → полоса 2,52 м, 3 из рулона, 9 рулонов', () => {
    const result = calc({ wallHeight: 2.42 });
    expect(result.stripsPerRoll).toBe(3);
    expect(result.rolls).toBe(9);
  });
});

describe('пример 4: окна и двери', () => {
  const openings: Partial<WallpaperInput> = {
    roomLength: 5,
    roomWidth: 4,
    wallHeight: 2.7,
    windowCount: 2,
    windowWidth: 1.5,
    windowHeight: 1.4,
    doorCount: 1,
    doorWidth: 0.9,
    doorHeight: 2,
  };

  it('2 окна 1,5 × 1,4 и дверь 0,9 × 2 → 11 рулонов', () => {
    expect(calc(openings)).toEqual({
      perimeter: 18,
      wallArea: 48.6,
      openingsArea: 6,
      netArea: 42.6,
      stripsAroundPerimeter: 34,
      stripsSavedByOpenings: 2,
      fullStrips: 32,
      stripLength: 2.8,
      stripsPerRoll: 3,
      rollsForFullStrips: 11,
      shortPieces: 2,
      shortPiecesLength: 3,
      extraRollsForShortPieces: 0,
      rolls: 11,
      patternRepeat: 0,
      trimAllowance: 10,
      totalCost: null,
    });
  });

  it('без проёмов та же комната требует 12 рулонов', () => {
    expect(calc({ roomLength: 5, roomWidth: 4, wallHeight: 2.7 }).rolls).toBe(12);
  });

  it('пример 4б: с раппортом 64 см куски 1,92 м не помещаются в остатки → 12 рулонов', () => {
    const result = calc({ ...openings, patternRepeat: 64 });
    expect(result.stripLength).toBe(3.2);
    expect(result.rollsForFullStrips).toBe(11);
    expect(result.shortPiecesLength).toBe(3.84);
    expect(result.extraRollsForShortPieces).toBe(1);
    expect(result.rolls).toBe(12);
  });

  it('узкая дверь (уже двух полос) не уменьшает расход', () => {
    const result = calc({ doorCount: 1, doorWidth: 0.9, doorHeight: 2 });
    expect(result.stripsSavedByOpenings).toBe(0);
    expect(result.rolls).toBe(9);
  });

  it('проём высотой со стену не требует коротких кусков', () => {
    const result = calc({ doorCount: 1, doorWidth: 1.6, doorHeight: 2.5 });
    // ⌊1600 / 530⌋ − 1 = 2 полосы сэкономлено, куски не нужны
    expect(result.stripsSavedByOpenings).toBe(2);
    expect(result.shortPieces).toBe(0);
    expect(result.fullStrips).toBe(25);
    expect(result.rolls).toBe(9); // ⌈25 / 3⌉
  });
});

describe('пример 5: границы округления', () => {
  it('периметр ровно 24 ширины рулона → 24 полосы и 8 рулонов (не 25 и 9)', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.18 });
    expect(result.stripsAroundPerimeter).toBe(24);
    expect(result.rolls).toBe(8);
  });

  it('на 1 см больше → 25 полос и 9 рулонов', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.19 });
    expect(result.stripsAroundPerimeter).toBe(25);
    expect(result.rolls).toBe(9);
  });

  it('полосы ровно заполняют рулон 10,4 м → 4 полосы из рулона, 6 рулонов', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.18, rollLength: 10.4 });
    expect(result.stripsPerRoll).toBe(4);
    expect(result.rolls).toBe(6);
  });

  it('2,22 × 5,73 м: периметр ровно 30 ширин рулона → 30 полос, а не 31', () => {
    // В метрах: 2 · (2.22 + 5.73) = 15.900000000000002, и Math.ceil(… / 0.53) дал бы 31.
    // Расчёт в целых миллиметрах: 15 900 / 530 = 30 ровно.
    expect(2 * (2.22 + 5.73)).not.toBe(15.9);
    const result = calc({ roomLength: 2.22, roomWidth: 5.73 });
    expect(result.perimeter).toBe(15.9);
    expect(result.stripsAroundPerimeter).toBe(30);
    expect(result.rolls).toBe(10); // ⌈30 / 3⌉
  });
});

describe('пример 6: стоимость', () => {
  it('9 рулонов по 1 299,90 ₽ = 11 699,10 ₽', () => {
    expect(calc({ rollPrice: 1299.9 }).totalCost).toBe(11699.1);
  });

  it('нулевая цена даёт стоимость 0, а не «не указано»', () => {
    expect(calc({ rollPrice: 0 }).totalCost).toBe(0);
  });

  it('без цены стоимость не рассчитывается', () => {
    expect(calc({ rollPrice: null }).totalCost).toBeNull();
  });
});

describe('пример 7: куски не помещаются в остатки', () => {
  it('4 ленточных окна 2,0 × 0,3 → 7 + 2 = 9 рулонов', () => {
    const result = calc({ windowCount: 4, windowWidth: 2, windowHeight: 0.3 });
    expect(result.stripsSavedByOpenings).toBe(8);
    expect(result.fullStrips).toBe(19);
    expect(result.rollsForFullStrips).toBe(7);
    expect(result.shortPieces).toBe(8);
    expect(result.shortPiecesLength).toBe(19.2);
    expect(result.extraRollsForShortPieces).toBe(2);
    expect(result.rolls).toBe(9);
  });
});

describe('подрезка', () => {
  it('пустая подрезка считается нулевой', () => {
    const result = calc({ trimAllowance: null });
    expect(result.stripLength).toBe(2.5);
    expect(result.trimAllowance).toBe(0);
    expect(result.stripsPerRoll).toBe(4); // ⌊10 050 / 2 500⌋
  });

  it('короткий кусок не длиннее полной полосы', () => {
    // окно 0,1 м, подрезка 100 см: (2,5 − 0,1) + 2 · 1 = 4,4 м > полосы 3,5 м → кусок 3,5 м
    const result = calc({
      trimAllowance: 100,
      windowCount: 1,
      windowWidth: 1.6,
      windowHeight: 0.1,
    });
    expect(result.stripLength).toBe(3.5);
    expect(result.shortPiecesLength).toBe(7); // 2 куска по 3,5 м
  });
});

describe('проверка ввода (пример 8)', () => {
  it('пустые обязательные поля', () => {
    const errors = errorsOf({
      roomLength: null,
      roomWidth: null,
      wallHeight: null,
      rollWidth: null,
      rollLength: null,
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['roomLength', 'roomWidth', 'rollLength', 'rollWidth', 'wallHeight'].sort(),
    );
    expect(errors.roomLength).toBe('Заполните поле.');
  });

  it.each(['roomLength', 'roomWidth', 'wallHeight', 'rollWidth', 'rollLength'] as const)(
    'ноль и отрицательное значение в поле %s',
    (field) => {
      expect(errorsOf({ [field]: 0 })[field]).toBe('Значение должно быть больше нуля.');
      expect(errorsOf({ [field]: -1 })[field]).toBe('Значение должно быть больше нуля.');
    },
  );

  it.each([NaN, Infinity, -Infinity])('нечисловое значение %d не попадает в расчёт', (value) => {
    expect(errorsOf({ roomLength: value }).roomLength).toBe('Введите число.');
    expect(errorsOf({ rollPrice: value }).rollPrice).toBe('Введите число.');
    expect(errorsOf({ windowCount: value }).windowCount).toBe('Введите число.');
  });

  it('значения вне допустимого диапазона', () => {
    expect(errorsOf({ roomLength: 0.05 }).roomLength).toBe('Не меньше 0,1 м.');
    expect(errorsOf({ roomLength: 150 }).roomLength).toBe('Не больше 100 м.');
    expect(errorsOf({ wallHeight: 12 }).wallHeight).toBe('Не больше 10 м.');
  });

  it('полоса длиннее рулона', () => {
    expect(errorsOf({ wallHeight: 10 }).rollLength).toBe(
      'Полоса (10,1 м с подрезкой) длиннее рулона.',
    );
  });

  it('чрезмерный раппорт', () => {
    expect(errorsOf({ patternRepeat: 250 }).patternRepeat).toBe('Не больше 200 см.');
    expect(errorsOf({ patternRepeat: -5 }).patternRepeat).toBe(
      'Значение не может быть отрицательным.',
    );
    // 200 см допустим, но полоса 2,6 → 4 м; из рулона 10,05 м выходит 2 полосы
    expect(calc({ patternRepeat: 200 }).stripsPerRoll).toBe(2);
    // рулон 3 м короче полосы 4 м
    expect(errorsOf({ patternRepeat: 200, rollLength: 3 }).rollLength).toBe(
      'Полоса (4 м с подрезкой и раппортом) длиннее рулона.',
    );
  });

  it('отрицательная подрезка и цена', () => {
    expect(errorsOf({ trimAllowance: -1 }).trimAllowance).toBe(
      'Значение не может быть отрицательным.',
    );
    expect(errorsOf({ rollPrice: -100 }).rollPrice).toBe('Значение не может быть отрицательным.');
  });

  it('количество проёмов — целое неотрицательное', () => {
    expect(errorsOf({ windowCount: 1.5 }).windowCount).toBe('Введите целое число.');
    expect(errorsOf({ doorCount: -1 }).doorCount).toBe('Значение не может быть отрицательным.');
    expect(errorsOf({ doorCount: 51 }).doorCount).toBe('Не больше 50.');
  });

  it('при наличии проёмов их размеры обязательны', () => {
    const errors = errorsOf({ windowCount: 1 });
    expect(errors.windowWidth).toBe('Заполните поле.');
    expect(errors.windowHeight).toBe('Заполните поле.');
    expect(errorsOf({ doorCount: 1, doorWidth: -0.9, doorHeight: 2 }).doorWidth).toBe(
      'Значение должно быть больше нуля.',
    );
  });

  it('размеры проёмов игнорируются, если проёмов нет', () => {
    expect(calc({ windowCount: 0, windowWidth: -5, windowHeight: 99 }).rolls).toBe(9);
  });

  it('окно шире самой длинной стены или выше стены', () => {
    expect(errorsOf({ windowCount: 1, windowWidth: 4.5, windowHeight: 1.4 }).windowWidth).toBe(
      'Окно шире самой длинной стены (4 м).',
    );
    expect(errorsOf({ doorCount: 1, doorWidth: 0.9, doorHeight: 2.6 }).doorHeight).toBe(
      'Дверь выше стены (2,5 м).',
    );
  });

  it('проёмы вместе шире периметра', () => {
    expect(errorsOf({ windowCount: 10, windowWidth: 4, windowHeight: 1 }).windowCount).toBe(
      'Окна и двери вместе шире периметра комнаты (14 м).',
    );
  });
});

describe('отсутствие NaN и Infinity', () => {
  const cases: Partial<WallpaperInput>[] = [
    {},
    { roomLength: 0.1, roomWidth: 0.1, wallHeight: 0.5, rollWidth: 3, rollLength: 100 },
    { roomLength: 100, roomWidth: 100, wallHeight: 10, rollWidth: 0.1, rollLength: 100 },
    { patternRepeat: 200, trimAllowance: 100, rollPrice: 1_000_000, rollLength: 100 },
    { windowCount: 50, windowWidth: 0.1, windowHeight: 0.1, doorCount: 50, doorWidth: 0.1 },
  ];

  it.each(cases)('все числовые поля результата конечны: %o', (overrides) => {
    const withDoors = { doorHeight: overrides.doorCount ? 2 : null, ...overrides };
    const result = calc(withDoors);
    for (const [key, value] of Object.entries(result)) {
      if (value === null) continue;
      expect(Number.isFinite(value), key).toBe(true);
      expect(value, key).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isInteger(result.rolls)).toBe(true);
    expect(result.rolls).toBeGreaterThan(0);
  });
});
