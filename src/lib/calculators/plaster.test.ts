/**
 * Контрольные примеры docs/calculators/PLASTER.md (Ш1–Ш7). Числа взяты из документа, где они посчитаны вручную.
 */
import { describe, expect, it } from 'vitest';
import {
  calculatePlaster,
  type PlasterErrors,
  type PlasterInput,
  type PlasterResult,
} from './plaster';

const base: PlasterInput = {
  wallLength: 5,
  wallHeight: 2.7,
  wallCount: 1,
  openingsArea: null,
  thickness: 10,
  consumption: 0.9,
  reserve: 0,
  bagMass: 30,
};

function calc(overrides: Partial<PlasterInput>): PlasterResult {
  const calculation = calculatePlaster({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

function errorsOf(overrides: Partial<PlasterInput>): PlasterErrors {
  const calculation = calculatePlaster({ ...base, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка');
  return calculation.errors;
}

describe('контрольные примеры Ш1–Ш7', () => {
  it('Ш1: стена 5 × 2,7 м, слой 10 мм, расход 0,9 → 121,5 кг; мешки по 30 кг — 5 (150 кг)', () => {
    const result = calc({});
    expect([result.wallArea, result.openingsArea, result.plasterArea]).toEqual([13.5, 0, 13.5]);
    expect([result.mass, result.massWithReserve]).toEqual([121.5, 121.5]);
    expect([result.bags, result.massToBuy]).toEqual([5, 150]);
  });

  it('Ш2: 4 стены 4 × 2,7, проёмы 3,9 → 39,3 м²; 501,075 (501,1) и 551,1825 (551,2) кг; 23 мешка', () => {
    const result = calc({
      wallLength: 4,
      wallCount: 4,
      openingsArea: 3.9,
      thickness: 15,
      consumption: 0.85,
      reserve: 10,
      bagMass: 25,
    });
    expect([result.wallArea, result.openingsArea, result.plasterArea]).toEqual([43.2, 3.9, 39.3]);
    expect([result.mass, result.massWithReserve]).toEqual([501.1, 551.2]);
    expect([result.bags, result.massToBuy]).toEqual([23, 575]);
  });

  it('Ш3: 50 кг × 1,1 = 55 ровно — без лишних 0,1 кг и лишнего мешка 27,5 кг', () => {
    const result = calc({
      wallLength: 2,
      wallHeight: 2.5,
      consumption: 1,
      reserve: 10,
      bagMass: 27.5,
    });
    expect([result.mass, result.massWithReserve]).toEqual([50, 55]);
    expect([result.bags, result.massToBuy]).toEqual([2, 55]);
  });

  it('Ш4: запас 5 % → 127,575 кг, показ 127,6; мешков 5', () => {
    const result = calc({ reserve: 5 });
    expect([result.mass, result.massWithReserve, result.bags]).toEqual([121.5, 127.6, 5]);
  });

  it('Ш5: 7,5 м², слой 7,5 мм, расход 1,25 → 70,3125 кг, показ 70,4; мешков 30 кг — 3', () => {
    const result = calc({ wallLength: 3, wallHeight: 2.5, thickness: 7.5, consumption: 1.25 });
    expect([result.plasterArea, result.thickness, result.consumption]).toEqual([7.5, 7.5, 1.25]);
    expect([result.mass, result.massWithReserve]).toEqual([70.4, 70.4]);
    expect([result.bags, result.massToBuy]).toEqual([3, 90]);
  });

  it('Ш6: проёмы равны площади стены или больше — ошибка, отрицательной площади нет', () => {
    expect(errorsOf({ openingsArea: 13.5 })).toEqual({
      openingsArea: 'Проёмы занимают всю площадь стен — штукатурить нечего.',
    });
    expect(errorsOf({ openingsArea: 13.6 })).toEqual({
      openingsArea: 'Больше площади стен (13,5 м²).',
    });
  });

  it('Ш7: предельные значения — 25 000 000 кг, с запасом 37 500 000 кг и столько же мешков по 1 кг', () => {
    const result = calc({
      wallLength: 100,
      wallHeight: 10,
      wallCount: 50,
      thickness: 100,
      consumption: 5,
      reserve: 50,
      bagMass: 1,
    });
    expect(result.plasterArea).toBe(50_000);
    expect([result.mass, result.massWithReserve]).toEqual([25_000_000, 37_500_000]);
    expect([result.bags, result.massToBuy]).toEqual([37_500_000, 37_500_000]);
  });
});

describe('мешки и запас', () => {
  it('без массы мешка мешки не считаются', () => {
    const result = calc({ bagMass: null });
    expect([result.bagMass, result.bags, result.massToBuy]).toEqual([null, null, null]);
  });

  it('пустой запас — 0 %, пустые проёмы — 0 м²', () => {
    const result = calc({ reserve: null, openingsArea: null });
    expect([result.reserve, result.openingsArea, result.massWithReserve]).toEqual([0, 0, 121.5]);
  });

  it('мешки — от точной массы: чуть больше 120 кг при мешке 30 кг — 5 мешков, чуть меньше — 4', () => {
    // (13,5 − 0,1667) · 10 · 0,9 = 119,9997 кг → показ 120, мешков ⌈3,99999⌉ = 4.
    const under = calc({ openingsArea: 0.1667 });
    expect([under.mass, under.bags]).toEqual([120, 4]);
    // (13,5 − 0,1666) · 10 · 0,9 = 120,0006 кг → показ 120,1, мешков ⌈4,00002⌉ = 5.
    const over = calc({ openingsArea: 0.1666 });
    expect([over.mass, over.bags]).toEqual([120.1, 5]);
  });

  it('результат всегда конечный и неотрицательный', () => {
    const result = calc({ wallLength: 0.1, wallHeight: 0.1, thickness: 1, consumption: 0.1 });
    // 0,01 м² · 1 мм · 0,1 = 0,001 кг → вверх до 0,1 кг; 1 мешок.
    expect([result.mass, result.massWithReserve, result.bags]).toEqual([0.1, 0.1, 1]);
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
    [{ thickness: 0 }, { thickness: 'Значение должно быть больше нуля.' }],
    [{ thickness: 0.5 }, { thickness: 'Не меньше 1 мм.' }],
    [{ thickness: 100.1 }, { thickness: 'Не больше 100 мм.' }],
    [{ thickness: 7.55 }, { thickness: 'Не больше одного знака после запятой.' }],
    [{ consumption: null }, { consumption: 'Заполните поле.' }],
    [{ consumption: 0 }, { consumption: 'Значение должно быть больше нуля.' }],
    [{ consumption: 0.05 }, { consumption: 'Не меньше 0,1 кг/(м²·мм).' }],
    [{ consumption: 5.01 }, { consumption: 'Не больше 5 кг/(м²·мм).' }],
    [{ consumption: 0.855 }, { consumption: 'Не больше двух знаков после запятой.' }],
    [{ reserve: 5.55 }, { reserve: 'Не больше одного знака после запятой.' }],
    [{ reserve: 50.1 }, { reserve: 'Не больше 50 %.' }],
    [{ reserve: -1 }, { reserve: 'Значение не может быть отрицательным.' }],
    [{ bagMass: 0.5 }, { bagMass: 'Не меньше 1 кг.' }],
    [{ bagMass: 1.55 }, { bagMass: 'Не больше одного знака после запятой.' }],
    [{ bagMass: 100.5 }, { bagMass: 'Не больше 100 кг.' }],
  ] satisfies [Partial<PlasterInput>, PlasterErrors][])('%o → %o', (overrides, expected) => {
    expect(errorsOf(overrides)).toEqual(expected);
  });

  it('NaN и бесконечность — «Введите число.»', () => {
    expect(errorsOf({ thickness: Number.NaN, consumption: Infinity })).toEqual({
      thickness: 'Введите число.',
      consumption: 'Введите число.',
    });
  });

  it('несколько ошибок сразу — по каждому полю', () => {
    expect(errorsOf({ wallLength: null, consumption: null, bagMass: 0.5 })).toEqual({
      wallLength: 'Заполните поле.',
      consumption: 'Заполните поле.',
      bagMass: 'Не меньше 1 кг.',
    });
  });
});

describe('режим «помещение» (модель 2): контрольные примеры Ш8–Ш12', () => {
  const room: Partial<PlasterInput> = {
    mode: 'room',
    roomLength: 4,
    roomWidth: 3,
    wallLength: null,
    wallCount: null,
  };

  it('Ш8: помещение 4 × 3 × 2,7 → 37,8 м²; слой 10 мм по 0,9 → 340,2 кг; 12 мешков по 30 кг', () => {
    const result = calc(room);
    expect([result.mode, result.wallArea, result.plasterArea]).toEqual(['room', 37.8, 37.8]);
    expect([result.mass, result.massWithReserve]).toEqual([340.2, 340.2]);
    expect([result.bags, result.massToBuy]).toEqual([12, 360]);
  });

  it('Ш9: проёмы 3,9 → 33,9 м²; слой 15 по 0,85 → 432,225 (432,3), с запасом 475,4475 (475,5); 20 мешков', () => {
    const result = calc({
      ...room,
      openingsArea: 3.9,
      thickness: 15,
      consumption: 0.85,
      reserve: 10,
      bagMass: 25,
    });
    expect(result.plasterArea).toBe(33.9);
    expect([result.mass, result.massWithReserve]).toEqual([432.3, 475.5]);
    expect([result.bags, result.massToBuy]).toEqual([20, 500]);
  });

  it('Ш10: проёмы равны стенам или больше — ошибка', () => {
    expect(errorsOf({ ...room, openingsArea: 37.8 })).toEqual({
      openingsArea: 'Проёмы занимают всю площадь стен — штукатурить нечего.',
    });
    expect(errorsOf({ ...room, openingsArea: 37.9 })).toEqual({
      openingsArea: 'Больше площади стен (37,8 м²).',
    });
  });

  it('Ш11: предел — 100 × 100 × 10 м, слой 100 по 5 → 2 000 000, с запасом 50 % — 3 000 000 кг', () => {
    const result = calc({
      ...room,
      roomLength: 100,
      roomWidth: 100,
      wallHeight: 10,
      thickness: 100,
      consumption: 5,
      reserve: 50,
      bagMass: 1,
    });
    expect([result.wallArea, result.mass, result.massWithReserve]).toEqual([
      4000, 2_000_000, 3_000_000,
    ]);
    expect(result.bags).toBe(3_000_000);
  });

  it('Ш12: помещение равно одной стене длиной в периметр (14 × 2,7 м)', () => {
    const asWall = calc({ wallLength: 14 });
    const asRoom = calc(room);
    expect([asRoom.mass, asRoom.bags]).toEqual([asWall.mass, asWall.bags]);
  });

  it('ошибки ввода помещения; поля стен в этом режиме не проверяются', () => {
    expect(errorsOf({ ...room, roomLength: 0, roomWidth: 100.1, wallHeight: 10.1 })).toEqual({
      roomLength: 'Значение должно быть больше нуля.',
      roomWidth: 'Не больше 100 м.',
      wallHeight: 'Не больше 10 м.',
    });
    expect(errorsOf({ ...room, roomWidth: null }).roomWidth).toBe('Заполните поле.');
    expect(calc({ ...room, wallLength: -5, wallCount: 0.5 }).mode).toBe('room');
    expect(errorsOf({ mode: 'ceiling' })).toEqual({ mode: 'Выберите, что считать.' });
  });
});
