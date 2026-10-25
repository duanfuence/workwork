/**
 * Аудит калькулятора обоев (этап 2.1). Тесты воспроизводят найденные недостатки модели
 * и проверяют формулы независимым перебором, не используя код калькулятора для ожиданий.
 * Подробности — docs/calculators/WALLPAPER.md, раздел «Аудит».
 */
import { describe, expect, it } from 'vitest';
import { calculateWallpaper, type WallpaperInput, type WallpaperResult } from './wallpaper';

const room: WallpaperInput = {
  roomLength: 2.65,
  roomWidth: 2.12,
  wallHeight: 2.5,
  rollWidth: 0.53,
  rollLength: 10.05,
  windowCount: null,
  windowWidth: null,
  windowHeight: null,
  doorCount: null,
  doorWidth: null,
  doorHeight: null,
  patternRepeat: null,
  trimAllowance: 10,
  rollPrice: null,
};

function calc(overrides: Partial<WallpaperInput>): WallpaperResult {
  const calculation = calculateWallpaper({ ...room, ...overrides });
  if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
  return calculation.result;
}

describe('находка 1: подгонка рисунка в начале каждого рулона', () => {
  it('полоса 2,5 м, раппорт 50 см: гарантированно 3 полосы из рулона 10,05 м, а не 4', () => {
    // 4 × 2,5 = 10 м помещаются, только если рулон начинается точно с нужной фазы рисунка.
    // В худшем случае на совмещение уходит почти целый раппорт: 0,5 + 3 × 2,5 + 2,5 = 10,5 > 10,05.
    expect(calc({ wallHeight: 2.4, patternRepeat: 50 }).stripsPerRoll).toBe(3);
  });

  it('раппорт 25 см: 0,25 + 3 × 2,5 + 2,5 = 10,25 > 10,05 → тоже 3 полосы', () => {
    expect(calc({ wallHeight: 2.4, patternRepeat: 25 }).stripsPerRoll).toBe(3);
  });
});

describe('находка 2: кусок под окном при раппорте', () => {
  it('окно 1,6 × 1,2 м, раппорт 64 см: на колонку над и под окном нужно 2,56 м, а не 1,92 м', () => {
    // Высота подоконника неизвестна, поэтому фаза рисунка нижнего куска произвольна:
    // до (2,5 − 1,2) + 2 × 0,1 = 1,5 м добавляется до одного раппорта на совмещение,
    // итог округляется до кратного раппорту: ⌈1,5 / 0,64⌉ + 1 = 4 раппорта = 2,56 м.
    const result = calc({ patternRepeat: 64, windowCount: 1, windowWidth: 1.6, windowHeight: 1.2 });
    expect(result.shortPieces).toBe(2);
    expect(result.shortPiecesLength).toBe(5.12);
  });
});

describe('находка 3: полосы считаются по стенам, а не по периметру', () => {
  it('комната 4 × 3 м: по стенам 2·⌈4/0,53⌉ + 2·⌈3/0,53⌉ = 2·8 + 2·6 = 28 полос, а не ⌈14/0,53⌉ = 27', () => {
    const result = calc({ roomLength: 4, roomWidth: 3 });
    expect(result.stripsForWalls).toBe(28);
    expect(result.rolls).toBe(10);
  });
});

describe('свойство: проёмы никогда не увеличивают расход', () => {
  const heights = [2.5, 2.7];
  const repeats = [null, 32, 64];
  const windows = [
    [1, 1.6, 1.4],
    [2, 1.2, 1.5],
    [1, 2.4, 0.3],
  ] as const;

  it.each(heights.flatMap((h) => repeats.map((r) => [h, r] as const)))(
    'высота %d, раппорт %s',
    (wallHeight, patternRepeat) => {
      const without = calc({ wallHeight, patternRepeat }).rolls;
      for (const [windowCount, windowWidth, windowHeight] of windows) {
        const withOpenings = calc({
          wallHeight,
          patternRepeat,
          windowCount,
          windowWidth,
          windowHeight,
          trimAllowance: 10,
        }).rolls;
        expect(
          withOpenings,
          `окна ${windowCount} × ${windowWidth} × ${windowHeight}`,
        ).toBeLessThanOrEqual(without);
      }
      // Окно почти во всю высоту при большой подрезке: кусок не короче полной полосы.
      const tall = calc({
        wallHeight,
        patternRepeat,
        trimAllowance: 100,
        windowCount: 1,
        windowWidth: 1.6,
        windowHeight: 0.1,
      }).rolls;
      expect(tall).toBeLessThanOrEqual(
        calc({ wallHeight, patternRepeat, trimAllowance: 100 }).rolls,
      );
    },
  );
});

/*
 * Проверка свойств независимыми симуляторами. Симуляторы работают в миллиметрах и не используют
 * формулы калькулятора: они раскладывают полосы и подгоняют фазу рисунка пошагово.
 */

/** Сколько полос гарантированно выходит из рулона при худшей фазе рисунка в его начале. */
function simulateWorstStripsPerRoll(rollLength: number, base: number, repeat: number): number {
  if (repeat === 0) {
    let count = 0;
    while ((count + 1) * base <= rollLength) count += 1;
    return count;
  }
  let worst = Infinity;
  for (let phase = 0; phase < repeat; phase += 1) {
    let position = (repeat - phase) % repeat;
    let count = 0;
    while (position + base <= rollLength) {
      count += 1;
      position += base;
      position += (repeat - ((position + phase) % repeat)) % repeat;
    }
    worst = Math.min(worst, count);
  }
  return worst;
}

/** Сколько полос шириной w гарантированно целиком внутри проёма шириной a при любом его положении. */
function simulateGuaranteedInside(a: number, w: number): number {
  let min = Infinity;
  for (let x = 0; x < w; x += 1) {
    min = Math.min(min, Math.max(0, Math.floor((x + a) / w) - Math.ceil(x / w)));
  }
  return min;
}

/** Полосы на стену, наклеенные от угла: добавляем по одной, пока не закроем стену. */
function simulateStripsForWall(wall: number, w: number): number {
  let covered = 0;
  let count = 0;
  while (covered < wall) {
    covered += w;
    count += 1;
  }
  return count;
}

/** Худшее потребление рулона на куски над и под окном (по всем высотам подоконника). */
function simulateWindowColumn(H: number, h: number, t: number, repeat: number): number {
  let worst = 0;
  for (let a = 0; a <= H - h; a += 5) {
    let start = a + t;
    const phase = (a + h) % repeat;
    start += (phase - (start % repeat) + repeat) % repeat;
    const end = start + (H - a - h) + t;
    worst = Math.max(worst, Math.ceil(end / repeat) * repeat);
  }
  return worst;
}

describe('свойства против независимых симуляторов', () => {
  it('полос из рулона = худший случай по фазе рисунка (раппорты 0–150 см, высоты 2,0–3,2 м)', () => {
    for (const rollLength of [5, 10.05, 15]) {
      for (let height = 2.0; height <= 3.2; height = Math.round((height + 0.07) * 100) / 100) {
        for (const repeat of [0, 10, 25, 32, 53, 64, 100, 150]) {
          const result = calc({ wallHeight: height, patternRepeat: repeat, rollLength });
          const base = Math.round(height * 1000) + 100;
          expect(result.stripsPerRoll, `H=${height} r=${repeat} R=${rollLength}`).toBe(
            simulateWorstStripsPerRoll(Math.round(rollLength * 1000), base, repeat * 10),
          );
        }
      }
    }
  });

  it('полосы по стенам совпадают с раскладкой от угла', () => {
    for (let length = 1.0; length <= 6; length = Math.round((length + 0.013) * 1000) / 1000) {
      for (const rollWidth of [0.53, 0.7, 1.06]) {
        const result = calc({ roomLength: length, roomWidth: 2.12, rollWidth });
        const expected =
          2 * simulateStripsForWall(Math.round(length * 1000), Math.round(rollWidth * 1000)) +
          2 * simulateStripsForWall(2120, Math.round(rollWidth * 1000));
        expect(result.stripsForWalls, `L=${length} w=${rollWidth}`).toBe(expected);
      }
    }
  });

  it('экономия на проёме не больше гарантированной при любом положении проёма', () => {
    for (const rollWidth of [530, 700, 1060]) {
      for (let a = 200; a <= 2600; a += 37) {
        const result = calc({
          roomLength: 6,
          roomWidth: 4,
          rollWidth: rollWidth / 1000,
          doorCount: 1,
          doorWidth: a / 1000,
          doorHeight: 2.5, // во всю высоту — кусков нет, видна только экономия
        });
        expect(result.stripsSavedByOpenings, `a=${a} w=${rollWidth}`).toBeLessThanOrEqual(
          simulateGuaranteedInside(a, rollWidth),
        );
      }
    }
  });

  it('кусок под окном при раппорте не короче худшего реального потребления', () => {
    for (const H of [2.5, 2.7, 3]) {
      for (const h of [0.9, 1.2, 1.4, 1.8]) {
        for (const repeat of [10, 32, 53, 64]) {
          const result = calc({
            roomLength: 6,
            roomWidth: 4,
            wallHeight: H,
            patternRepeat: repeat,
            windowCount: 1,
            windowWidth: 1.6,
            windowHeight: h,
          });
          if (result.shortPieces === 0) continue; // экономии нет — колонка остаётся полной полосой
          const piece = Math.round((result.shortPiecesLength / result.shortPieces) * 1000);
          const worst = simulateWindowColumn(
            Math.round(H * 1000),
            Math.round(h * 1000),
            100,
            repeat * 10,
          );
          expect(piece, `H=${H} h=${h} r=${repeat}`).toBeGreaterThanOrEqual(worst);
        }
      }
    }
  });

  it('расход не убывает с ростом высоты и длины комнаты и не растёт с длиной рулона', () => {
    for (const repeat of [null, 32, 64]) {
      let previous = 0;
      for (let height = 2.0; height <= 3.5; height = Math.round((height + 0.011) * 1000) / 1000) {
        const rolls = calc({ wallHeight: height, patternRepeat: repeat }).rolls;
        expect(rolls, `H=${height} r=${repeat}`).toBeGreaterThanOrEqual(previous);
        previous = rolls;
      }
      previous = 0;
      for (let length = 1; length <= 8; length = Math.round((length + 0.017) * 1000) / 1000) {
        const rolls = calc({ roomLength: length, patternRepeat: repeat }).rolls;
        expect(rolls, `L=${length} r=${repeat}`).toBeGreaterThanOrEqual(previous);
        previous = rolls;
      }
      previous = Infinity;
      for (
        let rollLength = 3.5;
        rollLength <= 15;
        rollLength = Math.round((rollLength + 0.05) * 100) / 100
      ) {
        const rolls = calc({ rollLength, patternRepeat: repeat }).rolls;
        expect(rolls, `R=${rollLength} r=${repeat}`).toBeLessThanOrEqual(previous);
        previous = rolls;
      }
    }
  });
});
