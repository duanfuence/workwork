/**
 * Геометрический эталон раскроя (LAMINATE.md §16.2). Не использует формулу «целые + начала + концы − пары»:
 * доска — отрезок [0, l] в десятых мм; конец ряда обязан касаться 0 (заводской левый торец), начало —
 * касаться l, кусок короткого ряда — где угодно; между соседними кусками — рез шириной k. Минимум досок —
 * перебор разбиений кусков по доскам; баланс — по позициям кусков на каждой доске.
 * Ряды берутся из расчёта: правило рядов задано документом и проверяется другими тестами.
 */
import { describe, expect, it } from 'vitest';
import { calculateLaminate, type LaminateInput, type LaminateResult } from './laminate';

type Piece = { kind: 'end' | 'start' | 'free'; length: number };

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
  gap: 0,
  kerf: 0,
};

/** Помещаются ли куски на одну доску: торцы — не больше одного каждого вида, между кусками — рез. */
function fitsOnBoard(pieces: readonly Piece[], l: number, k: number): boolean {
  if (pieces.filter((p) => p.kind === 'end').length > 1) return false;
  if (pieces.filter((p) => p.kind === 'start').length > 1) return false;
  const total = pieces.reduce((sum, p) => sum + p.length, 0);
  return total + k * (pieces.length - 1) <= l;
}

/** Опилки и остатки одной доски по позициям: конец слева, свободные подряд, начало справа. */
function cutBoard(pieces: readonly Piece[], l: number, k: number) {
  const ordered = [
    ...pieces.filter((p) => p.kind === 'end'),
    ...pieces.filter((p) => p.kind === 'free'),
  ];
  const used: [number, number][] = [];
  let cursor = 0;
  for (const piece of ordered) {
    if (used.length > 0) cursor += k;
    used.push([cursor, cursor + piece.length]);
    cursor += piece.length;
  }
  const start = pieces.find((p) => p.kind === 'start');
  if (start) used.push([l - start.length, l]);
  used.sort((a, b) => a[0] - b[0]);
  let saw = 0;
  let rest = 0;
  const edges = [0, ...used.flat(), l];
  for (let i = 0; i < edges.length; i += 2) {
    const [a, b] = [edges[i] ?? 0, edges[i + 1] ?? 0];
    if (b <= a) continue;
    // Каждая грань куска, выходящая в промежуток не на торце доски, требует реза шириной k.
    const faces = (a === 0 ? 0 : 1) + (b === l ? 0 : 1);
    const cut = Math.min(b - a, k * faces);
    saw += cut;
    rest += b - a - cut;
  }
  const usedLength = pieces.reduce((sum, p) => sum + p.length, 0);
  return { saw, rest, usedLength };
}

/** Наименьшее число досок для кусков: перебор разбиений (кусок с наименьшим номером — в какой доске). */
function minimalBoards(pieces: readonly Piece[], l: number, k: number): number[][] {
  const n = pieces.length;
  const memo = new Map<number, number[][]>();
  const solve = (mask: number): number[][] => {
    if (mask === 0) return [];
    const cached = memo.get(mask);
    if (cached) return cached;
    let first = 0;
    while (!(mask & (1 << first))) first += 1;
    let best: number[][] | null = null;
    const others = Array.from({ length: n }, (_, i) => i).filter(
      (i) => i !== first && mask & (1 << i),
    );
    const grow = (group: number[], from: number) => {
      const groupMask = group.reduce((m, i) => m | (1 << i), 0);
      const rest = solve(mask & ~groupMask);
      if (!best || rest.length + 1 < best.length) best = [group, ...rest];
      for (let j = from; j < others.length; j += 1) {
        const next = [...group, others[j] ?? 0];
        if (
          fitsOnBoard(
            next.map((i) => pieces[i] as Piece),
            l,
            k,
          )
        )
          grow(next, j + 1);
      }
    };
    grow([first], 0);
    memo.set(mask, best ?? []);
    return best ?? [];
  };
  return solve((1 << n) - 1);
}

function checkGeometry(input: LaminateInput, label: string): LaminateResult | null {
  const calculation = calculateLaminate(input);
  if (!calculation.ok) return null;
  const result = calculation.result;
  const l = result.boardLength * 10;
  const k = Math.round(result.kerf * 10);
  const R = result.rowLength * 10;
  let full = 0;
  const pieces: Piece[] = [];
  if (result.layout.kind === 'short') {
    for (let i = 0; i < result.rows; i += 1) pieces.push({ kind: 'free', length: R });
  } else {
    for (const row of result.layout.rows) {
      const start = Math.round(row.start * 10);
      const end = Math.round(row.end * 10);
      if (start === l) full += 1;
      else pieces.push({ kind: 'start', length: start });
      full += row.full;
      if (end > 0) pieces.push({ kind: 'end', length: end });
    }
  }
  expect(pieces.length, label).toBeLessThanOrEqual(16);
  const plan = minimalBoards(pieces, l, k);
  expect(result.boards, `${label}: доски = минимум по геометрии`).toBe(full + plan.length);

  let saw = 0;
  let rest = 0;
  for (const group of plan) {
    const board = group.map((i) => pieces[i] as Piece);
    expect(fitsOnBoard(board, l, k), label).toBe(true);
    const cut = cutBoard(board, l, k);
    // Баланс каждой доски из позиций кусков.
    expect(cut.usedLength + cut.saw + cut.rest, label).toBe(l);
    saw += cut.saw;
    rest += cut.rest;
  }
  // Остаток длины плана совпадает с суммой опилок и остатков из геометрии.
  expect(Math.round((result.kerfLength + result.offcutLength) * 10), label).toBe(saw + rest);
  expect(
    result.kerfLength * 10,
    `${label}: пропил между частями не больше опилок`,
  ).toBeLessThanOrEqual(saw + 1e-9);
  // Процент: площадь досок плана сверх площади поля = остатки по длине × ширина + полоса последнего ряда.
  const w = result.boardWidth;
  const excess = ((saw + rest) / 10) * w + result.rowLength * (result.rows * w - result.fieldWidth);
  expect(result.wastePercent, label).toBeCloseTo(
    (excess / (result.rowLength * result.fieldWidth)) * 100,
    9,
  );
  return result;
}

describe('геометрический эталон раскроя (§16)', () => {
  it('З1–З13 и пропил 0 / 2,3 / 3 / 3,1 / 5 мм на границе пары (З7а), «от обрезка» (З8), короткий ряд (З10)', () => {
    const cases: [string, Partial<LaminateInput>][] = [
      ['З1', {}],
      ['З2', { kerf: 3 }],
      ['З3', { gap: 10, kerf: 3 }],
      ['З4', { roomWidth: 1.01, gap: 8, kerf: 3 }],
      ['З5', { roomLength: 2.7 }],
      ['З6', { roomLength: 2.7, gap: 8, kerf: 3 }],
      ['З7б', { roomLength: 2.414, gap: 8, kerf: 3 }],
      ['З9', { roomLength: 3.15, scheme: 'offcut', minOffset: 500, gap: 10, kerf: 3 }],
      ['З11', { roomLength: 2.097, scheme: 'offcut', kerf: 4 }],
      ['З12', { roomLength: 2.42, scheme: 'third', gap: 10, kerf: 3 }],
    ];
    for (const kerf of [0, 2.3, 3, 3.1, 5]) {
      cases.push([`З7а k=${kerf}`, { roomLength: 2.413, gap: 8, kerf }]);
      cases.push([`З8 k=${kerf}`, { roomLength: 2, scheme: 'offcut', kerf }]);
      cases.push([`З10 k=${kerf}`, { roomLength: 2, roomWidth: 0.4, direction: 'width', kerf }]);
    }
    for (const [label, overrides] of cases) {
      expect(checkGeometry({ ...base, ...overrides }, label), label).not.toBeNull();
    }
  });

  it('малая сетка: зазор 0 / 8 / 30, пропил 0 / 2,3 / 5, три схемы, m < o и m = o', () => {
    let checked = 0;
    for (const roomLength of [1.31, 2.05, 2.413, 3.15])
      for (const scheme of ['half', 'third', 'offcut'] as const)
        for (const [minPiece, minOffset] of [
          [300, 300],
          [300, 500],
        ] as const)
          for (const gap of [0, 8, 30])
            for (const kerf of [0, 2.3, 5]) {
              const input = {
                ...base,
                roomLength,
                roomWidth: 0.6,
                scheme,
                minPiece,
                minOffset,
                gap,
                kerf,
              };
              if (checkGeometry(input, JSON.stringify(input))) checked += 1;
            }
    expect(checked).toBeGreaterThan(100);
  });
});
