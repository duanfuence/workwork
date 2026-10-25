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
