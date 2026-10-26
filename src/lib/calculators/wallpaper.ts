/**
 * Расчёт количества рулонов обоев по полосам.
 * Алгоритм, допущения и контрольные примеры — docs/calculators/WALLPAPER.md.
 *
 * Все размеры внутри переводятся в целые миллиметры, чтобы округление вверх
 * не ошибалось из-за двоичных дробей (10.6 / 0.53 = 20.000000000000004).
 */
import { ceilDiv, ceilToMultiple, centimetersToMm, metersToMm } from '../number';
import { type Range, checkOptional, checkRequired, fmt } from '../validation';

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
  /** Полос по стенам без учёта проёмов: каждая стена считается от угла отдельно. */
  stripsForWalls: number;
  /** Полос, которые не нужны на полную высоту благодаря проёмам. */
  stripsSavedByOpenings: number;
  /** Полос на полную высоту. */
  fullStrips: number;
  /** Расчётная длина полосы с подрезкой и раппортом (шаг расхода рулона на полосу), м. */
  stripLength: number;
  /** Запас на совмещение рисунка в начале каждого рулона, м (0 без раппорта). */
  rollStartAllowance: number;
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

  // Длина полосы на стене с подрезкой; при раппорте расход на полосу — шаг, кратный раппорту.
  const base = H + trim;
  const stripLength = repeat > 0 ? ceilToMultiple(base, repeat) : base;
  // Фаза рисунка в начале рулона неизвестна: на совмещение может уйти до одного раппорта.
  const rollStart = repeat;
  // k полос из рулона: подгонка + (k − 1) шагов + последняя полоса без хвоста до следующей фазы.
  const stripsPerRoll =
    base + rollStart <= rollLength
      ? Math.floor((rollLength - rollStart - base) / stripLength) + 1
      : 0;
  if (stripsPerRoll === 0) {
    return {
      ok: false,
      errors: {
        rollLength:
          repeat > 0
            ? `Полоса (${fmt(base / 1000)} м с подрезкой) вместе с подгонкой рисунка (до ${fmt(
                repeat / 1000,
              )} м) длиннее рулона.`
            : `Полоса (${fmt(base / 1000)} м с подрезкой) длиннее рулона.`,
      },
    };
  }

  // Каждая стена обклеивается от угла; обрезок угловой полосы на соседнюю стену не переносится.
  const stripsForWalls = 2 * ceilDiv(L, rollWidth) + 2 * ceilDiv(W, rollWidth);

  let stripsSaved = 0;
  const pieces: number[] = [];
  for (const opening of openings) {
    const rest = H - opening.height;
    let piece = 0;
    if (rest > 0) {
      const raw = rest + opening.trims * trim;
      if (repeat === 0) piece = raw;
      // Кусок над дверью начинается с той же фазы, что и полосы: достаточно округлить до раппорта.
      else if (opening.trims === 1) piece = ceilToMultiple(raw, repeat);
      // У окна фаза нижнего куска зависит от высоты подоконника (не вводится): до раппорта на подгонку.
      else piece = ceilToMultiple(raw, repeat) + repeat;
    }
    // Если куски над и под проёмом не короче полной полосы, экономии нет — колонка остаётся полосой.
    if (piece >= stripLength) continue;
    // Гарантированно целиком внутри проёма — при любом положении проёма относительно стыков.
    const saved = Math.max(0, Math.floor(opening.width / rollWidth) - 1) * opening.count;
    stripsSaved += saved;
    if (piece > 0) for (let i = 0; i < saved; i += 1) pieces.push(piece);
  }

  /** Рулоны на `strips` полных полос; остатки рулонов — уже совмещённые с фазой рисунка. */
  const planFullStrips = (strips: number) => {
    const fullRolls = Math.floor(strips / stripsPerRoll);
    const inLastRoll = strips % stripsPerRoll;
    const remnants = Array.from({ length: fullRolls }, () =>
      Math.max(0, rollLength - rollStart - stripsPerRoll * stripLength),
    );
    if (inLastRoll > 0)
      remnants.push(Math.max(0, rollLength - rollStart - inLastRoll * stripLength));
    return { rolls: fullRolls + (inLastRoll > 0 ? 1 : 0), remnants };
  };

  // Σ⌊a/w⌋ ≤ ⌊P/w⌋ ≤ полос по стенам, поэтому разность неотрицательна; max — защита на будущее.
  const fullStripsWithOpenings = Math.max(0, stripsForWalls - stripsSaved);
  // План с учётом проёмов: меньше полных полос, короткие куски — из остатков или новых рулонов.
  const withOpenings = planFullStrips(fullStripsWithOpenings);
  const extraRolls = packShortPieces(pieces, withOpenings.remnants, rollLength - rollStart);
  // План без экономии на проёмах всегда выполним; берём меньший из двух гарантированных.
  const withoutOpenings = planFullStrips(stripsForWalls);
  const useOpenings = withOpenings.rolls + extraRolls <= withoutOpenings.rolls;

  const fullStrips = useOpenings ? fullStripsWithOpenings : stripsForWalls;
  const usedPieces = useOpenings ? pieces : [];
  const rollsForFullStrips = useOpenings ? withOpenings.rolls : withoutOpenings.rolls;
  const extraRollsForShortPieces = useOpenings ? extraRolls : 0;
  const rolls = rollsForFullStrips + extraRollsForShortPieces;

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
      stripsForWalls,
      stripsSavedByOpenings: useOpenings ? stripsSaved : 0,
      fullStrips,
      stripLength: stripLength / 1000,
      rollStartAllowance: rollStart / 1000,
      stripsPerRoll,
      rollsForFullStrips,
      shortPieces: usedPieces.length,
      shortPiecesLength: usedPieces.reduce((sum, p) => sum + p, 0) / 1000,
      extraRollsForShortPieces,
      rolls,
      patternRepeat: repeat / 10,
      trimAllowance: trim / 10,
      totalCost: priceKopecks === null ? null : (priceKopecks * rolls) / 100,
    },
  };
}
