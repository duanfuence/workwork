/**
 * Расчёт количества рулонов обоев по полосам.
 * Алгоритм, допущения и контрольные примеры — docs/calculators/WALLPAPER.md.
 *
 * Все размеры внутри переводятся в целые миллиметры, чтобы округление вверх
 * не ошибалось из-за двоичных дробей (10.6 / 0.53 = 20.000000000000004).
 */
import { ceilDiv, ceilToMultiple, centimetersToMm, metersToMm } from '../number';

/** Входные данные. `null` — поле не заполнено. Размеры в метрах, раппорт и подрезка в сантиметрах. */
export interface WallpaperInput {
  roomLength: number | null;
  roomWidth: number | null;
  wallHeight: number | null;
  rollWidth: number | null;
  rollLength: number | null;
  windowCount: number | null;
  windowWidth: number | null;
  windowHeight: number | null;
  doorCount: number | null;
  doorWidth: number | null;
  doorHeight: number | null;
  patternRepeat: number | null;
  trimAllowance: number | null;
  rollPrice: number | null;
}

export type WallpaperField = keyof WallpaperInput;

export type WallpaperErrors = Partial<Record<WallpaperField, string>>;

export interface WallpaperResult {
  /** Периметр комнаты, м. */
  perimeter: number;
  /** Площадь стен без вычета проёмов, м². */
  wallArea: number;
  /** Площадь окон и дверей, м². */
  openingsArea: number;
  /** Площадь под оклейку (стены минус проёмы), м². */
  netArea: number;
  /** Полос по периметру без учёта проёмов. */
  stripsAroundPerimeter: number;
  /** Полос, которые не нужны на полную высоту благодаря проёмам. */
  stripsSavedByOpenings: number;
  /** Полос на полную высоту. */
  fullStrips: number;
  /** Расчётная длина полосы с подрезкой и раппортом, м. */
  stripLength: number;
  /** Сколько полос получается из одного рулона. */
  stripsPerRoll: number;
  /** Рулонов на полные полосы. */
  rollsForFullStrips: number;
  /** Короткие куски над и под проёмами. */
  shortPieces: number;
  /** Суммарная длина коротких кусков, м. */
  shortPiecesLength: number;
  /** Дополнительные рулоны для кусков, не поместившихся в остатки. */
  extraRollsForShortPieces: number;
  /** Итого рулонов. */
  rolls: number;
  /** Использованный раппорт, см (0 — без подгонки рисунка). */
  patternRepeat: number;
  /** Использованный запас на подрезку, см. */
  trimAllowance: number;
  /** Стоимость, ₽, или `null`, если цена не указана. */
  totalCost: number | null;
}

export type WallpaperCalculation =
  { ok: true; result: WallpaperResult } | { ok: false; errors: WallpaperErrors };

interface Range {
  min: number;
  max: number;
}

/** Допустимые значения. Единицы — как во входных данных. */
export const wallpaperLimits = {
  roomLength: { min: 0.1, max: 100 },
  roomWidth: { min: 0.1, max: 100 },
  wallHeight: { min: 0.5, max: 10 },
  rollWidth: { min: 0.1, max: 3 },
  rollLength: { min: 0.5, max: 100 },
  openingSize: { min: 0.1, max: 100 },
  openingCount: { min: 0, max: 50 },
  patternRepeat: { min: 0, max: 200 },
  trimAllowance: { min: 0, max: 100 },
  rollPrice: { min: 0, max: 1_000_000 },
} as const satisfies Record<string, Range>;

const fmt = (value: number) => String(value).replace('.', ',');

/** Проверка обязательного положительного размера. Возвращает текст ошибки или `null`. */
function checkRequired(value: number | null, range: Range, unit: string): string | null {
  if (value === null) return 'Заполните поле.';
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value <= 0) return 'Значение должно быть больше нуля.';
  if (value < range.min) return `Не меньше ${fmt(range.min)} ${unit}.`;
  if (value > range.max) return `Не больше ${fmt(range.max)} ${unit}.`;
  return null;
}

/** Проверка необязательного неотрицательного значения (`null` допустим). */
function checkOptional(value: number | null, range: Range, unit: string): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value < 0) return 'Значение не может быть отрицательным.';
  if (value > range.max) return `Не больше ${fmt(range.max)} ${unit}.`;
  return null;
}

function checkCount(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value < 0) return 'Значение не может быть отрицательным.';
  if (!Number.isInteger(value)) return 'Введите целое число.';
  if (value > wallpaperLimits.openingCount.max) {
    return `Не больше ${wallpaperLimits.openingCount.max}.`;
  }
  return null;
}

interface OpeningMm {
  count: number;
  width: number;
  height: number;
  /** Сколько раз подрезка входит в короткий кусок: 1 для двери (над ней), 2 для окна (над и под). */
  trims: number;
}

/**
 * Раскладывает короткие куски по остаткам рулонов способом «первый подходящий»
 * (от длинных к коротким). Возвращает число дополнительных рулонов.
 */
function packShortPieces(pieces: number[], remnants: number[], rollLength: number): number {
  const bins = [...remnants];
  let extraRolls = 0;
  for (const piece of [...pieces].sort((a, b) => b - a)) {
    const index = bins.findIndex((free) => free >= piece);
    if (index >= 0) {
      bins[index] = (bins[index] ?? 0) - piece;
    } else {
      bins.push(rollLength - piece);
      extraRolls += 1;
    }
  }
  return extraRolls;
}

export function calculateWallpaper(input: WallpaperInput): WallpaperCalculation {
  const errors: WallpaperErrors = {};
  const setError = (field: WallpaperField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };

  setError('roomLength', checkRequired(input.roomLength, wallpaperLimits.roomLength, 'м'));
  setError('roomWidth', checkRequired(input.roomWidth, wallpaperLimits.roomWidth, 'м'));
  setError('wallHeight', checkRequired(input.wallHeight, wallpaperLimits.wallHeight, 'м'));
  setError('rollWidth', checkRequired(input.rollWidth, wallpaperLimits.rollWidth, 'м'));
  setError('rollLength', checkRequired(input.rollLength, wallpaperLimits.rollLength, 'м'));
  setError(
    'patternRepeat',
    checkOptional(input.patternRepeat, wallpaperLimits.patternRepeat, 'см'),
  );
  setError(
    'trimAllowance',
    checkOptional(input.trimAllowance, wallpaperLimits.trimAllowance, 'см'),
  );
  setError('rollPrice', checkOptional(input.rollPrice, wallpaperLimits.rollPrice, '₽'));
  setError('windowCount', checkCount(input.windowCount));
  setError('doorCount', checkCount(input.doorCount));

  const windowCount = errors.windowCount ? 0 : (input.windowCount ?? 0);
  const doorCount = errors.doorCount ? 0 : (input.doorCount ?? 0);

  // Размеры проёмов проверяются, только если проёмы есть.
  if (windowCount > 0) {
    setError('windowWidth', checkRequired(input.windowWidth, wallpaperLimits.openingSize, 'м'));
    setError('windowHeight', checkRequired(input.windowHeight, wallpaperLimits.openingSize, 'м'));
  }
  if (doorCount > 0) {
    setError('doorWidth', checkRequired(input.doorWidth, wallpaperLimits.openingSize, 'м'));
    setError('doorHeight', checkRequired(input.doorHeight, wallpaperLimits.openingSize, 'м'));
  }

  // Проверки, зависящие от нескольких полей, — только когда сами поля корректны.
  const roomOk = !errors.roomLength && !errors.roomWidth;
  const longestWall = roomOk ? Math.max(input.roomLength ?? 0, input.roomWidth ?? 0) : null;
  const heightOk = !errors.wallHeight;

  const checkOpeningFit = (
    count: number,
    widthField: 'windowWidth' | 'doorWidth',
    heightField: 'windowHeight' | 'doorHeight',
    noun: string,
  ) => {
    if (count === 0) return;
    const width = input[widthField];
    const height = input[heightField];
    if (!errors[widthField] && width !== null && longestWall !== null) {
      if (metersToMm(width) > metersToMm(longestWall)) {
        setError(widthField, `${noun} шире самой длинной стены (${fmt(longestWall)} м).`);
      }
    }
    if (!errors[heightField] && height !== null && heightOk && input.wallHeight !== null) {
      if (metersToMm(height) > metersToMm(input.wallHeight)) {
        setError(heightField, `${noun} выше стены (${fmt(input.wallHeight)} м).`);
      }
    }
  };
  checkOpeningFit(windowCount, 'windowWidth', 'windowHeight', 'Окно');
  checkOpeningFit(doorCount, 'doorWidth', 'doorHeight', 'Дверь');

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // После проверок обязательные значения заполнены и конечны.
  const L = metersToMm(input.roomLength ?? 0);
  const W = metersToMm(input.roomWidth ?? 0);
  const H = metersToMm(input.wallHeight ?? 0);
  const rollWidth = metersToMm(input.rollWidth ?? 0);
  const rollLength = metersToMm(input.rollLength ?? 0);
  const repeat = centimetersToMm(input.patternRepeat ?? 0);
  const trim = centimetersToMm(input.trimAllowance ?? 0);

  const openings: OpeningMm[] = [];
  if (windowCount > 0) {
    openings.push({
      count: windowCount,
      width: metersToMm(input.windowWidth ?? 0),
      height: metersToMm(input.windowHeight ?? 0),
      trims: 2,
    });
  }
  if (doorCount > 0) {
    openings.push({
      count: doorCount,
      width: metersToMm(input.doorWidth ?? 0),
      height: metersToMm(input.doorHeight ?? 0),
      trims: 1,
    });
  }

  const perimeter = 2 * (L + W);
  const openingsWidth = openings.reduce((sum, o) => sum + o.count * o.width, 0);
  if (openingsWidth > perimeter) {
    const field: WallpaperField = windowCount > 0 ? 'windowCount' : 'doorCount';
    return {
      ok: false,
      errors: {
        [field]: `Окна и двери вместе шире периметра комнаты (${fmt(perimeter / 1000)} м).`,
      },
    };
  }

  const withRepeat = (length: number) => (repeat > 0 ? ceilToMultiple(length, repeat) : length);
  const stripLength = withRepeat(H + trim);
  const stripsPerRoll = Math.floor(rollLength / stripLength);
  if (stripsPerRoll === 0) {
    return {
      ok: false,
      errors: {
        rollLength: `Полоса (${fmt(stripLength / 1000)} м с подрезкой${
          repeat > 0 ? ' и раппортом' : ''
        }) длиннее рулона.`,
      },
    };
  }

  const stripsAroundPerimeter = ceilDiv(perimeter, rollWidth);
  let stripsSaved = 0;
  const pieces: number[] = [];
  for (const opening of openings) {
    // Гарантированно целиком внутри проёма — при любом положении проёма относительно стыков.
    const savedPerOpening = Math.max(0, Math.floor(opening.width / rollWidth) - 1);
    const saved = savedPerOpening * opening.count;
    stripsSaved += saved;
    const rest = H - opening.height;
    if (rest > 0) {
      const piece = Math.min(withRepeat(rest + opening.trims * trim), stripLength);
      for (let i = 0; i < saved; i += 1) pieces.push(piece);
    }
  }
  // Сумма ширин проёмов не больше периметра, поэтому полос не может стать отрицательно много.
  const fullStrips = Math.max(0, stripsAroundPerimeter - stripsSaved);

  const fullRolls = Math.floor(fullStrips / stripsPerRoll);
  const stripsInLastRoll = fullStrips % stripsPerRoll;
  const rollsForFullStrips = fullRolls + (stripsInLastRoll > 0 ? 1 : 0);
  const remnants: number[] = Array.from(
    { length: fullRolls },
    () => rollLength - stripsPerRoll * stripLength,
  );
  if (stripsInLastRoll > 0) remnants.push(rollLength - stripsInLastRoll * stripLength);

  const extraRolls = packShortPieces(pieces, remnants, rollLength);
  const rolls = rollsForFullStrips + extraRolls;

  const wallAreaMm2 = perimeter * H;
  const openingsAreaMm2 = openings.reduce((sum, o) => sum + o.count * o.width * o.height, 0);
  const priceKopecks = input.rollPrice === null ? null : Math.round(input.rollPrice * 100);

  return {
    ok: true,
    result: {
      perimeter: perimeter / 1000,
      wallArea: wallAreaMm2 / 1_000_000,
      openingsArea: openingsAreaMm2 / 1_000_000,
      netArea: (wallAreaMm2 - openingsAreaMm2) / 1_000_000,
      stripsAroundPerimeter,
      stripsSavedByOpenings: stripsSaved,
      fullStrips,
      stripLength: stripLength / 1000,
      stripsPerRoll,
      rollsForFullStrips,
      shortPieces: pieces.length,
      shortPiecesLength: pieces.reduce((sum, p) => sum + p, 0) / 1000,
      extraRollsForShortPieces: extraRolls,
      rolls,
      patternRepeat: repeat / 10,
      trimAllowance: trim / 10,
      totalCost: priceKopecks === null ? null : (priceKopecks * rolls) / 100,
    },
  };
}
