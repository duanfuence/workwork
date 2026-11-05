/**
 * Свойства модели ламината (docs/calculators/LAMINATE.md, §9) на сетке размеров.
 * Проверки не повторяют построение рядов: они проверяют ограничения на готовом результате,
 * а паросочетание сверяют с полным перебором.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateLaminate,
  countBoards,
  jointOffset,
  type LaminateInput,
  type LaminateScheme,
  type Row,
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

/** Наибольшее число пар «начало + конец ≤ l» полным перебором (для малых наборов). */
function bruteForcePairs(starts: number[], ends: number[], l: number): number {
  let best = 0;
  const used = new Array<boolean>(ends.length).fill(false);
  const go = (i: number, pairs: number) => {
    if (pairs + (starts.length - i) <= best) return;
    if (i === starts.length) {
      best = Math.max(best, pairs);
      return;
    }
    go(i + 1, pairs);
    for (let j = 0; j < ends.length; j += 1) {
      const start = starts[i] ?? 0;
      const end = ends[j] ?? 0;
      if (!used[j] && start + end <= l) {
        used[j] = true;
        go(i + 1, pairs + 1);
        used[j] = false;
      }
    }
  };
  go(0, 0);
  return best;
}

const lengths = [1.3, 1.9, 2, 2.3, 2.401, 2.5, 2.77, 3.15, 3.6, 4.05];
const widths = [0.2, 0.4, 0.8, 1.05, 1.3];
const boards = [
  [1200, 200],
  [1380, 193],
  [1285, 192],
] as const;
const schemes: LaminateScheme[] = ['half', 'third', 'offcut'];
const requirements = [300, 400] as const;

type Case = { input: LaminateInput; label: string };
const cases: Case[] = [];
for (const roomLength of lengths)
  for (const roomWidth of widths)
    for (const [boardLength, boardWidth] of boards)
      for (const scheme of schemes)
        for (const req of requirements)
          for (const direction of ['length', 'width'] as const)
            cases.push({
              input: {
                ...base,
                roomLength,
                roomWidth,
                boardLength,
                boardWidth,
                scheme,
                direction,
                minPiece: req,
                minOffset: req,
              },
              label: `${roomLength}×${roomWidth} ${boardLength}×${boardWidth} ${scheme} ${direction} m=o=${req}`,
            });

describe('свойства раскладки на сетке размеров', () => {
  let feasible = 0;
  let infeasible = 0;

  it.each([['все случаи']])('%s', () => {
    for (const { input, label } of cases) {
      const calculation = calculateLaminate(input);
      if (!calculation.ok) {
        // Невыполнимость — только с объяснением в поле «Схема».
        infeasible += 1;
        expect(Object.keys(calculation.errors), label).toEqual(['scheme']);
        expect(calculation.errors.scheme, label).toMatch(
          /невыполнима|не собирается|смещение стыков/,
        );
        continue;
      }
      feasible += 1;
      const result = calculation.result;
      const l = input.boardLength ?? 0;
      const m = input.minPiece ?? 0;
      const o = input.minOffset ?? 0;

      expect(result.boards, label).toBeGreaterThanOrEqual(result.materialBound);
      expect(result.materialBound, label).toBeGreaterThanOrEqual(result.areaBoards);
      expect(result.packs, label).toBe(Math.ceil(result.boards / 8));

      if (result.layout.kind === 'short') {
        expect(result.rowLength, label).toBeLessThanOrEqual(l);
        continue;
      }
      const { rows, count } = result.layout;
      expect(rows, label).toHaveLength(result.rows);
      rows.forEach((row: Row, i) => {
        expect(row.start + row.full * l + row.end, `${label}: ряд ${i}`).toBe(result.rowLength);
        expect(row.start, label).toBeGreaterThanOrEqual(m);
        expect(row.start, label).toBeLessThanOrEqual(l);
        expect(row.end === 0 || row.end >= m, label).toBe(true);
        expect(row.end, label).toBeLessThan(l);
        const next = rows[i + 1];
        if (next) {
          const offset = jointOffset(row.start, next.start, l);
          expect(offset, label).toBeGreaterThanOrEqual(o);
          if (input.scheme === 'half') expect(offset, label).toBe(Math.floor(l / 2));
          if (input.scheme === 'third') {
            const t = Math.floor(l / 3);
            expect([t, Math.min(2 * t, l - 2 * t)], label).toContain(offset);
          }
        }
      });

      // Подсчёт: формула, пары, баланс материала.
      expect(count.boards, label).toBe(count.full + count.starts + count.ends - count.pairs.length);
      expect(count.boards, label).toBeLessThanOrEqual(count.full + count.starts + count.ends);
      expect(count.pairs.length, label).toBeLessThanOrEqual(Math.min(count.starts, count.ends));
      const pairedStarts = new Set(count.pairs.map((p) => p.startRow));
      const pairedEnds = new Set(count.pairs.map((p) => p.endRow));
      expect(pairedStarts.size, label).toBe(count.pairs.length);
      expect(pairedEnds.size, label).toBe(count.pairs.length);
      for (const pair of count.pairs) {
        expect(pair.start + pair.end, label).toBeLessThanOrEqual(l);
        expect(rows[pair.startRow]?.start, label).toBe(pair.start);
        expect(rows[pair.endRow]?.end, label).toBe(pair.end);
      }
      const waste = result.boards * l - result.rows * result.rowLength;
      expect(waste, label).toBeGreaterThanOrEqual(0);
    }
    expect(feasible).toBeGreaterThan(500);
    expect(infeasible).toBeGreaterThan(0);
  });
});

/**
 * Эталон для «от обрезка»: существует ли хоть какая-то последовательность из `rows` допустимых рядов
 * со смещением соседних `≥ o`. Перебор по рядам: множество начал, до которых можно дойти к ряду i.
 * Не использует ни правило выбора начала, ни теорему о паре начал (§13).
 */
function offcutLayoutExists(rowLength: number, rows: number, l: number, m: number, o: number) {
  const valid: number[] = [];
  for (let s = m; s <= l; s += 1) {
    const end = (rowLength - s) % l;
    if (end === 0 || end >= m) valid.push(s);
  }
  let reach = valid;
  for (let i = 1; i < rows && reach.length > 0; i += 1) {
    const previous = reach;
    reach = valid.filter((s) => previous.some((p) => jointOffset(s, p, l) >= o));
  }
  return reach.length > 0;
}

describe('«от обрезка» против перебора по рядам (§4.3, §13)', () => {
  it('отказ только когда раскладки нет; при m < o, m = o, m > o', () => {
    const seen = { less: 0, equal: 0, greater: 0, refused: 0 };
    for (const l of [100, 151, 240])
      for (let m = 50; m <= l; m += 25)
        for (let o = 50; o <= l / 2; o += 10)
          for (let rowLength = l + 1; rowLength <= 2 * l; rowLength += 3)
            for (const rows of [1, 2, 4]) {
              const label = `l=${l} m=${m} o=${o} R=${rowLength} N=${rows}`;
              const calculation = calculateLaminate({
                ...base,
                roomLength: rowLength / 1000,
                roomWidth: rows / 10,
                boardLength: l,
                boardWidth: 100,
                scheme: 'offcut',
                minPiece: m,
                minOffset: o,
              });
              const exists = offcutLayoutExists(rowLength, rows, l, m, o);
              expect(calculation.ok, label).toBe(exists);
              if (m < o) seen.less += 1;
              else if (m === o) seen.equal += 1;
              else seen.greater += 1;
              if (!calculation.ok) {
                seen.refused += 1;
                expect(calculation.errors.scheme, label).toMatch(
                  /^Укладка «от обрезка» невыполнима/,
                );
                continue;
              }
              const layout = calculation.result.layout;
              if (layout.kind !== 'rows') throw new Error(label);
              expect(layout.rows, label).toHaveLength(rows);
              layout.rows.forEach((row, i) => {
                expect(row.start + row.full * l + row.end, label).toBe(rowLength);
                expect(row.start >= m && (row.end === 0 || row.end >= m), label).toBe(true);
                const next = layout.rows[i + 1];
                if (next)
                  expect(jointOffset(row.start, next.start, l), label).toBeGreaterThanOrEqual(o);
              });
            }
    expect(seen.less).toBeGreaterThan(1000);
    expect(seen.equal).toBeGreaterThan(100);
    expect(seen.greater).toBeGreaterThan(1000);
    expect(seen.refused).toBeGreaterThan(100);
  });

  it('К15-полоса: доска 1200, m = 300, o = 500, R = 3101…3199 — совпадает с перебором', () => {
    for (let rowLength = 3101; rowLength <= 3199; rowLength += 1) {
      const calculation = calculateLaminate({
        ...base,
        roomLength: rowLength / 1000,
        scheme: 'offcut',
        minOffset: 500,
      });
      expect(calculation.ok, `R=${rowLength}`).toBe(
        offcutLayoutExists(rowLength, 5, 1200, 300, 500),
      );
    }
  });
});

describe('паросочетание совпадает с полным перебором', () => {
  it('на 300 псевдослучайных наборах рядов', () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 300; k += 1) {
      const l = 1000 + Math.floor(random() * 400);
      const rows: Row[] = Array.from({ length: 1 + Math.floor(random() * 7) }, () => ({
        start: random() < 0.2 ? l : 100 + Math.floor(random() * (l - 100)),
        full: Math.floor(random() * 3),
        end: random() < 0.2 ? 0 : 100 + Math.floor(random() * (l - 100)),
      }));
      const count = countBoards(rows, l);
      const starts = rows.filter((r) => r.start < l).map((r) => r.start);
      const ends = rows.filter((r) => r.end > 0).map((r) => r.end);
      expect(count.pairs.length, JSON.stringify(rows)).toBe(bruteForcePairs(starts, ends, l));
    }
  });
});

describe('упаковки и запас', () => {
  it('упаковки не убывают с ростом запаса, формула ⌈⌈B·(1000 + 10z)/1000⌉ / n⌉', () => {
    let previous = 0;
    for (let tenths = 0; tenths <= 500; tenths += 7) {
      const reserve = tenths / 10;
      const calculation = calculateLaminate({ ...base, roomLength: 4.8, roomWidth: 3, reserve });
      if (!calculation.ok) throw new Error('ошибка');
      const { boards, boardsWithReserve, packs } = calculation.result;
      expect(boardsWithReserve).toBe(Math.ceil((boards * (1000 + tenths)) / 1000 - 1e-9));
      expect(packs).toBe(Math.ceil(boardsWithReserve / 8));
      expect(packs).toBeGreaterThanOrEqual(previous);
      previous = packs;
    }
  });
});

describe('зазор и пропил: баланс материала и ограничения (§15)', () => {
  const tenths = (value: number) => Math.round(value * 10);
  /** Эталон для ряда короче доски: укладываем куски по одному, пока помещаются с пропилом между ними. */
  const piecesByPacking = (l: number, rowLength: number, kerf: number) => {
    let used = 0;
    let pieces = 0;
    while (used + rowLength * 10 + (pieces > 0 ? kerf : 0) <= l * 10) {
      used += rowLength * 10 + (pieces > 0 ? kerf : 0);
      pieces += 1;
    }
    return pieces;
  };

  it('баланс, отрезки, смещение, пары и короткие ряды на сетке с зазором 0/8/30 и пропилом 0/2,3/3/5', () => {
    const seen = { rows: 0, short: 0, refused: 0, belowArea: 0 };
    for (const [boardLength, boardWidth] of [
      [1200, 200],
      [1380, 193],
    ] as const)
      for (const roomLength of [0.55, 1.3, 2.413, 3.15, 4.05])
        for (const roomWidth of [0.4, 1.01, 2.6])
          for (const scheme of schemes)
            for (const [m, o] of [
              [300, 300],
              [400, 400],
              [300, 500],
            ] as const)
              for (const direction of ['length', 'width'] as const)
                for (const gap of [0, 8, 30]) {
                  let previous = 0;
                  for (const kerf of [0, 2.3, 3, 5]) {
                    const input: LaminateInput = {
                      ...base,
                      roomLength,
                      roomWidth,
                      boardLength,
                      boardWidth,
                      scheme,
                      direction,
                      minPiece: m,
                      minOffset: o,
                      gap,
                      kerf,
                    };
                    const label = JSON.stringify(input);
                    const calculation = calculateLaminate(input);
                    if (!calculation.ok) {
                      seen.refused += 1;
                      expect(Object.keys(calculation.errors), label).toEqual(['scheme']);
                      continue;
                    }
                    const result = calculation.result;
                    const l = boardLength;
                    const [R, D] =
                      direction === 'length' ? [roomLength, roomWidth] : [roomWidth, roomLength];
                    expect(result.rowLength, label).toBe(Math.round(R * 1000) - 2 * gap);
                    expect(result.fieldWidth, label).toBe(Math.round(D * 1000) - 2 * gap);
                    expect(result.rows, label).toBe(Math.ceil(result.fieldWidth / boardWidth));
                    expect(result.lastRowWidth, label).toBeGreaterThan(0);
                    expect(result.lastRowWidth, label).toBeLessThanOrEqual(boardWidth);

                    // Баланс длины: доски = ряды + пропил между частями + обрезки; ничего не отрицательно.
                    expect(result.kerfLength, label).toBeGreaterThanOrEqual(0);
                    expect(result.offcutLength, label).toBeGreaterThanOrEqual(-1e-9);
                    expect(
                      tenths(
                        result.rows * result.rowLength + result.kerfLength + result.offcutLength,
                      ),
                      label,
                    ).toBe(result.boards * l * 10);
                    expect(result.wastePercent, label).toBeGreaterThanOrEqual(0);
                    expect(result.boards, label).toBeGreaterThanOrEqual(result.materialBound);
                    if (result.boards < result.areaBoards) seen.belowArea += 1;

                    if (result.layout.kind === 'short') {
                      seen.short += 1;
                      expect(result.layout.piecesPerBoard, label).toBe(
                        piecesByPacking(l, result.rowLength, tenths(kerf)),
                      );
                      expect(tenths(result.kerfLength), label).toBe(
                        (result.rows - result.boards) * tenths(kerf),
                      );
                      continue;
                    }
                    seen.rows += 1;
                    const { rows, count } = result.layout;
                    rows.forEach((row, i) => {
                      expect(tenths(row.start) + row.full * l * 10 + tenths(row.end), label).toBe(
                        result.rowLength * 10,
                      );
                      expect(row.start, label).toBeGreaterThanOrEqual(m);
                      expect(row.end === 0 || row.end >= m, label).toBe(true);
                      const next = rows[i + 1];
                      if (next) {
                        expect(
                          jointOffset(tenths(row.start), tenths(next.start), l * 10),
                          label,
                        ).toBeGreaterThanOrEqual(o * 10);
                      }
                    });
                    // Пары: пропил между частями, каждая часть — в одной паре, число пар — наибольшее.
                    expect(tenths(result.kerfLength), label).toBe(
                      count.pairs.length * tenths(kerf),
                    );
                    expect(new Set(count.pairs.map((p) => p.startRow)).size, label).toBe(
                      count.pairs.length,
                    );
                    expect(new Set(count.pairs.map((p) => p.endRow)).size, label).toBe(
                      count.pairs.length,
                    );
                    for (const pair of count.pairs) {
                      expect(
                        tenths(pair.start) + tenths(pair.end) + tenths(kerf),
                        label,
                      ).toBeLessThanOrEqual(l * 10);
                    }
                    const starts = rows
                      .filter((row) => row.start < l)
                      .map((row) => tenths(row.start));
                    const ends = rows.filter((row) => row.end > 0).map((row) => tenths(row.end));
                    if (starts.length <= 8) {
                      expect(count.pairs.length, label).toBe(
                        bruteForcePairs(starts, ends, l * 10 - tenths(kerf)),
                      );
                    }
                    // Для 1/2 и 1/3 ряды не зависят от пропила — расход с ростом пропила не убывает.
                    if (scheme !== 'offcut') {
                      expect(result.boards, label).toBeGreaterThanOrEqual(previous);
                      previous = result.boards;
                    }
                  }
                }
    expect(seen.rows).toBeGreaterThan(1000);
    expect(seen.short).toBeGreaterThan(100);
    expect(seen.refused).toBeGreaterThan(10);
    expect(seen.belowArea).toBeGreaterThan(10);
  });
});
