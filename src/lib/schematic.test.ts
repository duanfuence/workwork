import { describe, expect, it } from 'vitest';
import { formatMeters, gridLines, schematicModel, schematicSvg } from './schematic';

// Контрольные примеры С1–С8 посчитаны вручную в docs/SCHEMATIC.md; тесты сверяют с этими числами.
const nbsp = '\u00a0';

describe('схема помещения', () => {
  it('С1: комната 4 × 3, высота 2,7 — вписывание, размерные линии, табличка, подпись', () => {
    const model = schematicModel('room', { roomLength: '4', roomWidth: '3', wallHeight: '2,7' });
    expect(model.view).toBe('room');
    expect(model.placeholder).toBe(false);
    expect(model.outline).toEqual({ x: 94, y: 8, width: 144, height: 108 });
    expect(model.breaks).toEqual([]);
    const [length, width] = model.dimensions;
    expect(length).toMatchObject({
      from: { x: 94, y: 128 },
      to: { x: 238, y: 128 },
      label: { x: 166, y: 142 },
      text: `4,00${nbsp}м`,
      vertical: false,
    });
    expect(width).toMatchObject({
      from: { x: 82, y: 8 },
      to: { x: 82, y: 116 },
      label: { x: 74, y: 62 },
      text: `3,00${nbsp}м`,
      vertical: true,
    });
    expect(model.plate).toEqual({
      x: 102.4,
      y: 43,
      width: 127.2,
      height: 38,
      lines: [`h = 2,70${nbsp}м`, `S стен = 37,8${nbsp}м²`],
    });
    expect(model.label).toBe(
      'Схема помещения в метрах: длина 4, ширина 3, высота стен 2,7. Площадь стен 37,8 квадратного метра.',
    );
  });

  it('С2: коридор 12 × 1,5 — пропорция ограничена 4:1, разрыв на длинных сторонах, подпись настоящая', () => {
    const model = schematicModel('room', { roomLength: '12', roomWidth: '1,5', wallHeight: '2,5' });
    expect(model.outline).toEqual({ x: 40, y: 30.5, width: 252, height: 63 });
    expect(model.breaks.map(({ path }) => path[0])).toEqual([
      { x: 160, y: 30.5 },
      { x: 160, y: 93.5 },
    ]);
    expect(model.breaks[0]?.gap).toEqual({ x: 160, y: 27.5, width: 12, height: 6 });
    expect(model.dimensions[0]?.text).toBe(`12,00${nbsp}м`);
    expect(model.plate?.lines).toEqual([`h = 2,50${nbsp}м`, `S стен = 67,5${nbsp}м²`]);
  });

  it('С3: узкая комната 1 × 5 — разрыв на коротких сторонах по вертикали, табличка справа', () => {
    const model = schematicModel('room', { roomLength: '1', roomWidth: '5' });
    expect(model.outline).toEqual({ x: 40, y: 8, width: 27, height: 108 });
    expect(model.breaks.map(({ path }) => path[0])).toEqual([
      { x: 40, y: 56 },
      { x: 67, y: 56 },
    ]);
    expect(model.plate).toEqual({
      x: 77,
      y: 50.5,
      width: 120,
      height: 23,
      lines: ['h — высота стен'],
    });
    expect(model.label).toBe('Схема помещения в метрах: длина 1, ширина 5, высота стен не задана.');
  });

  it('С4: пустые поля — заготовка с подписями «длина», «ширина»', () => {
    const model = schematicModel('room', {});
    expect(model.placeholder).toBe(true);
    expect(model.outline).toEqual({ x: 79.6, y: 8, width: 172.8, height: 108 });
    expect(model.dimensions.map(({ text }) => text)).toEqual(['длина', 'ширина']);
    expect(model.plate?.lines).toEqual(['h — высота стен']);
    expect(model.label).toBe('Схема помещения: размеры ещё не введены.');
  });

  it('значения вне пределов калькулятора и не числа — размер не задан', () => {
    const model = schematicModel('room', { roomLength: '200', roomWidth: 'три', wallHeight: '11' });
    expect(model.placeholder).toBe(true);
    expect(model.dimensions.map(({ text }) => text)).toEqual(['длина', 'ширина']);
    // Один размер задан — пропорция условная, подпись настоящая.
    const half = schematicModel('room', { roomLength: '4,5' });
    expect(half.placeholder).toBe(false);
    expect(half.outline.width).toBe(172.8);
    expect(half.dimensions.map(({ text }) => text)).toEqual([`4,50${nbsp}м`, 'ширина']);
  });

  it('«Считать: помещение / отдельные стены» — вид по полю mode', () => {
    expect(schematicModel('room-or-walls', { mode: 'room' }).view).toBe('room');
    expect(schematicModel('room-or-walls', { mode: 'walls' }).view).toBe('walls');
  });
});

describe('схема стены', () => {
  it('С8: две стены 4 × 2,7 — развёртка, «× 2 стены», площадь', () => {
    const model = schematicModel('room-or-walls', {
      mode: 'walls',
      wallLength: '4',
      wallHeight: '2,7',
      wallCount: '2',
    });
    expect(model.outline).toEqual({ x: 86, y: 8, width: 160, height: 108 });
    expect(model.dimensions.map(({ text }) => text)).toEqual([`4,00${nbsp}м`, `2,70${nbsp}м`]);
    expect(model.plate?.lines).toEqual(['× 2 стены', `S = 21,6${nbsp}м²`]);
    expect(model.label).toBe(
      'Схема стены в метрах: длина 4, высота 2,7, одинаковых стен 2. Площадь 21,6 квадратного метра.',
    );
    const empty = schematicModel('room-or-walls', { mode: 'walls', wallCount: '1' });
    expect(empty.placeholder).toBe(true);
    expect(empty.dimensions.map(({ text }) => text)).toEqual(['длина', 'высота']);
    expect(empty.plate).toBeNull();
  });
});

describe('схема ламината', () => {
  const room = {
    roomLength: '4',
    roomWidth: '3',
    boardLength: '1380',
    boardWidth: '193',
    direction: 'length',
    scheme: 'half',
  };

  it('С5: ряды вдоль длины — 15 линий с шагом 6,948, стыки со сдвигом 1/2 доски', () => {
    const model = schematicModel('laminate', room);
    expect(model.outline).toEqual({ x: 94, y: 8, width: 144, height: 108 });
    expect(model.hatch).toHaveLength(15);
    expect(model.hatch[0]).toEqual({ from: { x: 94, y: 14.9 }, to: { x: 238, y: 14.9 } });
    expect(model.hatch[14]).toEqual({ from: { x: 94, y: 112.2 }, to: { x: 238, y: 112.2 } });
    // Ряд 0 — стыки 1380 и 2760 мм (× 0,036 = 49,68 и 99,36); ряд 1 — 690, 2070, 3450 мм.
    const rowJoints = (top: number) =>
      model.joints.filter(({ from }) => from.y === top).map(({ from }) => from.x);
    expect(rowJoints(8)).toEqual([143.7, 193.4]);
    expect(rowJoints(14.9)).toEqual([118.8, 168.5, 218.2]);
    expect(model.joints).toHaveLength(8 * 2 + 8 * 3);
    expect(model.plate?.lines).toEqual([`1380 × 193${nbsp}мм`, `S = 12${nbsp}м²`]);
    expect(model.label).toBe(
      'Схема укладки ламината в метрах: длина комнаты 4, ширина 3; доски 1380 на 193 миллиметра, ' +
        'ряды вдоль длины комнаты. Площадь пола 12 квадратных метров.',
    );
  });

  it('ряды вдоль ширины — вертикальные; «от обрезка» — без стыков; без доски — условные ряды', () => {
    const across = schematicModel('laminate', { ...room, direction: 'width', scheme: 'offcut' });
    expect(across.hatch.every(({ from, to }) => from.x === to.x)).toBe(true);
    // 4000 / 193: линии при 193…3860 мм — 20 линий.
    expect(across.hatch).toHaveLength(20);
    expect(across.joints).toEqual([]);
    expect(across.label).toContain('ряды вдоль ширины комнаты');
    const sample = schematicModel('laminate', { direction: 'length' });
    expect(sample.placeholder).toBe(true);
    // Заготовка: шаг 12 по высоте 108 — линии при 12…96.
    expect(sample.hatch).toHaveLength(8);
    expect(sample.label).toBe(
      'Схема укладки ламината: размеры комнаты ещё не введены; ряды вдоль длины комнаты.',
    );
  });
});

describe('схема плитки', () => {
  const floor = {
    surface: 'floor',
    surfaceLength: '3',
    surfaceWidth: '2,5',
    tileLength: '300',
    tileWidth: '300',
    joint: '2',
    surfaceCount: '1',
  };

  it('С6: пол 3 × 2,5, плитка 300 × 300, шов 2 — 9 вертикальных и 8 горизонтальных линий', () => {
    const model = schematicModel('tile', floor);
    expect(model.outline).toEqual({ x: 101.2, y: 8, width: 129.6, height: 108 });
    const vertical = model.hatch.filter(({ from, to }) => from.x === to.x);
    const horizontal = model.hatch.filter(({ from, to }) => from.y === to.y);
    expect(vertical).toHaveLength(9);
    expect(horizontal).toHaveLength(8);
    expect(vertical[0]?.from.x).toBe(114.2);
    expect(model.plate?.lines).toEqual([`300 × 300${nbsp}мм`, `S = 7,5${nbsp}м²`]);
    expect(model.label).toBe(
      'Схема раскладки плитки для пола в метрах: длина 3, ширина 2,5; плитка 300 на 300 миллиметров, ' +
        'шов 2 миллиметра. Площадь 7,5 квадратного метра.',
    );
  });

  it('С7: мозаика 20 × 20 — табличка сбоку, прямоугольник уже, каждая 5-я линия', () => {
    const model = schematicModel('tile', { ...floor, tileLength: '20', tileWidth: '20' });
    expect(model.outline).toEqual({ x: 40, y: 26.2, width: 86, height: 71.7 });
    expect(model.plate).toEqual({
      x: 136,
      y: 35.5,
      width: 156,
      height: 53,
      lines: [`20 × 20${nbsp}мм`, 'сетка через 5 плиток', `S = 7,5${nbsp}м²`],
    });
    const vertical = model.hatch.filter(({ from, to }) => from.x === to.x);
    expect(vertical).toHaveLength(27);
    expect(model.hatch).toHaveLength(27 + 22);
  });

  it('стена и несколько поверхностей — подписи «высота», «× 2»', () => {
    const model = schematicModel('tile', { ...floor, surface: 'wall', surfaceCount: '2' });
    expect(model.dimensions[1]?.text).toBe(`2,50${nbsp}м`);
    expect(model.plate?.lines.at(-1)).toBe(`× 2, S = 15${nbsp}м²`);
    expect(schematicModel('tile', { surface: 'wall' }).dimensions[1]?.text).toBe('высота');
  });
});

describe('вспомогательные функции', () => {
  it('сетка: линии строго внутри, шаг меньше 3 единиц — каждая k-я', () => {
    expect(gridLines(3000, 302, 0.0432).positions).toHaveLength(9);
    expect(gridLines(3000, 22, 0.0432)).toMatchObject({ every: 4 });
    expect(gridLines(1000, 500, 0.1).positions).toEqual([50]);
  });

  it('метры на чертеже — минимум два знака после запятой', () => {
    expect(formatMeters(4)).toBe(`4,00${nbsp}м`);
    expect(formatMeters(2.755)).toBe(`2,755${nbsp}м`);
  });

  it('разметка SVG: классы для стилей, экранирование, повёрнутая подпись', () => {
    const svg = schematicSvg(
      schematicModel('room', { roomLength: '4', roomWidth: '3', wallHeight: '2,7' }),
    );
    expect(svg).toContain('<rect class="schematic__room" x="94" y="8" width="144" height="108"/>');
    expect(svg).toContain('transform="rotate(-90 74 62)"');
    expect(svg).toContain(`>S стен = 37,8${nbsp}м²</text>`);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    const placeholder = schematicSvg(schematicModel('room', {}));
    expect(placeholder).toContain('schematic__room--placeholder');
  });
});
