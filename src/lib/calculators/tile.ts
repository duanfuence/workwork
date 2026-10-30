/**
 * Количество плитки для пола или стены: прямая укладка «шов в шов» по сетке.
 * Модель, допущения и контрольные примеры — docs/calculators/TILE.md.
 *
 * Внутри — целые единицы: длины в десятых долях мм (шов задаётся с шагом 0,1 мм), запас в десятых процента.
 * Это оценка по сетке, а не раскладка: каждая подрезанная плитка считается целой, обрезки не переносятся.
 */
import { areaCost, checkPrice, kopecksToRubles, packCost, toKopecks } from '../cost';
import { ceilDiv, metersToMm } from '../number';
import { type Range, checkOptional, checkRequired } from '../validation';

/** Входные данные. `null` — поле не заполнено. Поверхность в метрах, плитка и шов в миллиметрах. */
export interface TileInput {
  surface: string | null;
  surfaceLength: number | null;
  surfaceWidth: number | null;
  surfaceCount: number | null;
  tileLength: number | null;
  tileWidth: number | null;
  joint: number | null;
  reserve: number | null;
  tilesPerPack: number | null;
  /** Цена, ₽ (D-033): за м² (по умолчанию, как на ценниках) или за упаковку. */
  tilePrice: number | null;
  tilePriceUnit: string | null;
}

export type TileField = keyof TileInput;
export type TileErrors = Partial<Record<TileField, string>>;
export type TileSurface = 'floor' | 'wall';
export type TilePriceUnit = 'm2' | 'pack';

export interface TileResult {
  surface: TileSurface;
  surfaceCount: number;
  /** Площадь облицовки всех поверхностей, м². */
  area: number;
  /** Плиток в ряду вдоль длины и рядов вдоль ширины (высоты) одной поверхности. */
  alongLength: number;
  alongWidth: number;
  /** Плиток по сетке на все поверхности, без запаса. */
  tiles: number;
  reserve: number;
  tilesWithReserve: number;
  tilesPerPack: number | null;
  packs: number | null;
  tilesToBuy: number | null;
  /** Справочно: площадь ÷ площадь плитки без швов и подрезки. */
  areaTiles: number;
  joint: number;
  /** Цена и её единица; стоимость — по купленному (D-033), `null` — цены нет или её не посчитать. */
  tilePrice: number | null;
  tilePriceUnit: TilePriceUnit;
  /** Купленная площадь, м² (для цены за м²): упаковки · p · a · b, без упаковок — плитки с запасом · a · b. */
  boughtArea: number;
  totalCost: number | null;
  /** Цена за упаковку указана, а числа плиток в упаковке нет — стоимость не посчитать (подсказка). */
  costNeedsPack: boolean;
}

export type TileCalculation = { ok: true; result: TileResult } | { ok: false; errors: TileErrors };

export const tileLimits = {
  surfaceLength: { min: 0.1, max: 100 },
  surfaceWidth: { min: 0.1, max: 100 },
  surfaceCount: { min: 1, max: 50 },
  tileLength: { min: 20, max: 3000 },
  tileWidth: { min: 20, max: 3000 },
  joint: { min: 0, max: 20 },
  reserve: { min: 0, max: 50 },
  tilesPerPack: { min: 1, max: 1000 },
} as const satisfies Record<string, Range>;

const surfaces: readonly TileSurface[] = ['floor', 'wall'];
const priceUnits: readonly TilePriceUnit[] = ['m2', 'pack'];
function hasOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) <= 1e-6;
}

export function calculateTile(input: TileInput): TileCalculation {
  const errors: TileErrors = {};
  const setError = (field: TileField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };
  const integer = (field: TileField, value: number | null) => {
    if (!errors[field] && value !== null && !Number.isInteger(value)) {
      setError(field, 'Введите целое число.');
    }
  };

  const surface = surfaces.find((item) => item === input.surface) ?? null;
  if (!surface) setError('surface', 'Выберите тип поверхности.');
  setError('surfaceLength', checkRequired(input.surfaceLength, tileLimits.surfaceLength, 'м'));
  setError('surfaceWidth', checkRequired(input.surfaceWidth, tileLimits.surfaceWidth, 'м'));
  setError('surfaceCount', checkRequired(input.surfaceCount, tileLimits.surfaceCount, 'шт'));
  integer('surfaceCount', input.surfaceCount);
  setError('tileLength', checkRequired(input.tileLength, tileLimits.tileLength, 'мм'));
  integer('tileLength', input.tileLength);
  setError('tileWidth', checkRequired(input.tileWidth, tileLimits.tileWidth, 'мм'));
  integer('tileWidth', input.tileWidth);
  setError('joint', checkOptional(input.joint, tileLimits.joint, 'мм'));
  if (!errors.joint && input.joint !== null && !hasOneDecimal(input.joint)) {
    setError('joint', 'Не больше одного знака после запятой.');
  }
  setError('reserve', checkOptional(input.reserve, tileLimits.reserve, '%'));
  if (!errors.reserve && input.reserve !== null && !hasOneDecimal(input.reserve)) {
    setError('reserve', 'Не больше одного знака после запятой.');
  }
  setError('tilesPerPack', checkOptional(input.tilesPerPack, tileLimits.tilesPerPack, 'шт'));
  integer('tilesPerPack', input.tilesPerPack);
  setError('tilePrice', checkPrice(input.tilePrice));
  const priceUnit = priceUnits.find((item) => item === input.tilePriceUnit) ?? null;
  if (input.tilePrice !== null && !priceUnit)
    setError('tilePriceUnit', 'Выберите, за что указана цена.');

  if (Object.keys(errors).length > 0 || !surface) return { ok: false, errors };

  // Десятые доли миллиметра.
  const X = metersToMm(input.surfaceLength ?? 0) * 10;
  const Y = metersToMm(input.surfaceWidth ?? 0) * 10;
  const a = (input.tileLength ?? 0) * 10;
  const b = (input.tileWidth ?? 0) * 10;
  const j = Math.round((input.joint ?? 0) * 10);
  const count = input.surfaceCount ?? 1;
  const reserveTenths = Math.round((input.reserve ?? 0) * 10);

  // n плиток и n − 1 швов покрывают n·a + (n − 1)·j ≥ X  ⇒  n = ⌈(X + j) / (a + j)⌉.
  const alongLength = ceilDiv(X + j, a + j);
  const alongWidth = ceilDiv(Y + j, b + j);
  const tiles = count * alongLength * alongWidth;
  const tilesWithReserve = ceilDiv(tiles * (1000 + reserveTenths), 1000);
  const perPack = input.tilesPerPack;
  const packs = perPack === null ? null : ceilDiv(tilesWithReserve, perPack);

  // Площадь в мм² (из десятых мм — деление на 100); справочный счёт по площади без швов.
  const areaMm2 = (count * X * Y) / 100;
  const tileAreaMm2 = (a * b) / 100;

  // Стоимость — по купленному (D-033). Площадь плитки — номинальная a × b, без шва: так её считает магазин.
  const tilesBought = packs === null || perPack === null ? tilesWithReserve : packs * perPack;
  const boughtAreaMm2 = tilesBought * tileAreaMm2;
  const unit = priceUnit ?? 'm2';
  const priceKopecks = input.tilePrice === null ? null : toKopecks(input.tilePrice);
  const cost =
    priceKopecks === null
      ? null
      : unit === 'm2'
        ? areaCost(boughtAreaMm2, priceKopecks)
        : packs === null
          ? null
          : packCost(packs, priceKopecks);
  if (cost && !cost.ok) return { ok: false, errors: { tilePrice: cost.error } };

  return {
    ok: true,
    result: {
      surface,
      surfaceCount: count,
      area: areaMm2 / 1_000_000,
      alongLength,
      alongWidth,
      tiles,
      reserve: reserveTenths / 10,
      tilesWithReserve,
      tilesPerPack: perPack,
      packs,
      tilesToBuy: packs === null || perPack === null ? null : packs * perPack,
      areaTiles: ceilDiv(areaMm2, tileAreaMm2),
      joint: j / 10,
      tilePrice: input.tilePrice,
      tilePriceUnit: unit,
      boughtArea: boughtAreaMm2 / 1_000_000,
      totalCost: cost ? kopecksToRubles(cost.kopecks) : null,
      costNeedsPack: input.tilePrice !== null && unit === 'pack' && packs === null,
    },
  };
}
