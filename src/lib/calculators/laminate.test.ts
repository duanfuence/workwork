/**
 * Контрольные примеры docs/calculators/LAMINATE.md (§8, разборы §10). Числа взяты из документа,
 * где они посчитаны вручную. Во всех примерах m = o = 300 мм задаются явно, запас 0 %.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateLaminate,
  countBoards,
  findFixedLayout,
  fixedRows,
  isRowValid,
  schemeBase,
  type LaminateErrors,
  type LaminateInput,
  type LaminateResult,
} from './laminate';

const base: LaminateInput = {
  roomLength: 2.4,
  roomWidth: 1,
  boardLength: 1200,
  boardWidth: 200,
  boardsPerPack: 8,
  direction: 'length',
  scheme: 'half',
  minPiece: 300,
  minOffset: 300,
  reserve: 0,
  packPrice: null,
};

function calc(overrides: Partial<LaminateInput>): LaminateResult {
  const calculation = calculateLaminate({ ...base, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

function errorsOf(overrides: Partial<LaminateInput>): LaminateErrors {
  const calculation = calculateLaminate({ ...base, ...overrides });
  if (calculation.ok) throw new Error('Ожидалась ошибка');
  return calculation.errors;
}

function rowsLayout(result: LaminateResult) {
  if (result.layout.kind !== 'rows') throw new Error('Ожидалась раскладка по рядам');
  return result.layout;
}

const rowsOf = (result: LaminateResult) =>
  rowsLayout(result).rowTypes.map((t) => [t.start, t.full, t.end, t.count]);

describe('К1: площадь и ряды делятся нацело — 1/2', () => {
  it('2,4 × 1,0 м → 10 досок, 2 упаковки, без сдвига', () => {
    const result = calc({});
    expect(result.rows).toBe(5);
    expect(result.areaBoards).toBe(10);
    expect(rowsLayout(result).shift).toBe(0);
    expect(rowsOf(result)).toEqual([
      [1200, 1, 0, 3],
      [600, 1, 600, 2],
    ]);
    expect(result.boards).toBe(10);
    expect(result.packs).toBe(2);
  });
});

describe('К2: округление площади даёт лишнюю доску, ряды — больше', () => {
  const result = calc({ roomLength: 2.5 });

  it('по площади 10,42 → 11, по рядам 13, 2 упаковки', () => {
    expect(result.areaBoards).toBe(11);
    expect(result.boards).toBe(13);
    expect(result.packs).toBe(2);
    expect(result.areaPacks).toBe(2);
  });

  it('сдвиг d = 200: ряды 1000 | 1200 | 300 и 400 | 1200 | 900', () => {
    expect(rowsLayout(result).shift).toBe(200);
    expect(rowsOf(result)).toEqual([
      [1000, 1, 300, 3],
      [400, 1, 900, 2],
    ]);
  });

  it('разбор §10: F = 5, |S| = 5, |E| = 5, пары — только 400 + 300, M = 2', () => {
    const count = rowsLayout(result).count;
    expect([count.full, count.starts, count.ends, count.pairs.length]).toEqual([5, 5, 5, 2]);
    expect(count.pairs.map((p) => [p.start, p.end])).toEqual([
      [400, 300],
      [400, 300],
    ]);
  });

  it('минимум 13 при любом допустимом сдвиге 1/2 (§10)', () => {
    const half = schemeBase('half', 1200);
    let valid = 0;
    for (let d = 0; d < 1200; d += 1) {
      const rows = fixedRows(2500, 5, 1200, half, d);
      if (!rows.slice(0, 2).every((row) => isRowValid(row, 300))) continue;
      valid += 1;
      expect(countBoards(rows, 1200).boards, `d = ${d}`).toBeGreaterThanOrEqual(13);
    }
    expect(valid).toBeGreaterThan(0);
  });
});

describe('К3: число рядов округляется вверх', () => {
  it('2,4 × 1,05 м: 6 рядов, последний 50 мм, 12 досок (по площади 11)', () => {
    const result = calc({ roomWidth: 1.05 });
    expect(result.rows).toBe(6);
    expect(result.lastRowWidth).toBe(50);
    expect(result.narrowLastRow).toBe(false); // 50 — не уже порога 50 мм
    expect(result.boards).toBe(12);
    expect(result.areaBoards).toBe(11);
    expect(result.packs).toBe(2);
  });
});

describe('К4 и К5: направление укладки', () => {
  it('К4: 3,6 × 1,3 м вдоль длины → 7 рядов, последний 100 мм, 21 доска, 3 упаковки', () => {
    const result = calc({ roomLength: 3.6, roomWidth: 1.3 });
    expect(result.rows).toBe(7);
    expect(result.lastRowWidth).toBe(100);
    expect(result.boards).toBe(21);
    expect(result.areaBoards).toBe(20);
    expect(result.packs).toBe(3);
  });

  describe('К5: та же комната поперёк', () => {
    const result = calc({ roomLength: 3.6, roomWidth: 1.3, direction: 'width' });

    it('R = 1300, 18 рядов, d = 200, 27 досок, 4 упаковки (по площади 20 = 3)', () => {
      expect(result.rowLength).toBe(1300);
      expect(result.rows).toBe(18);
      expect(rowsLayout(result).shift).toBe(200);
      expect(rowsOf(result)).toEqual([
        [1000, 0, 300, 9],
        [400, 0, 900, 9],
      ]);
      expect(result.boards).toBe(27);
      expect(result.packs).toBe(4);
      expect(result.areaBoards).toBe(20);
      expect(result.areaPacks).toBe(3);
    });

    it('разбор §10: F = 0, |S| = |E| = 18, M = 9', () => {
      const count = rowsLayout(result).count;
      expect([count.full, count.starts, count.ends, count.pairs.length]).toEqual([0, 18, 18, 9]);
    });

    it('минимум 27 при любом допустимом сдвиге 1/2 (§10)', () => {
      const half = schemeBase('half', 1200);
      for (let d = 0; d < 1200; d += 1) {
        const rows = fixedRows(1300, 18, 1200, half, d);
        if (!rows.slice(0, 2).every((row) => isRowValid(row, 300))) continue;
        expect(countBoards(rows, 1200).boards, `d = ${d}`).toBeGreaterThanOrEqual(27);
      }
    });
  });
});

describe('К6: схема 1/2 со сдвигом', () => {
  it('2,0 × 1,0 м: d = 100, ряды 1100 | 900 и 500 | 1200 | 300, 10 досок (по площади 9)', () => {
    const result = calc({ roomLength: 2 });
    expect(rowsLayout(result).shift).toBe(100);
    expect(rowsOf(result)).toEqual([
      [1100, 0, 900, 3],
      [500, 1, 300, 2],
    ]);
    expect(result.boards).toBe(10);
    expect(result.areaBoards).toBe(9);
    expect(result.packs).toBe(2);
  });
});

describe('К7 и К7б: схема 1/3', () => {
  it('К7: 2,4 × 1,0 м → цикл 1200 / 800 / 400, d = 0, 10 досок', () => {
    const result = calc({ scheme: 'third' });
    expect(rowsLayout(result).shift).toBe(0);
    expect(rowsOf(result)).toEqual([
      [1200, 1, 0, 2],
      [800, 1, 400, 2],
      [400, 1, 800, 1],
    ]);
    expect(result.boards).toBe(10);
    expect(result.packs).toBe(2);
  });

  it('К7б: 2,5 × 1,0 м — строгая 1/3 невыполнима, ошибка в поле «Схема»', () => {
    expect(errorsOf({ roomLength: 2.5, scheme: 'third' }).scheme).toBe(
      'Схема 1/3 невыполнима для этих размеров: при любом сдвиге в ряду остаётся отрезок короче 300 мм. Выберите другую схему или направление либо проверьте требования производителя.',
    );
  });

  it('К7б: ни один из 1200 сдвигов не даёт допустимых рядов', () => {
    const third = schemeBase('third', 1200);
    for (let d = 0; d < 1200; d += 1) {
      const rows = fixedRows(2500, 5, 1200, third, d).slice(0, 3);
      expect(
        rows.every((row) => isRowValid(row, 300)),
        `d = ${d}`,
      ).toBe(false);
    }
    expect(findFixedLayout(2500, 5, 1200, third, 300, 300)).toEqual({ ok: false, reason: 'shift' });
  });

  it('К7б: те же размеры по 1/2 и «от обрезка» — 13 досок', () => {
    expect(calc({ roomLength: 2.5, scheme: 'half' }).boards).toBe(13);
    expect(calc({ roomLength: 2.5, scheme: 'offcut' }).boards).toBe(13);
  });
});

describe('К8 и К9: укладка «от обрезка»', () => {
  it('К8: 2,3 × 0,8 м — обрезок 100 мм не используется, ряды 1200 | 1100 и 800 | 1200 | 300, 8 досок', () => {
    const result = calc({ roomLength: 2.3, roomWidth: 0.8, scheme: 'offcut' });
    expect(rowsLayout(result).shift).toBeNull();
    expect(rowsOf(result)).toEqual([
      [1200, 0, 1100, 2],
      [800, 1, 300, 2],
    ]);
    expect(result.boards).toBe(8);
    expect(result.areaBoards).toBe(8);
    expect(result.packs).toBe(1);
  });

  describe('К9: 2,0 × 1,0 м — обрезки используются повторно', () => {
    const result = calc({ roomLength: 2, scheme: 'offcut' });

    it('ряды по документу и 9 досок = площадь, 2 упаковки', () => {
      expect(rowsOf(result)).toEqual([
        [1200, 0, 800, 2],
        [400, 1, 400, 2],
        [800, 1, 0, 1],
      ]);
      expect(rowsLayout(result).rowTypes.map((t) => t.firstRows)).toEqual([[1, 4], [2, 5], [3]]);
      expect(result.boards).toBe(9);
      expect(result.areaBoards).toBe(9);
      expect(result.packs).toBe(2);
    });

    it('разбор §10: F = 5, |S| = 3, |E| = 4, все три начала в парах', () => {
      const count = rowsLayout(result).count;
      expect([count.full, count.starts, count.ends, count.pairs.length]).toEqual([5, 3, 4, 3]);
    });
  });
});

describe('К10: +1 мм меняет количество досок', () => {
  it('2,400 м → 10 досок; 2,401 м → d = 299, 13 досок; упаковок 2 и 2', () => {
    expect(calc({ roomLength: 2.4 }).boards).toBe(10);
    const result = calc({ roomLength: 2.401 });
    expect(rowsLayout(result).shift).toBe(299);
    expect(rowsOf(result)).toEqual([
      [901, 1, 300, 3],
      [301, 1, 900, 2],
    ]);
    const count = rowsLayout(result).count;
    expect([count.full, count.starts, count.ends, count.pairs.length]).toEqual([5, 5, 5, 2]);
    expect(result.boards).toBe(13);
    expect(result.areaBoards).toBe(11);
    expect(result.packs).toBe(2);
  });
});

describe('К11 и К12: запас, упаковки, стоимость', () => {
  const room = { roomLength: 4.8, roomWidth: 3 };

  it('К11: 60 досок; запас 0 / 5 / 10 % → 60 / 63 / 66 досок → 8 / 8 / 9 упаковок', () => {
    expect(calc(room).boards).toBe(60);
    expect(calc(room).areaBoards).toBe(60);
    const cases = [
      [0, 60, 8],
      [5, 63, 8],
      [10, 66, 9],
    ] as const;
    for (const [reserve, boards, packs] of cases) {
      const result = calc({ ...room, reserve });
      expect(result.boardsWithReserve, `${reserve} %`).toBe(boards);
      expect(result.packs, `${reserve} %`).toBe(packs);
    }
  });

  it('К12: 9 упаковок по 1 849,90 ₽ = 16 649,10 ₽, без запаса 8 = 14 799,20 ₽', () => {
    expect(calc({ ...room, reserve: 10, packPrice: 1849.9 }).totalCost).toBe(16649.1);
    expect(calc({ ...room, reserve: 0, packPrice: 1849.9 }).totalCost).toBe(14799.2);
  });
});

describe('К13: реальная доска 1380 × 193, 8 в упаковке', () => {
  const room = { roomLength: 4, roomWidth: 3.5, boardLength: 1380, boardWidth: 193 };

  it('вдоль длины, 1/2: 19 рядов, последний 26 мм, 57 досок = 8 упаковок; по площади 53 = 7', () => {
    const result = calc(room);
    expect(result.rows).toBe(19);
    expect(result.lastRowWidth).toBe(26);
    expect(result.narrowLastRow).toBe(true);
    expect(rowsLayout(result).shift).toBe(0);
    expect(rowsOf(result)).toEqual([
      [1380, 1, 1240, 10],
      [690, 2, 550, 9],
    ]);
    expect(result.boards).toBe(57);
    expect(result.packs).toBe(8);
    expect(result.areaBoards).toBe(53);
    expect(result.areaPacks).toBe(7);
    expect(result.materialBound).toBe(56);
    expect(result.packArea).toBeCloseTo(2.13072, 10);
  });

  it('запас 5 %: 60 досок → 8 упаковок, к покупке 17,05 м²; «площадь + 5 %» = 56 досок', () => {
    const result = calc({ ...room, reserve: 5 });
    expect(result.boardsWithReserve).toBe(60);
    expect(result.packs).toBe(8);
    expect(result.areaToBuy).toBeCloseTo(17.04576, 10);
    expect(result.areaBoardsWithReserve).toBe(56);
  });

  it('вдоль длины по 1/3 и «от обрезка» — тоже 57; поперёк по 1/3 — 56 = 7 упаковок (§10)', () => {
    expect(calc({ ...room, scheme: 'third' }).boards).toBe(57);
    expect(calc({ ...room, scheme: 'offcut' }).boards).toBe(57);
    const across = calc({ ...room, scheme: 'third', direction: 'width' });
    expect(across.boards).toBe(56);
    expect(across.packs).toBe(7);
  });

  it('отходы плана 8,4 %', () => {
    expect(calc(room).wastePercent).toBeCloseTo(
      ((57 * 266_340 - 14_000_000) / 14_000_000) * 100,
      10,
    );
    expect(Math.round(calc(room).wastePercent * 10) / 10).toBe(8.4);
  });
});

describe('К14: ряд короче доски', () => {
  it('2,0 × 0,55 м поперёк: R = 550, 10 рядов, 2 отрезка из доски → 5 досок, 1 упаковка', () => {
    const result = calc({ roomLength: 2, roomWidth: 0.55, direction: 'width' });
    expect(result.rowLength).toBe(550);
    expect(result.rows).toBe(10);
    expect(result.layout).toEqual({ kind: 'short', piecesPerBoard: 2 });
    expect(result.boards).toBe(5);
    expect(result.areaBoards).toBe(5);
    expect(result.packs).toBe(1);
  });
});

describe('минимальная длина отрезка: границы', () => {
  it('конец ровно m допустим, на 1 мм короче — нет', () => {
    expect(isRowValid({ start: 1000, full: 1, end: 300 }, 300)).toBe(true);
    expect(isRowValid({ start: 1000, full: 1, end: 299 }, 300)).toBe(false);
    expect(isRowValid({ start: 299, full: 1, end: 0 }, 300)).toBe(false);
    expect(isRowValid({ start: 1200, full: 1, end: 0 }, 1200)).toBe(true);
  });

  it('К2 при m = 301: сдвиг растёт до 201 (конец 100 + d ≥ 301)', () => {
    const result = calc({ roomLength: 2.5, minPiece: 301 });
    expect(rowsLayout(result).shift).toBe(201);
    for (const t of rowsLayout(result).rowTypes) {
      expect(t.start).toBeGreaterThanOrEqual(301);
      expect(t.end === 0 || t.end >= 301).toBe(true);
    }
  });

  it('по умолчанию m = o = 400 мм', () => {
    const result = calc({ minPiece: null, minOffset: null });
    expect(result.minPiece).toBe(400);
    expect(result.minOffset).toBe(400);
  });

  it('m больше длины доски — ошибка поля', () => {
    expect(errorsOf({ minPiece: 1300 }).minPiece).toBe('Не больше длины доски (1200 мм).');
  });
});

describe('смещение стыков', () => {
  it('1/2 при o больше половины доски — ошибка схемы с причиной', () => {
    expect(errorsOf({ minOffset: 650 }).scheme).toBe(
      'Схема 1/2 даёт смещение стыков 600 мм — меньше минимального 650 мм. Выберите другую схему или направление либо проверьте требования производителя.',
    );
  });

  it('1/3 при o = 450 и доске 1200 — смещение 400 мм меньше требуемого', () => {
    expect(errorsOf({ scheme: 'third', minOffset: 450 }).scheme).toMatch(
      /^Схема 1\/3 даёт смещение стыков 400 мм — меньше минимального 450 мм\./,
    );
  });

  it('при одном ряде смещение не проверяется (§11)', () => {
    const result = calc({ roomWidth: 0.2, minOffset: 650 });
    expect(result.rows).toBe(1);
    expect(result.boards).toBe(2);
  });

  it('«от обрезка» не собирается — ошибка с номером ряда', () => {
    // m = 600, R = 2300: допустимы только начала 1100–1200 мм (иначе конец короче 600 мм);
    // смещение 600 мм от начала первого ряда (1200) требует начала 600 — второй ряд собрать нельзя.
    const message = errorsOf({
      roomLength: 2.3,
      scheme: 'offcut',
      minPiece: 600,
      minOffset: 600,
    }).scheme;
    expect(message).toBe(
      'Укладка «от обрезка» не собирается: для ряда 2 нет начала, при котором отрезки не короче 600 мм и стыки смещены не меньше чем на 600 мм. Выберите другую схему или направление либо проверьте требования производителя.',
    );
  });
});

describe('профиль замка в подсчёте досок', () => {
  it('два начала не вырезаются из одной доски, даже если помещаются по длине', () => {
    const rows = [
      { start: 400, full: 1, end: 0 },
      { start: 400, full: 1, end: 0 },
    ];
    expect(countBoards(rows, 1200)).toMatchObject({ full: 2, starts: 2, ends: 0, boards: 4 });
  });

  it('два конца не вырезаются из одной доски', () => {
    const rows = [
      { start: 1200, full: 0, end: 300 },
      { start: 1200, full: 0, end: 300 },
    ];
    expect(countBoards(rows, 1200).boards).toBe(4);
  });

  it('начало и конец из одной доски, если s + e ≤ l; ровно l — допустимо, l + 1 — нет', () => {
    expect(countBoards([{ start: 600, full: 0, end: 600 }], 1200).pairs).toHaveLength(1);
    expect(countBoards([{ start: 601, full: 0, end: 600 }], 1200).pairs).toHaveLength(0);
  });

  it('каждый отрезок участвует не больше чем в одной паре', () => {
    const count = rowsLayout(calc({ roomLength: 2, scheme: 'offcut' })).count;
    const startRows = count.pairs.map((p) => p.startRow);
    const endRows = count.pairs.map((p) => p.endRow);
    expect(new Set(startRows).size).toBe(startRows.length);
    expect(new Set(endRows).size).toBe(endRows.length);
  });
});

describe('проверка ввода', () => {
  it('пустые обязательные поля', () => {
    const errors = errorsOf({
      roomLength: null,
      roomWidth: null,
      boardLength: null,
      boardWidth: null,
      boardsPerPack: null,
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['boardLength', 'boardWidth', 'boardsPerPack', 'roomLength', 'roomWidth'].sort(),
    );
  });

  it('ноль, отрицательные, нечисловые значения', () => {
    expect(errorsOf({ roomLength: 0 }).roomLength).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ boardWidth: -200 }).boardWidth).toBe('Значение должно быть больше нуля.');
    expect(errorsOf({ boardLength: NaN }).boardLength).toBe('Введите число.');
    expect(errorsOf({ packPrice: Infinity }).packPrice).toBe('Введите число.');
    expect(errorsOf({ reserve: -1 }).reserve).toBe('Значение не может быть отрицательным.');
    expect(errorsOf({ packPrice: -1 }).packPrice).toBe('Значение не может быть отрицательным.');
  });

  it('диапазоны §11', () => {
    expect(errorsOf({ roomLength: 101 }).roomLength).toBe('Не больше 100 м.');
    expect(errorsOf({ boardLength: 50 }).boardLength).toBe('Не меньше 100 мм.');
    expect(errorsOf({ boardWidth: 700 }).boardWidth).toBe('Не больше 600 мм.');
    expect(errorsOf({ minPiece: 20 }).minPiece).toBe('Не меньше 50 мм.');
    expect(errorsOf({ reserve: 60 }).reserve).toBe('Не больше 50 %.');
  });

  it('досок в упаковке — целое число', () => {
    expect(errorsOf({ boardsPerPack: 8.5 }).boardsPerPack).toBe('Введите целое число.');
    expect(errorsOf({ boardsPerPack: 0 }).boardsPerPack).toBe('Значение должно быть больше нуля.');
  });

  it('запас — не больше одного знака после запятой; 5,5 % допустимо', () => {
    expect(errorsOf({ reserve: 5.55 }).reserve).toBe('Не больше одного знака после запятой.');
    // 60 · 1,055 = 63,3 → 64 доски
    expect(calc({ roomLength: 4.8, roomWidth: 3, reserve: 5.5 }).boardsWithReserve).toBe(64);
  });

  it('пустой запас — 0 %', () => {
    expect(calc({ roomLength: 4.8, roomWidth: 3, reserve: null }).boardsWithReserve).toBe(60);
  });

  it('неизвестные направление и схема', () => {
    expect(errorsOf({ direction: 'diagonal' }).direction).toBe('Выберите направление.');
    expect(errorsOf({ scheme: null }).scheme).toBe('Выберите схему.');
  });
});
