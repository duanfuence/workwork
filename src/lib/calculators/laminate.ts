/**
 * Расчёт ламината по рядам для одной прямоугольной комнаты.
 * Модель 1.1 и контракт — docs/calculators/LAMINATE.md (§4, §11), контрольные примеры — §8.
 *
 * Модель 2.0-а (§15): укладывается поле комнаты за вычетом зазора у стен, пропил учитывается там, где
 * из доски получают две части. Ряды строятся по выбранной схеме (§4.3), доски для этих рядов
 * считаются точно: целые + начала + концы − пары (§4.4). Глобальный минимум не ищется.
 *
 * Размеры комнаты, доски, зазор, `m` и `o` — целые миллиметры; ряды и пары считаются в целых десятых
 * долях миллиметра (`T`), потому что пропил задаётся с шагом 0,1 мм. Сетка начал рядов и сдвигов — 1 мм.
 */
import { ceilDiv, metersToMm } from '../number';
import { type Range, checkOptional, checkRequired, fmt } from '../validation';

export type LaminateDirection = 'length' | 'width';
export type LaminateScheme = 'half' | 'third' | 'offcut';

/** Входные данные. `null` — поле не заполнено. Комната в метрах, доска и требования — в миллиметрах. */
export interface LaminateInput {
  roomLength: number | null;
  roomWidth: number | null;
  boardLength: number | null;
  boardWidth: number | null;
  boardsPerPack: number | null;
  direction: string | null;
  scheme: string | null;
  minPiece: number | null;
  minOffset: number | null;
  reserve: number | null;
  packPrice: number | null;
  /** Зазор у каждой стены, мм (целое). `null` — значение по умолчанию. */
  gap: number | null;
  /** Ширина пропила, мм (шаг 0,1). `null` — значение по умолчанию. */
  kerf: number | null;
}

export type LaminateField = keyof LaminateInput;
export type LaminateErrors = Partial<Record<LaminateField, string>>;

/** Ряд: начальный отрезок, целые доски, конечный отрезок (мм). `start = l` — начало целой доской. */
export interface Row {
  start: number;
  full: number;
  end: number;
}

export interface RowType extends Row {
  /** Сколько рядов такого типа. */
  count: number;
  /** Номера рядов (с 1), не больше первых пяти. */
  firstRows: number[];
}

/** Пара «конец ряда + начало ряда» из одной доски (номера рядов с 0). */
export interface Pair {
  start: number;
  end: number;
  startRow: number;
  endRow: number;
}

export interface BoardCount {
  /** Целые доски: целые в рядах и начала длиной в доску. */
  full: number;
  /** Начальные отрезки короче доски. */
  starts: number;
  /** Конечные отрезки. */
  ends: number;
  /** Пары «начало + конец» из одной доски. */
  pairs: Pair[];
  /** Доски: full + starts + ends − pairs. */
  boards: number;
}

export type LaminateLayout =
  | {
      kind: 'rows';
      /** Сдвиг схемы, мм (для 1/2 и 1/3), `null` для «от обрезка». */
      shift: number | null;
      /** Все ряды по порядку (от стены, с которой начата укладка). */
      rows: Row[];
      rowTypes: RowType[];
      count: BoardCount;
    }
  | {
      /** Ряд короче доски: стыков нет, из доски выходит несколько отрезков. */
      kind: 'short';
      piecesPerBoard: number;
    };

export interface LaminateResult {
  direction: LaminateDirection;
  scheme: LaminateScheme;
  /** Размеры доски, мм. */
  boardLength: number;
  boardWidth: number;
  /** Размеры комнаты, как введены (от стены до стены), мм. */
  roomLengthMm: number;
  roomWidthMm: number;
  /** Длина ряда — длина укладываемого поля вдоль рядов `R − 2g`, мм. */
  rowLength: number;
  /** Поперечный размер поля `D − 2g`, мм. */
  fieldWidth: number;
  /** Зазор у каждой стены и ширина пропила, мм. */
  gap: number;
  kerf: number;
  rows: number;
  /** Ширина последнего ряда, мм. */
  lastRowWidth: number;
  /** Последний ряд уже 50 мм — стоит выровнять первый и последний ряд. */
  narrowLastRow: boolean;
  layout: LaminateLayout;
  /** Доски по плану раскладки. */
  boards: number;
  boardsWithReserve: number;
  packs: number;
  boardsToBuy: number;
  /** Площадь покупаемых досок, м². */
  areaToBuy: number;
  /** Площадь комнаты, м². */
  roomArea: number;
  /** Площадь укладываемого поля, м². */
  fieldArea: number;
  /** Площадь упаковки по размерам доски, м². */
  packArea: number;
  /** Справочно: доски по площади, с тем же запасом, и упаковки. */
  areaBoards: number;
  areaBoardsWithReserve: number;
  areaPacks: number;
  /** Нижняя граница модели для этих рядов: ⌈N·R' / l⌉. */
  materialBound: number;
  /**
   * Баланс длины досок плана: `boards·l = rows·rowLength + kerfLength + offcutLength`, мм.
   * `kerfLength` — пропил между двумя использованными частями одной доски (пары, куски короткого ряда);
   * `offcutLength` — остальное: обрезки, остатки короче `m` и рез по отходной стороне.
   */
  kerfLength: number;
  offcutLength: number;
  /** Площадь досок плана сверх площади поля (вместе с полосой последнего ряда), % от площади поля. */
  wastePercent: number;
  reserve: number;
  minPiece: number;
  minOffset: number;
  totalCost: number | null;
}

export type LaminateCalculation =
  { ok: true; result: LaminateResult } | { ok: false; errors: LaminateErrors };

/** Значения по умолчанию — расчётные предположения, а не требования конкретного покрытия (§15.7). */
export const laminateDefaults = { minPiece: 400, minOffset: 400, gap: 8, kerf: 3 } as const;

/** Расчётная единица длины рядов: десятая доля миллиметра. */
const T = 10;

/** Порог «узкого» последнего ряда, мм (зависит от инструкции, §6). */
export const narrowLastRowThreshold = 50;

export const laminateLimits = {
  roomLength: { min: 0.1, max: 100 },
  roomWidth: { min: 0.1, max: 100 },
  boardLength: { min: 100, max: 3000 },
  boardWidth: { min: 50, max: 600 },
  boardsPerPack: { min: 1, max: 200 },
  minPiece: { min: 50, max: 1500 },
  minOffset: { min: 50, max: 1500 },
  reserve: { min: 0, max: 50 },
  packPrice: { min: 0, max: 1_000_000 },
  gap: { min: 0, max: 30 },
  kerf: { min: 0, max: 5 },
} as const satisfies Record<string, Range>;

const directions: readonly LaminateDirection[] = ['length', 'width'];
const schemes: readonly LaminateScheme[] = ['half', 'third', 'offcut'];

export const schemeTitles: Record<LaminateScheme, string> = {
  half: 'Схема 1/2',
  third: 'Схема 1/3',
  offcut: 'Укладка «от обрезка»',
};

const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Круговое расстояние между стыками двух рядов с началами `a` и `b`. */
export function jointOffset(a: number, b: number, l: number): number {
  const d = mod(a - b, l);
  return Math.min(d, l - d);
}

export function buildRow(rowLength: number, start: number, l: number): Row {
  return {
    start,
    full: Math.floor((rowLength - start) / l),
    end: mod(rowLength - start, l),
  };
}

/** Ряд допустим: начало и конец не короче `m` (конец может отсутствовать). */
export function isRowValid(row: Row, m: number): boolean {
  return row.start >= m && (row.end === 0 || row.end >= m);
}

/**
 * Начала рядов строгой схемы без сдвига (§4.3). `step` — сколько единиц длины в миллиметре:
 * половина и треть доски берутся в целых миллиметрах при любой единице.
 */
export function schemeBase(scheme: 'half' | 'third', l: number, step = 1): number[] {
  if (scheme === 'half') return [l, l - Math.floor(l / (2 * step)) * step];
  const t = Math.floor(l / (3 * step)) * step;
  return [l, l - t, l - 2 * t];
}

/** Начала рядов строгой схемы со сдвигом `d`: начало ≤ 0 переносится на `l`. */
export function shiftedStarts(base: readonly number[], d: number, l: number): number[] {
  return base.map((s) => mod(s - d - 1, l) + 1);
}

export function fixedRows(
  rowLength: number,
  rows: number,
  l: number,
  base: readonly number[],
  d: number,
): Row[] {
  const starts = shiftedStarts(base, d, l);
  return Array.from({ length: rows }, (_, i) =>
    buildRow(rowLength, starts[i % starts.length] ?? l, l),
  );
}

export type FixedLayout =
  | { ok: true; shift: number; rows: Row[] }
  | { ok: false; reason: 'offset'; offset: number }
  | { ok: false; reason: 'shift' };

/** Строгая схема 1/2 или 1/3: наименьший допустимый сдвиг среди `0…l − 1` с шагом `step` (§4.3, §11). */
export function findFixedLayout(
  rowLength: number,
  rows: number,
  l: number,
  base: readonly number[],
  m: number,
  o: number,
  step = 1,
): FixedLayout {
  // Смещение соседних рядов от сдвига не зависит; проверяются только существующие пары рядов.
  let minOffset = Infinity;
  for (let i = 0; i + 1 < rows; i += 1) {
    const a = base[i % base.length] ?? l;
    const b = base[(i + 1) % base.length] ?? l;
    minOffset = Math.min(minOffset, jointOffset(a, b, l));
  }
  if (minOffset < o) return { ok: false, reason: 'offset', offset: minOffset };

  const presentTypes = Math.min(rows, base.length);
  for (let d = 0; d < l; d += step) {
    const starts = shiftedStarts(base, d, l).slice(0, presentTypes);
    if (starts.every((s) => isRowValid(buildRow(rowLength, s, l), m))) {
      return { ok: true, shift: d, rows: fixedRows(rowLength, rows, l, base, d) };
    }
  }
  return { ok: false, reason: 'shift' };
}

/** Отказ «от обрезка»: нет ни одного допустимого начала (`piece`) или двух со смещением `≥ o` (`pair`). */
export type OffcutLayout = { ok: true; rows: Row[] } | { ok: false; reason: 'piece' | 'pair' };

/**
 * Начало первого ряда «от обрезка» (§4.3): наибольшее допустимое начало, к которому есть второе
 * допустимое начало со смещением `≥ o` (при одном ряде — просто наибольшее допустимое).
 * Без такой пары не собрать и двух соседних рядов, поэтому отказ здесь точен.
 */
function firstOffcutStart(
  rowLength: number,
  rows: number,
  l: number,
  m: number,
  o: number,
  step: number,
): number | 'piece' | 'pair' {
  // Начала на сетке `step` по остатку mod l: узел i — начало i·step (узел 0 — начало l).
  // При целых R', l, m, o допустимые начала — отрезки с концами на сетке, поэтому пара на сетке
  // есть тогда же, когда есть вообще (§15.10). Счётчик допустимых — на удвоенном круге.
  const size = l / step;
  const valid = Array.from({ length: size }, (_, i) =>
    isRowValid(buildRow(rowLength, i === 0 ? l : i * step, l), m),
  );
  const prefix = [0];
  for (let i = 0; i < 2 * size; i += 1) prefix.push((prefix[i] ?? 0) + (valid[i % size] ? 1 : 0));
  // Смещение с началом в узле i не меньше o — узлы i + o/step … i + (l − o)/step.
  const [near, far] = [o / step, (l - o) / step];
  const hasPair = (i: number) =>
    near <= far && (prefix[i + far + 1] ?? 0) - (prefix[i + near] ?? 0) > 0;

  let anyValid = false;
  for (let start = l; start >= m; start -= step) {
    const i = (start % l) / step;
    if (!valid[i]) continue;
    anyValid = true;
    if (rows === 1 || hasPair(i)) return start;
  }
  return anyValid ? 'pair' : 'piece';
}

/**
 * «От обрезка»: первый ряд — `firstOffcutStart`, далее естественный обрезок предыдущего ряда
 * `l − e − kerf` (если он есть), иначе первое подходящее из `l…m` с шагом `step` (§4.3, §15).
 * После первого ряда раскладка не обрывается: подходит начало ряда i − 2 или соседнее с ним на сетке (§15.10).
 * `rowLength`, `l`, `m`, `o` — кратны `step` (целые миллиметры в выбранной единице), `kerf` — в той же единице.
 */
export function buildOffcutLayout(
  rowLength: number,
  rows: number,
  l: number,
  m: number,
  o: number,
  kerf = 0,
  step = 1,
): OffcutLayout {
  const first = firstOffcutStart(rowLength, rows, l, m, o, step);
  if (typeof first !== 'number') return { ok: false, reason: first };
  const result: Row[] = [buildRow(rowLength, first, l)];
  for (let i = 1; i < rows; i += 1) {
    const prev: Row | undefined = result[i - 1];
    const fits = (start: number): Row | null => {
      const row = buildRow(rowLength, start, l);
      if (!isRowValid(row, m)) return null;
      if (prev && jointOffset(start, prev.start, l) < o) return null;
      return row;
    };
    const natural = prev && prev.end > 0 ? l - prev.end - kerf : 0;
    let row: Row | null = natural > 0 ? fits(natural) : null;
    for (let start = l; row === null && start >= m; start -= step) row = fits(start);
    // Не достигается (см. выше); оставлено, чтобы ошибка правила не стала молчаливым числом.
    if (row === null) return { ok: false, reason: 'pair' };
    result.push(row);
  }
  return { ok: true, rows: result };
}

/**
 * Доски для выбранных рядов: целые + начала + концы − пары (§4.4).
 * Пара — конец и начало из одной доски с пропилом между ними: `s + e + kerf ≤ l` (§15.3).
 * Пары ищутся за один проход: наименьшее свободное начало с наибольшим свободным концом.
 */
export function countBoards(rows: readonly Row[], l: number, kerf = 0): BoardCount {
  let full = 0;
  const starts: { length: number; row: number }[] = [];
  const ends: { length: number; row: number }[] = [];
  rows.forEach((row, index) => {
    if (row.start === l) full += 1;
    else starts.push({ length: row.start, row: index });
    full += row.full;
    if (row.end > 0) ends.push({ length: row.end, row: index });
  });
  starts.sort((a, b) => a.length - b.length || a.row - b.row);
  ends.sort((a, b) => a.length - b.length || a.row - b.row);

  const pairs: Pair[] = [];
  let i = 0;
  let j = ends.length - 1;
  while (i < starts.length && j >= 0) {
    const start = starts[i];
    const end = ends[j];
    if (!start || !end) break;
    if (start.length + end.length + kerf <= l) {
      pairs.push({ start: start.length, end: end.length, startRow: start.row, endRow: end.row });
      i += 1;
    }
    j -= 1;
  }
  return {
    full,
    starts: starts.length,
    ends: ends.length,
    pairs,
    boards: full + starts.length + ends.length - pairs.length,
  };
}

/** Типы рядов в порядке первого появления. */
export function groupRows(rows: readonly Row[]): RowType[] {
  const types: RowType[] = [];
  rows.forEach((row, index) => {
    const type = types.find(
      (t) => t.start === row.start && t.full === row.full && t.end === row.end,
    );
    if (type) {
      type.count += 1;
      if (type.firstRows.length < 5) type.firstRows.push(index + 1);
    } else {
      types.push({ ...row, count: 1, firstRows: [index + 1] });
    }
  });
  return types;
}

function checkChoice<T extends string>(value: string | null, options: readonly T[]): T | null {
  return options.find((option) => option === value) ?? null;
}

function infeasibleMessage(
  scheme: LaminateScheme,
  layout: FixedLayout | OffcutLayout,
  m: number,
  o: number,
): string {
  const hint = 'Выберите другую схему или направление либо проверьте требования производителя.';
  if ('reason' in layout && layout.reason === 'offset') {
    return `${schemeTitles[scheme]} даёт смещение стыков ${fmt(layout.offset / T)} мм — меньше минимального ${o} мм. ${hint}`;
  }
  if ('reason' in layout && layout.reason === 'shift') {
    return `${schemeTitles[scheme]} невыполнима для этих размеров: при любом сдвиге в ряду остаётся отрезок короче ${m} мм. ${hint}`;
  }
  if ('reason' in layout && layout.reason === 'piece') {
    return `${schemeTitles[scheme]} невыполнима для этих размеров: при любом начале в ряду остаётся отрезок короче ${m} мм. ${hint}`;
  }
  return `${schemeTitles[scheme]} невыполнима для этих размеров: нет двух начал ряда, при которых отрезки не короче ${m} мм, а стыки соседних рядов смещены не меньше чем на ${o} мм. ${hint}`;
}

export function calculateLaminate(input: LaminateInput): LaminateCalculation {
  const errors: LaminateErrors = {};
  const setError = (field: LaminateField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };

  setError('roomLength', checkRequired(input.roomLength, laminateLimits.roomLength, 'м'));
  setError('roomWidth', checkRequired(input.roomWidth, laminateLimits.roomWidth, 'м'));
  setError('boardLength', checkRequired(input.boardLength, laminateLimits.boardLength, 'мм'));
  setError('boardWidth', checkRequired(input.boardWidth, laminateLimits.boardWidth, 'мм'));
  setError('boardsPerPack', checkRequired(input.boardsPerPack, laminateLimits.boardsPerPack, 'шт'));
  if (!errors.boardsPerPack && !Number.isInteger(input.boardsPerPack)) {
    setError('boardsPerPack', 'Введите целое число.');
  }
  setError('minPiece', checkOptional(input.minPiece, laminateLimits.minPiece, 'мм'));
  setError('minOffset', checkOptional(input.minOffset, laminateLimits.minOffset, 'мм'));
  setError('reserve', checkOptional(input.reserve, laminateLimits.reserve, '%'));
  if (!errors.reserve && input.reserve !== null) {
    const tenths = input.reserve * 10;
    if (Math.abs(tenths - Math.round(tenths)) > 1e-6) {
      setError('reserve', 'Не больше одного знака после запятой.');
    }
  }
  setError('packPrice', checkOptional(input.packPrice, laminateLimits.packPrice, '₽'));
  setError('gap', checkOptional(input.gap, laminateLimits.gap, 'мм'));
  if (!errors.gap && input.gap !== null && !Number.isInteger(input.gap)) {
    setError('gap', 'Введите целое число миллиметров.');
  }
  setError('kerf', checkOptional(input.kerf, laminateLimits.kerf, 'мм'));
  if (!errors.kerf && input.kerf !== null) {
    const tenths = input.kerf * 10;
    if (Math.abs(tenths - Math.round(tenths)) > 1e-6) {
      setError('kerf', 'Не больше одного знака после запятой.');
    }
  }

  const direction = checkChoice(input.direction, directions);
  if (!direction) setError('direction', 'Выберите направление.');
  const scheme = checkChoice(input.scheme, schemes);
  if (!scheme) setError('scheme', 'Выберите схему.');

  const l = errors.boardLength ? null : Math.round(input.boardLength ?? 0);
  const m = Math.round(input.minPiece ?? laminateDefaults.minPiece);
  const o = Math.round(input.minOffset ?? laminateDefaults.minOffset);
  if (!errors.minPiece && l !== null && m > l) {
    setError('minPiece', `Не больше длины доски (${l} мм).`);
  }

  if (Object.keys(errors).length > 0 || l === null || !direction || !scheme) {
    return { ok: false, errors };
  }

  const L = metersToMm(input.roomLength ?? 0);
  const W = metersToMm(input.roomWidth ?? 0);
  const w = Math.round(input.boardWidth ?? 0);
  const n = input.boardsPerPack ?? 1;
  const reserveTenths = Math.round((input.reserve ?? 0) * 10);
  const g = input.gap ?? laminateDefaults.gap;
  const k = Math.round((input.kerf ?? laminateDefaults.kerf) * T);

  // Укладываемое поле: комната за вычетом зазора у обеих стен (§15.2).
  const rowLength = (direction === 'length' ? L : W) - 2 * g;
  const fieldWidth = (direction === 'length' ? W : L) - 2 * g;
  if (rowLength <= 0 || fieldWidth <= 0) {
    return { ok: false, errors: { gap: 'Зазор не оставляет места для покрытия — уменьшите его.' } };
  }
  const rows = ceilDiv(fieldWidth, w);
  const lastRowWidth = fieldWidth - (rows - 1) * w;

  let layout: LaminateLayout;
  let boards: number;
  // Пропил между двумя использованными частями одной доски, в десятых мм.
  let kerfTenths: number;
  if (rowLength <= l) {
    // Ряд короче доски: стыков нет, схема и минимальные значения не применяются (§4.4);
    // q кусков с пропилом между ними: q·R' + (q − 1)·k ≤ l (§15.3).
    const piecesPerBoard = Math.floor((l * T + k) / (rowLength * T + k));
    layout = { kind: 'short', piecesPerBoard };
    boards = ceilDiv(rows, piecesPerBoard);
    kerfTenths = (rows - boards) * k;
  } else {
    let planRows: Row[];
    let shift: number | null = null;
    const [R, lt, mt, ot] = [rowLength * T, l * T, m * T, o * T];
    if (scheme === 'offcut') {
      const plan = buildOffcutLayout(R, rows, lt, mt, ot, k, T);
      if (!plan.ok) return { ok: false, errors: { scheme: infeasibleMessage(scheme, plan, m, o) } };
      planRows = plan.rows;
    } else {
      const plan = findFixedLayout(R, rows, lt, schemeBase(scheme, lt, T), mt, ot, T);
      if (!plan.ok) return { ok: false, errors: { scheme: infeasibleMessage(scheme, plan, m, o) } };
      planRows = plan.rows;
      shift = plan.shift / T;
    }
    const count = countBoards(planRows, lt, k);
    kerfTenths = count.pairs.length * k;
    const toMm = <X extends Row>(row: X): X => ({ ...row, start: row.start / T, end: row.end / T });
    layout = {
      kind: 'rows',
      shift,
      rows: planRows.map(toMm),
      rowTypes: groupRows(planRows).map(toMm),
      count: {
        ...count,
        pairs: count.pairs.map((p) => ({ ...p, start: p.start / T, end: p.end / T })),
      },
    };
    boards = count.boards;
  }

  const withReserve = (value: number) => ceilDiv(value * (1000 + reserveTenths), 1000);
  const boardsWithReserve = withReserve(boards);
  const packs = ceilDiv(boardsWithReserve, n);
  const boardArea = l * w;
  const roomAreaMm2 = L * W;
  const fieldAreaMm2 = rowLength * fieldWidth;
  const areaBoards = ceilDiv(roomAreaMm2, boardArea);
  const areaBoardsWithReserve = withReserve(areaBoards);
  const priceKopecks = input.packPrice === null ? null : Math.round(input.packPrice * 100);

  return {
    ok: true,
    result: {
      direction,
      scheme,
      boardLength: l,
      boardWidth: w,
      roomLengthMm: L,
      roomWidthMm: W,
      rowLength,
      fieldWidth,
      gap: g,
      kerf: k / T,
      rows,
      lastRowWidth,
      narrowLastRow: lastRowWidth < narrowLastRowThreshold,
      layout,
      boards,
      boardsWithReserve,
      packs,
      boardsToBuy: packs * n,
      areaToBuy: (packs * n * boardArea) / 1_000_000,
      roomArea: roomAreaMm2 / 1_000_000,
      fieldArea: fieldAreaMm2 / 1_000_000,
      packArea: (n * boardArea) / 1_000_000,
      areaBoards,
      areaBoardsWithReserve,
      areaPacks: ceilDiv(areaBoardsWithReserve, n),
      materialBound: ceilDiv(rows * rowLength, l),
      kerfLength: kerfTenths / T,
      offcutLength: (boards * l * T - rows * rowLength * T - kerfTenths) / T,
      wastePercent: ((boards * boardArea - fieldAreaMm2) / fieldAreaMm2) * 100,
      reserve: reserveTenths / 10,
      minPiece: m,
      minOffset: o,
      totalCost: priceKopecks === null ? null : (priceKopecks * packs) / 100,
    },
  };
}
