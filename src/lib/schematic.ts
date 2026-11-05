/**
 * Живая схема над формой (DES-1, часть 3; алгоритм и контрольные примеры — docs/SCHEMATIC.md).
 *
 * Чистые функции без DOM: `schematicModel` — геометрия по тексту полей формы (вписывание в рамку, ограничение
 * пропорций с условным разрывом, подписи), `schematicSvg` — разметка SVG по модели. Их использует и компонент
 * Schematic.astro (заготовка без JavaScript), и общий механизм форм (перерисовка при вводе).
 */
import { formatNumber } from './format';
import { metersToMm, parseDecimal } from './number';
import { pluralizeRu } from './plural';

/** Вид схемы; `room-or-walls` — по полю «Считать» (`mode`): помещение или отдельные стены. */
export const schematicKinds = ['room', 'room-or-walls', 'laminate', 'tile'] as const;
export type SchematicKind = (typeof schematicKinds)[number];

/** Проверка значения `data-schematic` из разметки. */
export function isSchematicKind(value: string | undefined): value is SchematicKind {
  return (schematicKinds as readonly (string | undefined)[]).includes(value);
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface Segment {
  from: Point;
  to: Point;
}

export interface Dimension extends Segment {
  text: string;
  /** Точка подписи: под линией (длина) или слева от неё, текст повёрнут (ширина, высота). */
  label: Point;
  vertical: boolean;
}

export interface Plate extends Rect {
  lines: string[];
}

export interface SchematicModel {
  /** Итоговый вид: у `room-or-walls` — `room` или `walls`. */
  view: 'room' | 'walls' | 'laminate' | 'tile';
  /** Не задан ни один из двух основных размеров — заготовка. */
  placeholder: boolean;
  outline: Rect;
  /** Ряды досок или сетка плитки. */
  hatch: Segment[];
  /** Стыки досок в рядах. */
  joints: Segment[];
  /** Условные разрывы на длинных сторонах: зигзаг и белый просвет, прерывающий контур. */
  breaks: { path: Point[]; gap: Rect }[];
  dimensions: Dimension[];
  plate: Plate | null;
  /** Подпись для диктора (`aria-label`). */
  label: string;
}

/** Рамка схемы (`viewBox`) и область для прямоугольника (docs/SCHEMATIC.md, п. 3). */
export const schematicFrame = { width: 300, height: 150 } as const;
const area = { x: 40, y: 8, width: 252, height: 108 } as const;
const maxRatio = 4;
const sampleRatio = 1.6;
const charWidth = 7.2;
const lineHeight = 15;
const minHatchStep = 3;
const minJointStep = 6;
/** Уже не стоит сжимать прямоугольник ради таблички сбоку. */
const minRectWidth = 40;
/** Шаг условной штриховки у заготовки (ряды, сетка), в единицах схемы. */
const sampleStep = { rows: 12, tiles: 16 } as const;

type Values = Readonly<Partial<Record<string, string>>>;

const round = (value: number) => Math.round(value * 10) / 10;

/** Число из поля, если оно в пределах калькулятора; иначе `null` — размер «не задан». */
function readNumber(values: Values, name: string, min: number, max: number): number | null {
  const parsed = parseDecimal(values[name] ?? '');
  if (parsed.kind !== 'number' || parsed.value < min || parsed.value > max) return null;
  return parsed.value;
}

const readMeters = (values: Values, name: string, max = 100) => readNumber(values, name, 0.1, max);

function readCount(values: Values, name: string): number | null {
  const count = readNumber(values, name, 1, 50);
  return count !== null && Number.isInteger(count) ? count : null;
}

/** «4,00 м», «2,755 м»: не меньше двух знаков после запятой, как на чертеже. */
export function formatMeters(value: number): string {
  const text = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value);
  return `${text}\u00a0м`;
}

/** Произведение размеров в метрах, м² — через целые миллиметры, как в калькуляторах. */
function areaM2(first: number, second: number): number {
  return (metersToMm(first) * metersToMm(second)) / 1_000_000;
}

const squareMeters = (value: number) => `${formatNumber(value, 2)}\u00a0м²`;

/** «37,8 квадратного метра», «12 квадратных метров» — для диктора. */
function spokenSquareMeters(value: number): string {
  const text = formatNumber(value, 2);
  if (!Number.isInteger(value)) return `${text} квадратного метра`;
  return `${text} ${pluralizeRu(value, ['квадратный метр', 'квадратных метра', 'квадратных метров'])}`;
}

/** Миллиметры — целые и без разделителя разрядов, как в поле: «1380». */
const millimeters = (value: number) => String(value);

function spokenMillimeters(value: number): string {
  return `${millimeters(value)} ${pluralizeRu(value, ['миллиметр', 'миллиметра', 'миллиметров'])}`;
}

const spokenMeters = (value: number | null) =>
  value === null ? 'не задана' : formatNumber(value, 3);

const dimensionText = (value: number | null, word: string) =>
  value === null ? word : formatMeters(value);

/** Размер прямоугольника с отношением `ratio`, вписанного в полосу шириной `regionWidth` и высотой области. */
function fitInto(ratio: number, regionWidth: number): { width: number; height: number } {
  return ratio >= regionWidth / area.height
    ? { width: regionWidth, height: regionWidth / ratio }
    : { width: area.height * ratio, height: area.height };
}

function plateSize(lines: readonly string[]): { width: number; height: number } {
  return {
    width: round(Math.max(...lines.map((line) => line.length)) * charWidth + 12),
    height: lineHeight * lines.length + 8,
  };
}

/**
 * Раскладка (docs/SCHEMATIC.md, пп. 2–4): прямоугольник с ограниченной пропорцией и табличка примечаний.
 * Табличка — внутри прямоугольника; иначе справа от него (прямоугольник прижат влево, а если места мало —
 * вписан в оставшуюся полосу); иначе поверх по центру. Строки таблички зависят от масштаба (шаг сетки),
 * поэтому `linesFor` вызывается заново, если прямоугольник уменьшился.
 */
function arrange(
  length: number | null,
  width: number | null,
  linesFor: (rect: Rect) => string[],
): { rect: Rect; broken: boolean; plate: Plate | null } {
  const actual = length !== null && width !== null ? length / width : sampleRatio;
  const ratio = Math.min(maxRatio, Math.max(1 / maxRatio, actual));
  const size = fitInto(ratio, area.width);
  const rect: Rect = {
    x: area.x + (area.width - size.width) / 2,
    y: area.y + (area.height - size.height) / 2,
    ...size,
  };
  const broken = ratio !== actual;
  let lines = linesFor(rect);
  if (lines.length === 0) return { rect, broken, plate: null };
  let plate = plateSize(lines);
  const center = () => ({
    x: round(rect.x + rect.width / 2 - plate.width / 2),
    y: round(rect.y + rect.height / 2 - plate.height / 2),
  });
  if (plate.width + 16 <= rect.width && plate.height + 12 <= rect.height)
    return { rect, broken, plate: { ...center(), ...plate, lines } };

  const available = area.width - plate.width - 10;
  if (rect.width > available && available >= minRectWidth) {
    Object.assign(rect, fitInto(ratio, available));
    rect.y = area.y + (area.height - rect.height) / 2;
    lines = linesFor(rect);
    plate = plateSize(lines);
  }
  if (rect.width > available) return { rect, broken, plate: { ...center(), ...plate, lines } };
  rect.x = area.x;
  return {
    rect,
    broken,
    plate: {
      x: round(area.x + rect.width + 10),
      y: round(rect.y + rect.height / 2 - plate.height / 2),
      ...plate,
      lines,
    },
  };
}

function dimensions(rect: Rect, lengthText: string, widthText: string): Dimension[] {
  const bottom = rect.y + rect.height + 12;
  const left = rect.x - 12;
  return [
    {
      from: { x: rect.x, y: bottom },
      to: { x: rect.x + rect.width, y: bottom },
      text: lengthText,
      label: { x: rect.x + rect.width / 2, y: bottom + 14 },
      vertical: false,
    },
    {
      from: { x: left, y: rect.y },
      to: { x: left, y: rect.y + rect.height },
      text: widthText,
      label: { x: left - 8, y: rect.y + rect.height / 2 },
      vertical: true,
    },
  ];
}

/** Зигзаг посередине длинных сторон: при отношении больше 4:1 стороны нарисованы короче настоящих. */
function breakMarks(rect: Rect): SchematicModel['breaks'] {
  if (rect.width >= rect.height) {
    const x = rect.x + rect.width / 2;
    return [rect.y, rect.y + rect.height].map((y) => ({
      path: [
        { x: x - 6, y },
        { x: x - 2, y: y - 5 },
        { x: x + 2, y: y + 5 },
        { x: x + 6, y },
      ],
      gap: { x: x - 6, y: y - 3, width: 12, height: 6 },
    }));
  }
  const y = rect.y + rect.height / 2;
  return [rect.x, rect.x + rect.width].map((x) => ({
    path: [
      { x, y: y - 6 },
      { x: x - 5, y: y - 2 },
      { x: x + 5, y: y + 2 },
      { x, y: y + 6 },
    ],
    gap: { x: x - 3, y: y - 6, width: 6, height: 12 },
  }));
}

/**
 * Линии сетки поперёк оси длиной `lengthMm`: через `pitchMm` от начала, строго внутри. Если шаг на схеме меньше
 * 3 единиц — каждая k-я линия (docs/SCHEMATIC.md, п. 6). Положения — в единицах схемы от начала оси.
 */
export function gridLines(
  lengthMm: number,
  pitchMm: number,
  scale: number,
): { positions: number[]; every: number } {
  const every = pitchMm * scale < minHatchStep ? Math.ceil(minHatchStep / (pitchMm * scale)) : 1;
  const step = pitchMm * every;
  const positions: number[] = [];
  for (let index = 1; index * step < lengthMm; index += 1) positions.push(index * step * scale);
  return { positions, every };
}

/** Отрезок поперёк или вдоль оси `horizontal` внутри прямоугольника, в координатах схемы. */
function segment(rect: Rect, horizontal: boolean, at: number, from: number, to: number): Segment {
  return horizontal
    ? {
        from: { x: round(rect.x + from), y: round(rect.y + at) },
        to: { x: round(rect.x + to), y: round(rect.y + at) },
      }
    : {
        from: { x: round(rect.x + at), y: round(rect.y + from) },
        to: { x: round(rect.x + at), y: round(rect.y + to) },
      };
}

function finalOutline(rect: Rect): Rect {
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function roomModel(values: Values): SchematicModel {
  const length = readMeters(values, 'roomLength');
  const width = readMeters(values, 'roomWidth');
  const height = readMeters(values, 'wallHeight', 10);
  const wallArea =
    length !== null && width !== null && height !== null
      ? (2 * (metersToMm(length) + metersToMm(width)) * metersToMm(height)) / 1_000_000
      : null;
  const lines = [height === null ? 'h — высота стен' : `h = ${formatMeters(height)}`];
  if (wallArea !== null) lines.push(`S стен = ${squareMeters(wallArea)}`);
  const { rect, broken, plate } = arrange(length, width, () => lines);
  const placeholder = length === null && width === null;
  return {
    view: 'room',
    placeholder,
    outline: finalOutline(rect),
    hatch: [],
    joints: [],
    breaks: broken ? breakMarks(rect) : [],
    dimensions: dimensions(rect, dimensionText(length, 'длина'), dimensionText(width, 'ширина')),
    plate,
    label: placeholder
      ? 'Схема помещения: размеры ещё не введены.'
      : `Схема помещения в метрах: длина ${spokenMeters(length)}, ширина ${spokenMeters(width)}, ` +
        `высота стен ${spokenMeters(height)}.` +
        (wallArea === null ? '' : ` Площадь стен ${spokenSquareMeters(wallArea)}.`),
  };
}

function wallsModel(values: Values): SchematicModel {
  const length = readMeters(values, 'wallLength');
  const height = readMeters(values, 'wallHeight', 10);
  const count = readCount(values, 'wallCount') ?? 1;
  const wallArea = length !== null && height !== null ? areaM2(length, height) * count : null;
  const lines: string[] = [];
  if (count > 1) lines.push(`× ${count} ${pluralizeRu(count, ['стена', 'стены', 'стен'])}`);
  if (wallArea !== null) lines.push(`S = ${squareMeters(wallArea)}`);
  const { rect, broken, plate } = arrange(length, height, () => lines);
  const placeholder = length === null && height === null;
  return {
    view: 'walls',
    placeholder,
    outline: finalOutline(rect),
    hatch: [],
    joints: [],
    breaks: broken ? breakMarks(rect) : [],
    dimensions: dimensions(rect, dimensionText(length, 'длина'), dimensionText(height, 'высота')),
    plate,
    label: placeholder
      ? 'Схема стены: размеры ещё не введены.'
      : `Схема стены в метрах: длина ${spokenMeters(length)}, высота ${spokenMeters(height)}, ` +
        `одинаковых стен ${count}.` +
        (wallArea === null ? '' : ` Площадь ${spokenSquareMeters(wallArea)}.`),
  };
}

function laminateModel(values: Values): SchematicModel {
  const length = readMeters(values, 'roomLength');
  const width = readMeters(values, 'roomWidth');
  const boardLength = readNumber(values, 'boardLength', 100, 3000);
  const boardWidth = readNumber(values, 'boardWidth', 50, 600);
  // Доски вдоль длины — ряды горизонтальные (идут по оси x), вдоль ширины — вертикальные.
  const horizontal = values['direction'] !== 'width';
  const shift = values['scheme'] === 'half' ? 1 / 2 : values['scheme'] === 'third' ? 1 / 3 : null;
  const acrossM = horizontal ? width : length;
  const alongM = horizontal ? length : width;
  const known = acrossM !== null && alongM !== null && boardWidth !== null;
  // Ряды: шаг — ширина доски поперёк направления в масштабе своей оси; у заготовки — условный шаг.
  const rowsFor = (rect: Rect) => {
    const acrossPx = horizontal ? rect.height : rect.width;
    return known
      ? gridLines(metersToMm(acrossM), boardWidth, acrossPx / metersToMm(acrossM))
      : gridLines(acrossPx, sampleStep.rows, 1);
  };
  const floorArea = length !== null && width !== null ? areaM2(length, width) : null;
  const linesFor = (rect: Rect) => {
    const lines: string[] = [];
    if (boardLength !== null && boardWidth !== null)
      lines.push(`${millimeters(boardLength)} × ${millimeters(boardWidth)}\u00a0мм`);
    const { every } = rowsFor(rect);
    if (every > 1)
      lines.push(`сетка через ${every} ${pluralizeRu(every, ['ряд', 'ряда', 'рядов'])}`);
    if (floorArea !== null) lines.push(`S = ${squareMeters(floorArea)}`);
    return lines;
  };
  const { rect, broken, plate } = arrange(length, width, linesFor);
  const rows = rowsFor(rect);
  const acrossPx = horizontal ? rect.height : rect.width;
  const alongPx = horizontal ? rect.width : rect.height;

  const hatch = rows.positions.map((at) => segment(rect, horizontal, at, 0, alongPx));
  // Стыки: через длину доски, ряд сдвинут на 1/2 или 1/3 доски; у «от обрезка» положение зависит от раскроя.
  const joints: Segment[] = [];
  if (known && boardLength !== null && shift !== null && rows.every === 1) {
    const alongMm = metersToMm(alongM);
    const scale = alongPx / alongMm;
    if (boardLength * scale >= minJointStep) {
      const edges = [0, ...rows.positions, acrossPx];
      for (let row = 0; row + 1 < edges.length; row += 1) {
        const offset = (row * boardLength * shift) % boardLength;
        for (let at = offset > 0 ? offset : boardLength; at < alongMm; at += boardLength) {
          joints.push(segment(rect, !horizontal, at * scale, edges[row] ?? 0, edges[row + 1] ?? 0));
        }
      }
    }
  }

  const placeholder = length === null && width === null;
  const side = horizontal ? 'длины' : 'ширины';
  const board =
    boardLength !== null && boardWidth !== null
      ? `доски ${millimeters(boardLength)} на ${spokenMillimeters(boardWidth)}`
      : 'размер доски не задан';
  return {
    view: 'laminate',
    placeholder,
    outline: finalOutline(rect),
    hatch,
    joints,
    breaks: broken ? breakMarks(rect) : [],
    dimensions: dimensions(rect, dimensionText(length, 'длина'), dimensionText(width, 'ширина')),
    plate,
    label: placeholder
      ? `Схема укладки ламината: размеры комнаты ещё не введены; ряды вдоль ${side} комнаты.`
      : `Схема укладки ламината в метрах: длина комнаты ${spokenMeters(length)}, ` +
        `ширина ${spokenMeters(width)}; ${board}, ряды вдоль ${side} комнаты.` +
        (floorArea === null ? '' : ` Площадь пола ${spokenSquareMeters(floorArea)}.`),
  };
}

function tileModel(values: Values): SchematicModel {
  const wall = values['surface'] === 'wall';
  const length = readMeters(values, 'surfaceLength');
  const width = readMeters(values, 'surfaceWidth');
  const tileLength = readNumber(values, 'tileLength', 20, 3000);
  const tileWidth = readNumber(values, 'tileWidth', 20, 3000);
  const joint = readNumber(values, 'joint', 0, 20) ?? 0;
  const count = readCount(values, 'surfaceCount') ?? 1;
  // Сетка от левого верхнего угла: шаг — плитка + шов; у заготовки — условный шаг.
  const known = length !== null && width !== null && tileLength !== null && tileWidth !== null;
  const gridFor = (rect: Rect) => {
    const columns = known
      ? gridLines(metersToMm(length), tileLength + joint, rect.width / metersToMm(length))
      : gridLines(rect.width, sampleStep.tiles, 1);
    const tileRows = known
      ? gridLines(metersToMm(width), tileWidth + joint, rect.height / metersToMm(width))
      : gridLines(rect.height, sampleStep.tiles, 1);
    return { columns, tileRows, every: Math.max(columns.every, tileRows.every) };
  };
  const surfaceArea = length !== null && width !== null ? areaM2(length, width) * count : null;
  const linesFor = (rect: Rect) => {
    const lines: string[] = [];
    if (tileLength !== null && tileWidth !== null)
      lines.push(`${millimeters(tileLength)} × ${millimeters(tileWidth)}\u00a0мм`);
    const { every } = gridFor(rect);
    if (every > 1)
      lines.push(`сетка через ${every} ${pluralizeRu(every, ['плитку', 'плитки', 'плиток'])}`);
    if (surfaceArea !== null)
      lines.push(`${count > 1 ? `× ${count}, ` : ''}S = ${squareMeters(surfaceArea)}`);
    return lines;
  };
  const { rect, broken, plate } = arrange(length, width, linesFor);
  const { columns, tileRows } = gridFor(rect);

  const hatch = [
    ...columns.positions.map((at) => segment(rect, false, at, 0, rect.height)),
    ...tileRows.positions.map((at) => segment(rect, true, at, 0, rect.width)),
  ];
  const placeholder = length === null && width === null;
  const what = wall ? 'стены' : 'пола';
  const tile =
    tileLength !== null && tileWidth !== null
      ? `плитка ${millimeters(tileLength)} на ${spokenMillimeters(tileWidth)}, шов ${spokenMillimeters(joint)}`
      : 'размер плитки не задан';
  return {
    view: 'tile',
    placeholder,
    outline: finalOutline(rect),
    hatch,
    joints: [],
    breaks: broken ? breakMarks(rect) : [],
    dimensions: dimensions(
      rect,
      dimensionText(length, 'длина'),
      dimensionText(width, wall ? 'высота' : 'ширина'),
    ),
    plate,
    label: placeholder
      ? `Схема раскладки плитки для ${what}: размеры ещё не введены.`
      : `Схема раскладки плитки для ${what} в метрах: длина ${spokenMeters(length)}, ` +
        `${wall ? 'высота' : 'ширина'} ${spokenMeters(width)}; ${tile}.` +
        (count > 1 ? ` Одинаковых поверхностей ${count}.` : '') +
        (surfaceArea === null ? '' : ` Площадь ${spokenSquareMeters(surfaceArea)}.`),
  };
}

/** Модель схемы по тексту полей формы (`имя поля → значение`). */
export function schematicModel(kind: SchematicKind, values: Values): SchematicModel {
  switch (kind) {
    case 'room':
      return roomModel(values);
    case 'room-or-walls':
      return values['mode'] === 'walls' ? wallsModel(values) : roomModel(values);
    case 'laminate':
      return laminateModel(values);
    case 'tile':
      return tileModel(values);
  }
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (value: number) => String(round(value));

const pathOf = (segments: readonly Segment[]) =>
  segments
    .map(({ from, to }) => `M${num(from.x)} ${num(from.y)}L${num(to.x)} ${num(to.y)}`)
    .join('');

const rectOf = (className: string, { x, y, width, height }: Rect) =>
  `<rect class="${className}" x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"/>`;

/** Засечки на концах размерной линии — поперёк неё. */
function ticks({ from, to, vertical }: Dimension): Segment[] {
  return [from, to].map((point) =>
    vertical
      ? { from: { x: point.x - 4, y: point.y }, to: { x: point.x + 4, y: point.y } }
      : { from: { x: point.x, y: point.y - 4 }, to: { x: point.x, y: point.y + 4 } },
  );
}

/** Содержимое `<svg viewBox="0 0 300 150">` по модели: классы `schematic__*`, цвета — в CSS (токены). */
export function schematicSvg(model: SchematicModel): string {
  const parts = [
    rectOf(
      `schematic__room${model.placeholder ? ' schematic__room--placeholder' : ''}`,
      model.outline,
    ),
  ];
  if (model.hatch.length > 0)
    parts.push(`<path class="schematic__hatch" d="${pathOf(model.hatch)}"/>`);
  if (model.joints.length > 0)
    parts.push(`<path class="schematic__joint" d="${pathOf(model.joints)}"/>`);
  for (const { path, gap } of model.breaks) {
    const points = path.map((point) => `${num(point.x)} ${num(point.y)}`).join('L');
    parts.push(rectOf('schematic__gap', gap), `<path class="schematic__break" d="M${points}"/>`);
  }
  for (const dimension of model.dimensions) {
    const { label } = dimension;
    const rotate = dimension.vertical
      ? ` transform="rotate(-90 ${num(label.x)} ${num(label.y)})"`
      : '';
    parts.push(
      `<path class="schematic__dim" d="${pathOf([dimension, ...ticks(dimension)])}"/>`,
      `<text class="schematic__dim-text" x="${num(label.x)}" y="${num(label.y)}"${rotate} text-anchor="middle">${escapeXml(dimension.text)}</text>`,
    );
  }
  if (model.plate) {
    const { plate } = model;
    parts.push(
      rectOf('schematic__plate', plate),
      ...plate.lines.map(
        (line, index) =>
          `<text class="schematic__note" x="${num(plate.x + plate.width / 2)}" y="${num(plate.y + lineHeight * (index + 1))}" text-anchor="middle">${escapeXml(line)}</text>`,
      ),
    );
  }
  return parts.join('');
}
