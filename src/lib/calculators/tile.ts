/**
 * Количество плитки для пола или стены: прямая укладка «шов в шов» по сетке.
 * Модель, допущения и контрольные примеры — docs/calculators/TILE.md.
 *
 * Внутри — целые единицы: длины в десятых долях мм (шов задаётся с шагом 0,1 мм), запас в десятых процента.
 * Это оценка по сетке, а не раскладка: каждая подрезанная плитка считается целой, обрезки не переносятся.
 */
import { ceilDiv, metersToMm } from '../number';

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
}

export type TileField = keyof TileInput;
export type TileErrors = Partial<Record<TileField, string>>;
export type TileSurface = 'floor' | 'wall';

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
}

export type TileCalculation = { ok: true; result: TileResult } | { ok: false; errors: TileErrors };

interface Range {
  min: number;
  max: number;
}

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
const fmt = (value: number) => String(value).replace('.', ',');

function checkRequired(value: number | null, range: Range, unit: string): string | null {
  if (value === null) return 'Заполните поле.';
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value <= 0) return 'Значение должно быть больше нуля.';
  if (value < range.min) return `Не меньше ${fmt(range.min)} ${unit}.`;
  if (value > range.max) return `Не больше ${fmt(range.max)} ${unit}.`;
  return null;
}

function checkOptional(value: number | null, range: Range, unit: string): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value < 0) return 'Значение не может быть отрицательным.';
  if (value < range.min) return `Не меньше ${fmt(range.min)} ${unit}.`;
  if (value > range.max) return `Не больше ${fmt(range.max)} ${unit}.`;
  return null;
}

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
    },
  };
}
