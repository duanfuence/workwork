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
  // К1–К15 и свойства модели 1.2 — без зазора и пропила (§15.4: при g = k = 0 модель 2.0-а совпадает с 1.2).
  gap: 0,
  kerf: 0,
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

describe('К15: «от обрезка» при m < o (§13)', () => {
  const room = { roomLength: 3.15, scheme: 'offcut', minOffset: 500 } as const;

  it('3,15 × 1,0 м, m = 300, o = 500: раскладка находится — 15 досок, 2 упаковки', () => {
    const result = calc(room);
    expect(result.rows).toBe(5);
    expect(rowsLayout(result).rows.map((r) => r.start)).toEqual([1150, 450, 1150, 450, 1150]);
    expect(rowsOf(result)).toEqual([
      [1150, 1, 800, 3],
      [450, 2, 300, 2],
    ]);
    expect(result.boards).toBe(15);
    expect(result.packs).toBe(2);
    expect(result.areaBoards).toBe(14);
  });

  it('подсчёт: F = 7, |S| = 5, |E| = 5, пары — только 450 + 300, M = 2; отход 2250 мм', () => {
    const count = rowsLayout(calc(room)).count;
    expect(count).toMatchObject({ full: 7, starts: 5, ends: 5, boards: 15 });
    expect(count.pairs.map((p) => [p.start, p.end])).toEqual([
      [450, 300],
      [450, 300],
    ]);
    expect(15 * 1200 - 5 * 3150).toBe(2250);
  });

  it('ряды аудита 300 | 2×1200 | 450 и 800 | 1200 | 1150 тоже дают 15 досок с учётом замка', () => {
    const rows = [0, 1, 2, 3, 4].map((i) =>
      i % 2 === 0 ? { start: 300, full: 2, end: 450 } : { start: 800, full: 1, end: 1150 },
    );
    rows.forEach((row) => {
      expect(row.start + row.full * 1200 + row.end).toBe(3150);
      expect(isRowValid(row, 300)).toBe(true);
    });
    const count = countBoards(rows, 1200);
    // 800 + 450 = 1250 и 300 + 1150 = 1450 не помещаются в доску; пары — только 300 + 450.
    expect(count).toMatchObject({ full: 8, starts: 5, ends: 5, boards: 15 });
    expect(count.pairs).toHaveLength(3);
  });

  it('та же комната: 1/2 — d = 150, 15 досок; 1/3 — смещение 400 мм меньше 500', () => {
    const half = calc({ ...room, scheme: 'half' });
    expect(rowsLayout(half).shift).toBe(150);
    expect(half.boards).toBe(15);
    expect(errorsOf({ ...room, scheme: 'third' }).scheme).toMatch(/смещение стыков 400 мм/);
  });

  it('m > o (m = 400, o = 300) — раскладка как в К9, 9 досок', () => {
    const result = calc({ roomLength: 2, scheme: 'offcut', minPiece: 400, minOffset: 300 });
    expect(rowsOf(result)).toEqual([
      [1200, 0, 800, 2],
      [400, 1, 400, 2],
      [800, 1, 0, 1],
    ]);
    expect(result.boards).toBe(9);
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

  it('«от обрезка» невыполнима: нет двух допустимых начал со смещением ≥ o', () => {
    // m = 600, R = 2300: допустимы только начала 1100–1200 мм (иначе конец короче 600 мм);
    // любые два из них смещены меньше чем на 600 мм — соседние ряды собрать нельзя.
    const message = errorsOf({
      roomLength: 2.3,
      scheme: 'offcut',
      minPiece: 600,
      minOffset: 600,
    }).scheme;
    expect(message).toBe(
      'Укладка «от обрезка» невыполнима для этих размеров: нет двух начал ряда, при которых отрезки не короче 600 мм, а стыки соседних рядов смещены не меньше чем на 600 мм. Выберите другую схему или направление либо проверьте требования производителя.',
    );
  });

  it('«от обрезка» невыполнима: ни одного допустимого начала ряда', () => {
    // m = 700, R = 2500: начало 1200 даёт конец 100, начала 700–1199 — концы 101–600 мм.
    expect(errorsOf({ roomLength: 2.5, scheme: 'offcut', minPiece: 700 }).scheme).toBe(
      'Укладка «от обрезка» невыполнима для этих размеров: при любом начале в ряду остаётся отрезок короче 700 мм. Выберите другую схему или направление либо проверьте требования производителя.',
    );
    expect(errorsOf({ roomLength: 2.5, minPiece: 700 }).scheme).toMatch(/^Схема 1\/2 невыполнима/);
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

describe('З1–З13: зазор у стен и пропил (§15.5)', () => {
  const r = (start: number, full: number, end: number, count: number) => [start, full, end, count];

  it('З1: без зазора и пропила — как К1, 10 досок, отход 0', () => {
    const result = calc({});
    expect(result.boards).toBe(10);
    expect([result.kerfLength, result.offcutLength]).toEqual([0, 0]);
  });

  it('З2: пропил 3 мм ломает пару 600 + 600 — 12 досок, отход 2400 мм (рез по отходу)', () => {
    const result = calc({ kerf: 3 });
    expect(rowsLayout(result).count).toMatchObject({ full: 8, starts: 2, ends: 2, boards: 12 });
    expect(rowsLayout(result).count.pairs).toHaveLength(0);
    expect([result.kerfLength, result.offcutLength]).toEqual([0, 2400]);
  });

  it('З3: зазор 10, пропил 3 — поле 2380 × 980, 5 рядов, 10 досок, пропил 6 + обрезки 94', () => {
    const result = calc({ gap: 10, kerf: 3 });
    expect([result.rowLength, result.fieldWidth, result.rows, result.lastRowWidth]).toEqual([
      2380, 980, 5, 180,
    ]);
    expect(rowsOf(result)).toEqual([r(1200, 0, 1180, 3), r(600, 1, 580, 2)]);
    expect(rowsLayout(result).count.pairs.map((p) => [p.start, p.end])).toEqual([
      [600, 580],
      [600, 580],
    ]);
    expect(result.boards).toBe(10);
    expect([result.kerfLength, result.offcutLength]).toEqual([6, 94]);
    expect(result.areaBoards).toBe(10);
  });

  it('З4: 2,4 × 1,01 м — без зазора 6 рядов (последний 10 мм) и 12 досок, с зазором 8 — 5 рядов и 10', () => {
    const without = calc({ roomWidth: 1.01 });
    expect([without.rows, without.lastRowWidth, without.boards]).toEqual([6, 10, 12]);
    const withGap = calc({ roomWidth: 1.01, gap: 8 });
    expect([withGap.rows, withGap.lastRowWidth, withGap.boards]).toEqual([5, 194, 10]);
    expect(rowsOf(withGap)).toEqual([r(1200, 0, 1184, 3), r(600, 1, 584, 2)]);
    expect(withGap.offcutLength).toBe(80);
    expect(withGap.areaBoards).toBe(11);
    expect(calc({ roomWidth: 1.01, gap: 8, kerf: 3 }).boards).toBe(10);
  });

  it('З5: конец ровно m = 300 допустим — 13 досок, отход 2100', () => {
    const result = calc({ roomLength: 2.7 });
    expect(rowsOf(result)).toEqual([r(1200, 1, 300, 3), r(600, 1, 900, 2)]);
    expect(result.boards).toBe(13);
    expect(result.offcutLength).toBe(2100);
  });

  it('З6: зазор 8 делает конец 284 < 300 — сдвиг 16 мм, 13 досок', () => {
    const result = calc({ roomLength: 2.7, gap: 8, kerf: 3 });
    expect(rowsLayout(result).shift).toBe(16);
    expect(rowsOf(result)).toEqual([r(1184, 1, 300, 3), r(584, 1, 900, 2)]);
    expect(rowsLayout(result).count).toMatchObject({ full: 5, starts: 5, ends: 5, boards: 13 });
    expect(result.kerfLength + result.offcutLength).toBe(2180);
  });

  it('З7: 2,413 м — пара 600 + 597 + 3 ровно 1200, 10 досок; 2,414 м — 1201, 12 досок', () => {
    const exact = calc({ roomLength: 2.413, gap: 8, kerf: 3 });
    expect(rowsOf(exact)).toEqual([r(1200, 0, 1197, 3), r(600, 1, 597, 2)]);
    expect(exact.boards).toBe(10);
    expect([exact.kerfLength, exact.offcutLength]).toEqual([6, 9]);
    expect(exact.areaBoards).toBe(11);
    const over = calc({ roomLength: 2.414, gap: 8, kerf: 3 });
    expect(over.boards).toBe(12);
    expect(over.kerfLength + over.offcutLength).toBe(2410);
  });

  it('пропил 0 / 2,3 / 3 / 3,1 / 5 мм в З7а: 10 / 10 / 10 / 12 / 12 досок (пара помещается при k ≤ 3)', () => {
    const boards = [0, 2.3, 3, 3.1, 5].map(
      (kerf) => calc({ roomLength: 2.413, gap: 8, kerf }).boards,
    );
    expect(boards).toEqual([10, 10, 10, 12, 12]);
    const thin = calc({ roomLength: 2.413, gap: 8, kerf: 2.3 });
    expect(thin.kerf).toBe(2.3);
    expect(thin.kerfLength).toBeCloseTo(4.6, 10);
    expect(thin.offcutLength).toBeCloseTo(10.4, 10);
  });

  it('З8: «от обрезка», пропил 3 — обрезок 397 используется, 794 — нет; 10 досок (без пропила 9)', () => {
    const result = calc({ roomLength: 2, scheme: 'offcut', kerf: 3 });
    expect(rowsOf(result)).toEqual([r(1200, 0, 800, 3), r(397, 1, 403, 2)]);
    expect(rowsLayout(result).count.pairs.map((p) => [p.start, p.end])).toEqual([
      [397, 800],
      [397, 800],
    ]);
    expect(result.boards).toBe(10);
    expect(result.kerfLength + result.offcutLength).toBe(2000);
    expect(calc({ roomLength: 2, scheme: 'offcut' }).boards).toBe(9);
  });

  it('З9: «от обрезка», m = 300 < o = 500, зазор 10, пропил 3 — 15 досок', () => {
    const result = calc({ roomLength: 3.15, scheme: 'offcut', minOffset: 500, gap: 10, kerf: 3 });
    expect(rowsLayout(result).rows.map((row) => row.start)).toEqual([1130, 430, 1130, 430, 1130]);
    expect(rowsOf(result)).toEqual([r(1130, 1, 800, 3), r(430, 2, 300, 2)]);
    expect(rowsLayout(result).count).toMatchObject({ full: 7, starts: 5, ends: 5, boards: 15 });
    expect(result.kerfLength + result.offcutLength).toBe(2350);
    expect(calc({ roomLength: 3.15, scheme: 'offcut', minOffset: 500, kerf: 3 }).boards).toBe(15);
  });

  it('З10: ряд короче доски 400 мм — 3 куска (4 доски); с пропилом 3 — 2 (5); зазор 8 + пропил 3 — 3 (4)', () => {
    const short = (overrides: Partial<LaminateInput>) =>
      calc({ roomLength: 2, roomWidth: 0.4, direction: 'width', ...overrides });
    expect(short({}).layout).toEqual({ kind: 'short', piecesPerBoard: 3 });
    expect(short({}).boards).toBe(4);
    expect(short({ kerf: 3 }).layout).toEqual({ kind: 'short', piecesPerBoard: 2 });
    expect([short({ kerf: 3 }).boards, short({ kerf: 3 }).kerfLength]).toEqual([5, 15]);
    const both = short({ gap: 8, kerf: 3 });
    expect([both.rowLength, both.rows, both.boards]).toEqual([384, 10, 4]);
    expect([both.kerfLength, both.offcutLength]).toEqual([18, 942]);
    expect(short({ kerf: 2.3 }).boards).toBe(5);
    expect(short({ gap: 8, kerf: 2.3 }).boards).toBe(4);
  });

  it('З11: естественный обрезок ровно m при пропиле 3 — используется; при 4 (299 мм) — нет; 10 досок', () => {
    const k3 = calc({ roomLength: 2.097, scheme: 'offcut', kerf: 3 });
    expect(rowsOf(k3)).toEqual([r(1200, 0, 897, 3), r(300, 1, 597, 2)]);
    expect(k3.boards).toBe(10);
    const k4 = calc({ roomLength: 2.097, scheme: 'offcut', kerf: 4 });
    expect(rowsOf(k4)).toEqual([r(1200, 0, 897, 3), r(900, 0, 1197, 2)]);
    expect(rowsLayout(k4).count.pairs).toHaveLength(0);
    expect(k4.boards).toBe(10);
    expect(calc({ roomLength: 2.097, scheme: 'offcut' }).boards).toBe(10);
  });

  it('З12: 2,42 м по 1/3 — без зазора невыполнима; с зазором 10 — 10 досок; плюс пропил 3 — 12', () => {
    expect(errorsOf({ roomLength: 2.42, scheme: 'third' }).scheme).toMatch(
      /^Схема 1\/3 невыполнима/,
    );
    const gap = calc({ roomLength: 2.42, scheme: 'third', gap: 10 });
    expect(rowsOf(gap)).toEqual([r(1200, 1, 0, 2), r(800, 1, 400, 2), r(400, 1, 800, 1)]);
    expect([gap.boards, gap.offcutLength]).toEqual([10, 0]);
    const both = calc({ roomLength: 2.42, scheme: 'third', gap: 10, kerf: 3 });
    expect(rowsLayout(both).count.pairs.map((p) => [p.start, p.end])).toEqual([[400, 400]]);
    expect(both.boards).toBe(12);
  });

  it('З13: 4,0 × 3,48 м, доска 1380 × 193 — 19 рядов и 57 досок (8 уп.); зазор 8, пропил 3 — 18 и 54 (7 уп.)', () => {
    const room = { roomLength: 4, roomWidth: 3.48, boardLength: 1380, boardWidth: 193 };
    const without = calc(room);
    expect([without.rows, without.lastRowWidth, without.boards, without.packs]).toEqual([
      19, 6, 57, 8,
    ]);
    const withGap = calc({ ...room, gap: 8, kerf: 3 });
    expect([withGap.rows, withGap.lastRowWidth, withGap.boards, withGap.packs]).toEqual([
      18, 183, 54, 7,
    ]);
    expect(rowsOf(withGap)).toEqual([r(1380, 1, 1224, 9), r(690, 2, 534, 9)]);
    expect(withGap.kerfLength + withGap.offcutLength).toBe(2808);
    expect(withGap.areaBoards).toBe(53);
    expect(calc({ ...room, gap: 8, kerf: 3, reserve: 5 }).packs).toBe(8);
  });
});

describe('зазор и пропил: ввод и значения по умолчанию', () => {
  it('пусто — зазор 8 мм и пропил 3 мм (расчётные предположения §15.7)', () => {
    const result = calc({ gap: null, kerf: null });
    expect([result.gap, result.kerf]).toEqual([8, 3]);
    expect([result.rowLength, result.fieldWidth]).toEqual([2384, 984]);
  });

  it('границы: зазор 0 и 30, пропил 0 и 5 допустимы; 31, −1, 8,5, 5,1, 2,35 — ошибки поля', () => {
    expect(calc({ gap: 30, kerf: 5 }).rowLength).toBe(2340);
    expect(calc({ gap: 0, kerf: 0 }).rowLength).toBe(2400);
    expect(errorsOf({ gap: 31 }).gap).toBe('Не больше 30 мм.');
    expect(errorsOf({ gap: -1 }).gap).toBe('Значение не может быть отрицательным.');
    expect(errorsOf({ gap: 8.5 }).gap).toBe('Введите целое число миллиметров.');
    expect(errorsOf({ kerf: 5.1 }).kerf).toBe('Не больше 5 мм.');
    expect(errorsOf({ kerf: 2.35 }).kerf).toBe('Не больше одного знака после запятой.');
  });

  it('самая маленькая комната 0,1 × 0,1 м при зазоре 30 — поле 40 × 40 мм, расчёт без ошибок', () => {
    const result = calc({ roomLength: 0.1, roomWidth: 0.1, gap: 30 });
    expect([result.rowLength, result.fieldWidth, result.rows]).toEqual([40, 40, 1]);
    // Без пропила 1200 / 40 = 30 кусков; с пропилом 3: 27·40 + 26·3 = 1158 ≤ 1200, 28·40 + 27·3 = 1201.
    expect(result.layout).toEqual({ kind: 'short', piecesPerBoard: 30 });
    expect(calc({ roomLength: 0.1, roomWidth: 0.1, gap: 30, kerf: 3 }).layout).toEqual({
      kind: 'short',
      piecesPerBoard: 27,
    });
    expect(result.boards).toBe(1);
  });
});
