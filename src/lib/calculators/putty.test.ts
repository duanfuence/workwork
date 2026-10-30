/**
 * Контрольные примеры docs/calculators/PUTTY.md (Шп1–Шп14, стоимость Шп15–Шп17). Числа взяты из документа, где они посчитаны вручную.
 */
import { describe, expect, it } from 'vitest';
import { calculatePutty, type PuttyErrors, type PuttyInput, type PuttyResult } from './putty';

const base: PuttyInput = {
  wallLength: 5,
  wallHeight: 2.7,
  wallCount: 1,
  openingsArea: null,
  layers: 1,
  consumption: 1.2,
  reserve: 0,
  packMass: 25,
  packPrice: null,
};

function calc(overrides: Partial<PuttyInput>): PuttyResult {
  const calculation = calculatePutty({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

function errorsOf(overrides: Partial<PuttyInput>): PuttyErrors {
  const calculation = calculatePutty({ ...base, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка');
  return calculation.errors;
}

const shp2: Partial<PuttyInput> = {
  wallLength: 4,
  wallCount: 4,
  openingsArea: 3.9,
  layers: 2,
  consumption: 1.1,
  reserve: 10,
  packMass: 20,
};

describe('контрольные примеры Шп1–Шп8', () => {
  it('Шп1: стена 5 × 2,7 м, 1 слой по 1,2 кг/м² → 16,2 кг; упаковка 25 кг — 1', () => {
    const result = calc({});
    expect([result.wallArea, result.openingsArea, result.puttyArea]).toEqual([13.5, 0, 13.5]);
    expect([result.mass, result.massWithReserve]).toEqual([16.2, 16.2]);
    expect([result.packs, result.massToBuy]).toEqual([1, 25]);
  });

  it('Шп2: 4 стены 4 × 2,7, проёмы 3,9 → 39,3 м²; 2 слоя по 1,1 → 86,46 (86,5), с запасом 95,106 (95,2); 5 упаковок', () => {
    const result = calc(shp2);
    expect([result.wallArea, result.openingsArea, result.puttyArea]).toEqual([43.2, 3.9, 39.3]);
    expect([result.layers, result.consumption, result.reserve]).toEqual([2, 1.1, 10]);
    expect([result.mass, result.massWithReserve]).toEqual([86.5, 95.2]);
    expect([result.packs, result.massToBuy]).toEqual([5, 100]);
  });

  it('Шп3: 10 кг × 1,1 = 11 ровно — без лишних 0,1 кг и лишней упаковки 5,5 кг', () => {
    const result = calc({
      wallLength: 2,
      wallHeight: 2.5,
      layers: 2,
      consumption: 1,
      reserve: 10,
      packMass: 5.5,
    });
    expect([result.mass, result.massWithReserve]).toEqual([10, 11]);
    expect([result.packs, result.massToBuy]).toEqual([2, 11]);
  });

  it('Шп4: 3 слоя → 48,6 кг, упаковок 25 кг — 2 (50 кг)', () => {
    const result = calc({ layers: 3 });
    expect([result.mass, result.packs, result.massToBuy]).toEqual([48.6, 2, 50]);
  });

  it('Шп5: без массы упаковки — только килограммы', () => {
    const result = calc({ ...shp2, packMass: null });
    expect([result.mass, result.massWithReserve]).toEqual([86.5, 95.2]);
    expect([result.packMass, result.packs, result.massToBuy]).toEqual([null, null, null]);
  });

  it('Шп6: проёмы равны площади стены или больше — ошибка, отрицательной площади нет', () => {
    expect(errorsOf({ openingsArea: 13.5 })).toEqual({
      openingsArea: 'Проёмы занимают всю площадь стен — шпаклевать нечего.',
    });
    expect(errorsOf({ openingsArea: 13.6 })).toEqual({
      openingsArea: 'Больше площади стен (13,5 м²).',
    });
  });

  it('Шп7: предельные значения — 2 500 000 кг, с запасом 3 750 000 кг, 7 500 000 упаковок по 0,5 кг', () => {
    const result = calc({
      wallLength: 100,
      wallHeight: 10,
      wallCount: 50,
      layers: 10,
      consumption: 5,
      reserve: 50,
      packMass: 0.5,
    });
    expect(result.puttyArea).toBe(50_000);
    expect([result.mass, result.massWithReserve]).toEqual([2_500_000, 3_750_000]);
    expect([result.packs, result.massToBuy]).toEqual([7_500_000, 3_750_000]);
  });

  it('Шп8: 4,725 кг → показ 4,8; с запасом 5 % 4,96125 → 5; упаковка 5 кг — 1', () => {
    const result = calc({ consumption: 0.35, reserve: 5, packMass: 5 });
    expect([result.mass, result.massWithReserve]).toEqual([4.8, 5]);
    expect([result.packs, result.massToBuy]).toEqual([1, 5]);
  });
});

describe('слои, запас и упаковки', () => {
  it('расход пропорционален числу слоёв', () => {
    expect([1, 2, 5, 10].map((layers) => calc({ layers }).mass)).toEqual([16.2, 32.4, 81, 162]);
  });

  it('пустой запас — 0 %, пустые проёмы — 0 м²', () => {
    const result = calc({ reserve: null, openingsArea: null });
    expect([result.reserve, result.openingsArea, result.massWithReserve]).toEqual([0, 0, 16.2]);
  });

  it('упаковки — от точной массы: чуть меньше 25 кг — 1 упаковка, чуть больше — 2', () => {
    // 2 слоя: (13,5 − 3,0834) · 1,2 · 2 = 24,99984 кг → показ 25, упаковок 1.
    const under = calc({ layers: 2, openingsArea: 3.0834 });
    expect([under.mass, under.packs]).toEqual([25, 1]);
    // (13,5 − 3,0833) · 1,2 · 2 = 25,00008 кг → показ 25,1, упаковок 2.
    const over = calc({ layers: 2, openingsArea: 3.0833 });
    expect([over.mass, over.packs]).toEqual([25.1, 2]);
  });

  it('минимальные значения дают конечный положительный результат', () => {
    // 0,01 м² · 0,1 кг/м² · 1 = 0,001 кг → вверх до 0,1 кг; 1 упаковка 0,5 кг.
    const result = calc({ wallLength: 0.1, wallHeight: 0.1, consumption: 0.1, packMass: 0.5 });
    expect([result.mass, result.massWithReserve, result.packs]).toEqual([0.1, 0.1, 1]);
  });
});

describe('ошибки ввода', () => {
  it.each([
    [{ wallLength: 0 }, { wallLength: 'Значение должно быть больше нуля.' }],
    [{ wallLength: -1 }, { wallLength: 'Значение должно быть больше нуля.' }],
    [{ wallLength: null }, { wallLength: 'Заполните поле.' }],
    [{ wallLength: 100.1 }, { wallLength: 'Не больше 100 м.' }],
    [{ wallHeight: 10.1 }, { wallHeight: 'Не больше 10 м.' }],
    [{ wallHeight: 0.05 }, { wallHeight: 'Не меньше 0,1 м.' }],
    [{ wallCount: 0 }, { wallCount: 'Значение должно быть больше нуля.' }],
    [{ wallCount: 1.5 }, { wallCount: 'Введите целое число.' }],
    [{ wallCount: 51 }, { wallCount: 'Не больше 50 шт.' }],
    [{ openingsArea: -1 }, { openingsArea: 'Значение не может быть отрицательным.' }],
    [{ layers: null }, { layers: 'Заполните поле.' }],
    [{ layers: 0 }, { layers: 'Значение должно быть больше нуля.' }],
    [{ layers: -2 }, { layers: 'Значение должно быть больше нуля.' }],
    [{ layers: 0.5 }, { layers: 'Введите целое число.' }],
    [{ layers: 1.5 }, { layers: 'Введите целое число.' }],
    [{ layers: 11 }, { layers: 'Не больше 10 слоёв.' }],
    [{ consumption: null }, { consumption: 'Заполните поле.' }],
    [{ consumption: 0 }, { consumption: 'Значение должно быть больше нуля.' }],
    [{ consumption: 0.05 }, { consumption: 'Не меньше 0,1 кг/м².' }],
    [{ consumption: 5.01 }, { consumption: 'Не больше 5 кг/м².' }],
    [{ consumption: 0.125 }, { consumption: 'Не больше двух знаков после запятой.' }],
    [{ reserve: -1 }, { reserve: 'Значение не может быть отрицательным.' }],
    [{ reserve: 50.1 }, { reserve: 'Не больше 50 %.' }],
    [{ reserve: 5.55 }, { reserve: 'Не больше одного знака после запятой.' }],
    [{ packMass: 0.4 }, { packMass: 'Не меньше 0,5 кг.' }],
    [{ packMass: 100.1 }, { packMass: 'Не больше 100 кг.' }],
    [{ packMass: 1.25 }, { packMass: 'Не больше одного знака после запятой.' }],
  ] satisfies [Partial<PuttyInput>, PuttyErrors][])('%o → %o', (overrides, expected) => {
    expect(errorsOf(overrides)).toEqual(expected);
  });

  it('NaN и бесконечность — «Введите число.»', () => {
    expect(errorsOf({ layers: Number.NaN, consumption: Infinity })).toEqual({
      layers: 'Введите число.',
      consumption: 'Введите число.',
    });
  });

  it('несколько ошибок сразу — по каждому полю', () => {
    expect(errorsOf({ wallHeight: null, consumption: null, packMass: 0.4 })).toEqual({
      wallHeight: 'Заполните поле.',
      consumption: 'Заполните поле.',
      packMass: 'Не меньше 0,5 кг.',
    });
  });
});

describe('режим «помещение» (модель 2): контрольные примеры Шп9–Шп14', () => {
  const room: Partial<PuttyInput> = {
    mode: 'room',
    roomLength: 4,
    roomWidth: 3,
    wallLength: null,
    wallCount: null,
  };

  it('Шп9: помещение 4 × 3 × 2,7 → 37,8 м²; 1 слой по 1,2 → 45,36 (45,4) кг; 2 упаковки по 25 кг', () => {
    const result = calc(room);
    expect(result.mode).toBe('room');
    expect([result.wallArea, result.ceilingArea, result.puttyArea]).toEqual([37.8, 0, 37.8]);
    expect([result.mass, result.massWithReserve]).toEqual([45.4, 45.4]);
    expect([result.packs, result.massToBuy]).toEqual([2, 50]);
  });

  it('Шп10: проёмы 3,9 и потолок 12 → 45,9 м²; 2 слоя по 1,1 → 100,98 (101), с запасом 111,078 (111,1); 6 упаковок', () => {
    const result = calc({
      ...room,
      openingsArea: 3.9,
      ceiling: 'yes',
      layers: 2,
      consumption: 1.1,
      reserve: 10,
      packMass: 20,
    });
    expect([result.wallArea, result.openingsArea, result.ceilingArea]).toEqual([37.8, 3.9, 12]);
    expect([result.puttyArea, result.ceilingIncluded]).toEqual([45.9, true]);
    expect([result.mass, result.massWithReserve]).toEqual([101, 111.1]);
    expect([result.packs, result.massToBuy]).toEqual([6, 120]);
  });

  it('Шп11: проёмы равны стенам без потолка или больше стен — ошибка', () => {
    expect(errorsOf({ ...room, openingsArea: 37.8 })).toEqual({
      openingsArea: 'Проёмы занимают всю площадь стен — шпаклевать нечего.',
    });
    expect(errorsOf({ ...room, openingsArea: 37.9 })).toEqual({
      openingsArea: 'Больше площади стен (37,8 м²).',
    });
  });

  it('Шп12: проёмы равны стенам, но с потолком — шпаклюется потолок 12 м² → 12 кг', () => {
    const result = calc({
      ...room,
      openingsArea: 37.8,
      ceiling: 'yes',
      consumption: 1,
      packMass: null,
    });
    expect([result.puttyArea, result.mass, result.massWithReserve]).toEqual([12, 12, 12]);
    expect(result.packs).toBeNull();
  });

  it('Шп13: предел — 100 × 100 × 10 м с потолком, 10 слоёв по 5 кг → 700 000, с запасом 50 % — 1 050 000 кг', () => {
    const result = calc({
      ...room,
      roomLength: 100,
      roomWidth: 100,
      wallHeight: 10,
      ceiling: 'yes',
      layers: 10,
      consumption: 5,
      reserve: 50,
      packMass: 0.5,
    });
    expect([result.wallArea, result.ceilingArea, result.puttyArea]).toEqual([4000, 10_000, 14_000]);
    expect([result.mass, result.massWithReserve]).toEqual([700_000, 1_050_000]);
    expect(result.packs).toBe(2_100_000);
  });

  it('Шп14: помещение равно одной стене длиной в периметр (14 × 2,7 м)', () => {
    const asWall = calc({ wallLength: 14 });
    const asRoom = calc(room);
    expect([asRoom.mass, asRoom.massWithReserve, asRoom.packs]).toEqual([
      asWall.mass,
      asWall.massWithReserve,
      asWall.packs,
    ]);
  });

  it('ошибки ввода помещения; поля стен в этом режиме не проверяются', () => {
    expect(errorsOf({ ...room, roomLength: 0, roomWidth: 100.1, wallHeight: 10.1 })).toEqual({
      roomLength: 'Значение должно быть больше нуля.',
      roomWidth: 'Не больше 100 м.',
      wallHeight: 'Не больше 10 м.',
    });
    expect(errorsOf({ ...room, roomLength: null }).roomLength).toBe('Заполните поле.');
    expect(calc({ ...room, wallLength: -5, wallCount: 0.5 }).mode).toBe('room');
  });

  it('неизвестный режим или значение потолка — ошибка у выбора', () => {
    expect(errorsOf({ mode: 'floor' })).toEqual({ mode: 'Выберите, что считать.' });
    expect(errorsOf({ ...room, ceiling: 'maybe' })).toEqual({
      ceiling: 'Выберите, шпаклевать ли потолок.',
    });
  });

  it('в режиме «стены» выбор потолка не учитывается', () => {
    const result = calc({ mode: 'walls', ceiling: 'yes' });
    expect([result.mode, result.ceilingIncluded, result.puttyArea]).toEqual(['walls', false, 13.5]);
  });
});

describe('стоимость Шп15–Шп17 (D-033)', () => {
  const shp10: Partial<PuttyInput> = {
    mode: 'room',
    roomLength: 4,
    roomWidth: 3,
    wallLength: null,
    wallCount: null,
    openingsArea: 3.9,
    ceiling: 'yes',
    layers: 2,
    consumption: 1.1,
    reserve: 10,
    packMass: 20,
  };

  it('Шп15: 6 упаковок × 845,50 ₽ = 5 073 ₽', () => {
    const result = calc({ ...shp10, packPrice: 845.5 });
    expect([result.packs, result.packPrice, result.totalCost, result.costNeedsPack]).toEqual([
      6,
      845.5,
      5073,
      false,
    ]);
  });

  it('Шп16: без массы упаковки — стоимости нет, подсказка', () => {
    const result = calc({ ...shp2, packMass: null, packPrice: 845.5 });
    expect([result.packs, result.totalCost, result.costNeedsPack]).toEqual([null, null, true]);
  });

  it('Шп17: предел — 7 500 000 упаковок × 1 000 000 ₽ = 7 500 000 000 000 ₽ точно', () => {
    const result = calc({
      wallLength: 100,
      wallHeight: 10,
      wallCount: 50,
      layers: 10,
      consumption: 5,
      reserve: 50,
      packMass: 0.5,
      packPrice: 1_000_000,
    });
    expect(result.totalCost).toBe(7_500_000_000_000);
  });

  it('ошибки цены — у поля', () => {
    expect(errorsOf({ packPrice: 845.505 }).packPrice).toBe('Не точнее 1 копейки.');
    expect(errorsOf({ packPrice: -1 }).packPrice).toBe('Значение не может быть отрицательным.');
  });
});
