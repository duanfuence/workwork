/**
 * Ожидаемые значения рассчитаны вручную — см. docs/calculators/WALLPAPER.md,
 * раздел «Контрольные примеры». Номера примеров совпадают.
 *
 * Этап 2.1 (аудит): модель стала консервативнее — полосы считаются по стенам, при раппорте
 * резервируется подгонка рисунка в начале рулона и под окном. Изменённые ожидания пересчитаны
 * вручную и помечены «аудит:»; прежние значения указаны в документе.
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
  // аудит: 2·⌈4000/530⌉ + 2·⌈3000/530⌉ = 2·8 + 2·6 = 28 полос (было ⌈14 000/530⌉ = 27); ⌈28/3⌉ = 10
  it('4 × 3 × 2,5 м, рулон 0,53 × 10,05 → 28 полос по стенам, 10 рулонов', () => {
    expect(calc({})).toEqual({
      perimeter: 14,
      wallArea: 35,
      openingsArea: 0,
      netArea: 35,
      stripsForWalls: 28,
      stripsSavedByOpenings: 0,
      fullStrips: 28,
      stripLength: 2.6,
      rollStartAllowance: 0,
      stripsPerRoll: 3,
      rollsForFullStrips: 10,
      shortPieces: 0,
      shortPiecesLength: 0,
      extraRollsForShortPieces: 0,
      rolls: 10,
      patternRepeat: 0,
      trimAllowance: 10,
      rollPrice: null,
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

  // аудит: k = ⌊(10 050 − 640 − 2 400) / 2 560⌋ + 1 = 3; ⌈28 / 3⌉ = 10 (было ⌈27 / 3⌉ = 9)
  it('раппорт 64 см удлиняет полосу до 2,56 м — 3 полосы из рулона, 10 рулонов', () => {
    const result = calc({ wallHeight: 2.3, patternRepeat: 64 });
    expect(result.stripLength).toBe(2.56);
    expect(result.rollStartAllowance).toBe(0.64);
    expect(result.stripsPerRoll).toBe(3);
    expect(result.rolls).toBe(10);
    expect(result.patternRepeat).toBe(64);
  });

  it('длина полосы, уже кратная раппорту, не увеличивается', () => {
    // 2,46 + 0,10 = 2,56 = 4 · 0,64
    expect(calc({ wallHeight: 2.46, patternRepeat: 64 }).stripLength).toBe(2.56);
  });
});

describe('пример 3: чувствительность к высоте', () => {
  // ⌈28 / 4⌉ = 7 — не изменилось
  it('2,41 м → полоса 2,51 м, 4 из рулона, 7 рулонов', () => {
    const result = calc({ wallHeight: 2.41 });
    expect(result.stripsPerRoll).toBe(4);
    expect(result.rolls).toBe(7);
  });

  // аудит: ⌈28 / 3⌉ = 10 (было ⌈27 / 3⌉ = 9)
  it('2,42 м → полоса 2,52 м, 3 из рулона, 10 рулонов', () => {
    const result = calc({ wallHeight: 2.42 });
    expect(result.stripsPerRoll).toBe(3);
    expect(result.rolls).toBe(10);
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

  // аудит: по стенам 2·⌈5000/530⌉ + 2·⌈4000/530⌉ = 2·10 + 2·8 = 36; −2 на окнах = 34; ⌈34/3⌉ = 12.
  // Остатки: 11 × 1 650 и 7 250 → оба куска по 1 500 помещаются. Без проёмов ⌈36/3⌉ = 12 — проёмы не помогли.
  it('2 окна 1,5 × 1,4 и дверь 0,9 × 2 → 12 рулонов', () => {
    expect(calc(openings)).toEqual({
      perimeter: 18,
      wallArea: 48.6,
      openingsArea: 6,
      netArea: 42.6,
      stripsForWalls: 36,
      stripsSavedByOpenings: 2,
      fullStrips: 34,
      stripLength: 2.8,
      rollStartAllowance: 0,
      stripsPerRoll: 3,
      rollsForFullStrips: 12,
      shortPieces: 2,
      shortPiecesLength: 3,
      extraRollsForShortPieces: 0,
      rolls: 12,
      patternRepeat: 0,
      trimAllowance: 10,
      rollPrice: null,
      totalCost: null,
    });
  });

  it('без проёмов та же комната требует 12 рулонов', () => {
    expect(calc({ roomLength: 5, roomWidth: 4, wallHeight: 2.7 }).rolls).toBe(12);
  });

  // аудит: k = ⌊(10 050 − 640 − 2 800) / 3 200⌋ + 1 = 3; кусок окна ⌈1 500/640⌉·640 + 640 = 2 560 (было 1 920).
  // 34 полосы → 12 рулонов; 11 остатков по 0 (10 050 − 640 − 9 600 < 0) и 6 210 → оба куска входят (6 210 − 5 120).
  it('пример 4б: с раппортом 64 см куски по 2,56 м помещаются в остаток последнего рулона → 12 рулонов', () => {
    const result = calc({ ...openings, patternRepeat: 64 });
    expect(result.stripLength).toBe(3.2);
    expect(result.rollsForFullStrips).toBe(12);
    expect(result.shortPiecesLength).toBe(5.12);
    expect(result.extraRollsForShortPieces).toBe(0);
    expect(result.rolls).toBe(12);
  });

  it('узкая дверь (уже двух полос) не уменьшает расход', () => {
    const result = calc({ doorCount: 1, doorWidth: 0.9, doorHeight: 2 });
    expect(result.stripsSavedByOpenings).toBe(0);
    expect(result.rolls).toBe(10); // аудит: ⌈28 / 3⌉ (было ⌈27 / 3⌉ = 9)
  });

  it('проём высотой со стену не требует коротких кусков', () => {
    const result = calc({ doorCount: 1, doorWidth: 1.6, doorHeight: 2.5 });
    // ⌊1600 / 530⌋ − 1 = 2 полосы сэкономлено, куски не нужны
    expect(result.stripsSavedByOpenings).toBe(2);
    expect(result.shortPieces).toBe(0);
    expect(result.fullStrips).toBe(26); // аудит: 28 − 2 (было 27 − 2 = 25)
    expect(result.rolls).toBe(9); // ⌈26 / 3⌉
  });
});

describe('пример 5: границы округления', () => {
  it('периметр ровно 24 ширины рулона → 24 полосы и 8 рулонов (не 25 и 9)', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.18 });
    expect(result.stripsForWalls).toBe(24);
    expect(result.rolls).toBe(8);
  });

  // аудит: по стенам 2·6 + 2·⌈3190/530⌉ = 12 + 14 = 26 (было ⌈12 740/530⌉ = 25); ⌈26/3⌉ = 9
  it('на 1 см больше → 26 полос по стенам и 9 рулонов', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.19 });
    expect(result.stripsForWalls).toBe(26);
    expect(result.rolls).toBe(9);
  });

  it('полосы ровно заполняют рулон 10,4 м → 4 полосы из рулона, 6 рулонов', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.18, rollLength: 10.4 });
    expect(result.stripsPerRoll).toBe(4);
    expect(result.rolls).toBe(6);
  });

  // аудит: при счёте по стенам 2·⌈2220/530⌉ + 2·⌈5730/530⌉ = 2·5 + 2·11 = 32 → ⌈32/3⌉ = 11.
  // Периметр по-прежнему считается точно; ловушка двоичных дробей для стен — в тесте ниже.
  it('2,22 × 5,73 м: периметр точно 15,9 м, по стенам 32 полосы', () => {
    // В метрах: 2 · (2.22 + 5.73) = 15.900000000000002, и Math.ceil(… / 0.53) дал бы 31.
    // Расчёт в целых миллиметрах: 15 900 / 530 = 30 ровно.
    expect(2 * (2.22 + 5.73)).not.toBe(15.9);
    const result = calc({ roomLength: 2.22, roomWidth: 5.73 });
    expect(result.perimeter).toBe(15.9);
    expect(result.stripsForWalls).toBe(32);
    expect(result.rolls).toBe(11);
  });

  it('стена 4,2 м при рулоне 0,7 м — ровно 6 полос (в метрах 4.2 / 0.7 = 6.000000000000001 → 7)', () => {
    expect(Math.ceil(4.2 / 0.7)).toBe(7); // ловушка существует
    const result = calc({ roomLength: 4.2, roomWidth: 2.1, rollWidth: 0.7 });
    expect(result.stripsForWalls).toBe(18); // 2·6 + 2·3
    expect(result.rolls).toBe(6); // ⌈18 / 3⌉
  });
});

describe('пример 6: стоимость', () => {
  // аудит: комната 4 × 3 теперь даёт 10 рулонов; для проверки копеек взята комната 3,18 × 3,19 (9 рулонов)
  it('9 рулонов по 1 299,90 ₽ = 11 699,10 ₽', () => {
    const result = calc({ roomLength: 3.18, roomWidth: 3.19, rollPrice: 1299.9 });
    expect(result.rolls).toBe(9);
    expect(result.totalCost).toBe(11699.1);
  });

  it('10 рулонов по 1 299,90 ₽ = 12 999 ₽', () => {
    expect(calc({ rollPrice: 1299.9 }).totalCost).toBe(12999);
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
    // аудит: 28 − 8 = 20 (было 27 − 8 = 19); 6 рулонов по 3 + 1 рулон с 2 полосами (остаток 4 850 — 2 куска),
    // ещё 6 кусков по 2,4 м — в 2 новых рулона (4 + 2). Итог тот же: 7 + 2 = 9 (без окон было бы 10).
    expect(result.fullStrips).toBe(20);
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

  // аудит: если куски над и под проёмом не короче полной полосы, колонка остаётся полной полосой
  // (раньше кусок обрезался до 3,5 м и раскладывался отдельно — это могло только увеличить расход).
  it('если куски не короче полной полосы, экономии на проёме нет', () => {
    // окно 0,1 м, подрезка 100 см: (2,5 − 0,1) + 2 · 1 = 4,4 м ≥ полосы 3,5 м
    const result = calc({
      trimAllowance: 100,
      windowCount: 1,
      windowWidth: 1.6,
      windowHeight: 0.1,
    });
    expect(result.stripLength).toBe(3.5);
    expect(result.stripsSavedByOpenings).toBe(0);
    expect(result.shortPieces).toBe(0);
    expect(result.rolls).toBe(14); // ⌈28 / ⌊10 050 / 3 500⌋⌉ = ⌈28 / 2⌉
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
    // 200 см допустим: шаг 4 м, подгонка до 2 м; ⌊(10 050 − 2 000 − 2 600) / 4 000⌋ + 1 = 2 полосы
    expect(calc({ patternRepeat: 200 }).stripsPerRoll).toBe(2);
    // аудит: рулон 3 м — 2,6 м полосы + до 2 м подгонки = 4,6 м не помещаются
    expect(errorsOf({ patternRepeat: 200, rollLength: 3 }).rollLength).toBe(
      'Полоса (2,6 м с подрезкой) вместе с подгонкой рисунка (до 2 м) длиннее рулона.',
    );
  });

  it('отрицательная подрезка и цена', () => {
    expect(errorsOf({ trimAllowance: -1 }).trimAllowance).toBe(
      'Значение не может быть отрицательным.',
    );
    expect(errorsOf({ rollPrice: -100 }).rollPrice).toBe('Значение не может быть отрицательным.');
    // ОС4, ОС5 (WALLPAPER.md, «Стоимость»): предел 1 000 000 ₽ — можно; точнее копейки — ошибка (D-033).
    expect(calc({ roomLength: 3.18, roomWidth: 3.19, rollPrice: 1_000_000 }).totalCost).toBe(
      9_000_000,
    );
    expect(errorsOf({ rollPrice: 1299.955 }).rollPrice).toBe('Не точнее 1 копейки.');
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
    expect(calc({ windowCount: 0, windowWidth: -5, windowHeight: 99 }).rolls).toBe(10);
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
