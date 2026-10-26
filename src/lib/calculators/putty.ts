/**
 * Расход шпаклёвки на стены по площади, числу слоёв и расходу на один слой.
 * Модель, допущения и контрольные примеры — docs/calculators/PUTTY.md.
 *
 * Внутри — целые единицы: длины в мм, площади в мм², расход в сотых кг/м², запас в десятых процента,
 * упаковка в граммах. На пределах полей произведение превышает 2⁵³, поэтому масса считается в BigInt —
 * без ошибок двоичных дробей (10 · 1,1 = 11, а не 11,000…1).
 */
import { metersToMm } from '../number';

/** Входные данные. `null` — поле не заполнено. Размеры в метрах, площадь проёмов в м², упаковка в кг. */
export interface PuttyInput {
  wallLength: number | null;
  wallHeight: number | null;
  wallCount: number | null;
  openingsArea: number | null;
  layers: number | null;
  consumption: number | null;
  reserve: number | null;
  packMass: number | null;
}

export type PuttyField = keyof PuttyInput;
export type PuttyErrors = Partial<Record<PuttyField, string>>;

export interface PuttyResult {
  /** Площади, м². */
  wallArea: number;
  openingsArea: number;
  puttyArea: number;
  wallCount: number;
  layers: number;
  /** Расход на один слой, кг/м². */
  consumption: number;
  reserve: number;
  /** Масса без запаса и с запасом, кг — округлены вверх до 0,1 кг. */
  mass: number;
  massWithReserve: number;
  /** Упаковки — от точной массы с запасом; `null`, если масса упаковки не указана. */
  packMass: number | null;
  packs: number | null;
  /** Килограммов в купленных упаковках. */
  massToBuy: number | null;
}

export type PuttyCalculation =
  { ok: true; result: PuttyResult } | { ok: false; errors: PuttyErrors };

interface Range {
  min: number;
  max: number;
}

export const puttyLimits = {
  wallLength: { min: 0.1, max: 100 },
  wallHeight: { min: 0.1, max: 10 },
  wallCount: { min: 1, max: 50 },
  openingsArea: { min: 0, max: 50_000 },
  layers: { min: 1, max: 10 },
  consumption: { min: 0.1, max: 5 },
  reserve: { min: 0, max: 50 },
  packMass: { min: 0.5, max: 100 },
} as const satisfies Record<string, Range>;

/** Значения формы по умолчанию. Расхода нет: его берут из инструкции к смеси. */
export const puttyDefaults = { wallCount: 1, layers: 1, reserve: 10 } as const;

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

/** Не больше `digits` знаков после запятой. */
function hasPrecision(value: number, digits: number): boolean {
  const scaled = value * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

const precisionMessage = (digits: number) =>
  digits === 1 ? 'Не больше одного знака после запятой.' : 'Не больше двух знаков после запятой.';

/** Деление с округлением вверх для неотрицательного `a` и положительного `b`. */
function ceilDivBig(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function calculatePutty(input: PuttyInput): PuttyCalculation {
  const errors: PuttyErrors = {};
  const setError = (field: PuttyField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };
  const checkInteger = (field: PuttyField, value: number | null) => {
    if (!errors[field] && !Number.isInteger(value)) setError(field, 'Введите целое число.');
  };
  const checkPrecision = (field: PuttyField, value: number | null, digits: number) => {
    if (!errors[field] && value !== null && !hasPrecision(value, digits)) {
      setError(field, precisionMessage(digits));
    }
  };

  setError('wallLength', checkRequired(input.wallLength, puttyLimits.wallLength, 'м'));
  setError('wallHeight', checkRequired(input.wallHeight, puttyLimits.wallHeight, 'м'));
  setError('wallCount', checkRequired(input.wallCount, puttyLimits.wallCount, 'шт'));
  checkInteger('wallCount', input.wallCount);
  setError('openingsArea', checkOptional(input.openingsArea, puttyLimits.openingsArea, 'м²'));
  // Целое — до диапазона: для 0,5 «Введите целое число.», а не «Не меньше 1 слоёв.».
  if (input.layers !== null && Number.isFinite(input.layers)) checkInteger('layers', input.layers);
  setError('layers', checkRequired(input.layers, puttyLimits.layers, 'слоёв'));
  setError('consumption', checkRequired(input.consumption, puttyLimits.consumption, 'кг/м²'));
  checkPrecision('consumption', input.consumption, 2);
  setError('reserve', checkOptional(input.reserve, puttyLimits.reserve, '%'));
  checkPrecision('reserve', input.reserve, 1);
  setError('packMass', checkOptional(input.packMass, puttyLimits.packMass, 'кг'));
  checkPrecision('packMass', input.packMass, 1);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const L = metersToMm(input.wallLength ?? 0);
  const H = metersToMm(input.wallHeight ?? 0);
  const wallCount = input.wallCount ?? puttyDefaults.wallCount;
  const wallArea = L * H * wallCount;
  const openingsArea = Math.round((input.openingsArea ?? 0) * 1_000_000);
  const toM2 = (mm2: number) => mm2 / 1_000_000;

  if (openingsArea > wallArea) {
    return {
      ok: false,
      errors: { openingsArea: `Больше площади стен (${fmt(toM2(wallArea))} м²).` },
    };
  }
  if (openingsArea === wallArea) {
    return {
      ok: false,
      errors: { openingsArea: 'Проёмы занимают всю площадь стен — шпаклевать нечего.' },
    };
  }
  const puttyArea = wallArea - openingsArea;

  const layers = input.layers ?? puttyDefaults.layers;
  const consumptionHundredths = Math.round((input.consumption ?? 0) * 100);
  const reserveTenths = Math.round((input.reserve ?? 0) * 10);
  // S[мм²]·c₁₀₀·n — масса в единицах 10⁻⁸ кг; с запасом ещё × (1000 + z₁₀) — в единицах 10⁻¹¹ кг.
  const mass = BigInt(puttyArea) * BigInt(consumptionHundredths) * BigInt(layers);
  const withReserve = mass * BigInt(1000 + reserveTenths);
  // 0,1 кг = 10⁷ единиц без запаса и 10¹⁰ единиц с запасом.
  const massKg = Number(ceilDivBig(mass, 10_000_000n)) / 10;
  const massWithReserveKg = Number(ceilDivBig(withReserve, 10_000_000_000n)) / 10;

  const packGrams = input.packMass === null ? null : Math.round(input.packMass * 1000);
  // 1 г = 10⁸ единиц массы с запасом.
  const packs =
    packGrams === null ? null : Number(ceilDivBig(withReserve, BigInt(packGrams) * 100_000_000n));

  return {
    ok: true,
    result: {
      wallArea: toM2(wallArea),
      openingsArea: toM2(openingsArea),
      puttyArea: toM2(puttyArea),
      wallCount,
      layers,
      consumption: consumptionHundredths / 100,
      reserve: reserveTenths / 10,
      mass: massKg,
      massWithReserve: massWithReserveKg,
      packMass: packGrams === null ? null : packGrams / 1000,
      packs,
      massToBuy: packs === null || packGrams === null ? null : (packs * packGrams) / 1000,
    },
  };
}
