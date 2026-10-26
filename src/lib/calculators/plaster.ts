/**
 * Расход штукатурки на стены по площади и средней толщине слоя.
 * Модель, допущения и контрольные примеры — docs/calculators/PLASTER.md.
 *
 * Внутри — целые единицы: длины в мм, площади в мм², толщина в десятых мм, расход в сотых кг/(м²·мм),
 * запас в десятых процента, мешок в граммах. Произведение площади, толщины и расхода может превысить 2⁵³,
 * поэтому масса считается в BigInt — без ошибок двоичных дробей (50 · 1,1 = 55, а не 55,000…1).
 */
import { metersToMm } from '../number';
import { type Range, checkOptional, checkRequired, fmt, hasPrecision } from '../validation';

/** Входные данные. `null` — поле не заполнено. Размеры в метрах, площадь проёмов в м², мешок в кг. */
export interface PlasterInput {
  wallLength: number | null;
  wallHeight: number | null;
  wallCount: number | null;
  openingsArea: number | null;
  thickness: number | null;
  consumption: number | null;
  reserve: number | null;
  bagMass: number | null;
}

export type PlasterField = keyof PlasterInput;
export type PlasterErrors = Partial<Record<PlasterField, string>>;

export interface PlasterResult {
  /** Площади, м². */
  wallArea: number;
  openingsArea: number;
  plasterArea: number;
  wallCount: number;
  /** Средняя толщина слоя, мм. */
  thickness: number;
  /** Расход, кг на 1 м² при слое 1 мм. */
  consumption: number;
  reserve: number;
  /** Масса без запаса и с запасом, кг — округлены вверх до 0,1 кг. */
  mass: number;
  massWithReserve: number;
  /** Мешки — от точной массы с запасом; `null`, если масса мешка не указана. */
  bagMass: number | null;
  bags: number | null;
  /** Килограммов в купленных мешках. */
  massToBuy: number | null;
}

export type PlasterCalculation =
  { ok: true; result: PlasterResult } | { ok: false; errors: PlasterErrors };

export const plasterLimits = {
  wallLength: { min: 0.1, max: 100 },
  wallHeight: { min: 0.1, max: 10 },
  wallCount: { min: 1, max: 50 },
  openingsArea: { min: 0, max: 50_000 },
  thickness: { min: 1, max: 100 },
  consumption: { min: 0.1, max: 5 },
  reserve: { min: 0, max: 50 },
  bagMass: { min: 1, max: 100 },
} as const satisfies Record<string, Range>;

/** Значения формы по умолчанию. Толщина — только пример: её задают по замерам стены. */
export const plasterDefaults = { wallCount: 1, thickness: 10, reserve: 10 } as const;

const precisionMessage = (digits: number) =>
  digits === 1 ? 'Не больше одного знака после запятой.' : 'Не больше двух знаков после запятой.';

/** Деление с округлением вверх для неотрицательного `a` и положительного `b`. */
function ceilDivBig(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function calculatePlaster(input: PlasterInput): PlasterCalculation {
  const errors: PlasterErrors = {};
  const setError = (field: PlasterField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };
  const checkPrecision = (field: PlasterField, value: number | null, digits: number) => {
    if (!errors[field] && value !== null && !hasPrecision(value, digits)) {
      setError(field, precisionMessage(digits));
    }
  };

  setError('wallLength', checkRequired(input.wallLength, plasterLimits.wallLength, 'м'));
  setError('wallHeight', checkRequired(input.wallHeight, plasterLimits.wallHeight, 'м'));
  setError('wallCount', checkRequired(input.wallCount, plasterLimits.wallCount, 'шт'));
  if (!errors.wallCount && !Number.isInteger(input.wallCount)) {
    setError('wallCount', 'Введите целое число.');
  }
  setError('openingsArea', checkOptional(input.openingsArea, plasterLimits.openingsArea, 'м²'));
  setError('thickness', checkRequired(input.thickness, plasterLimits.thickness, 'мм'));
  checkPrecision('thickness', input.thickness, 1);
  setError(
    'consumption',
    checkRequired(input.consumption, plasterLimits.consumption, 'кг/(м²·мм)'),
  );
  checkPrecision('consumption', input.consumption, 2);
  setError('reserve', checkOptional(input.reserve, plasterLimits.reserve, '%'));
  checkPrecision('reserve', input.reserve, 1);
  setError('bagMass', checkOptional(input.bagMass, plasterLimits.bagMass, 'кг'));
  checkPrecision('bagMass', input.bagMass, 1);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const L = metersToMm(input.wallLength ?? 0);
  const H = metersToMm(input.wallHeight ?? 0);
  const wallCount = input.wallCount ?? plasterDefaults.wallCount;
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
      errors: { openingsArea: 'Проёмы занимают всю площадь стен — штукатурить нечего.' },
    };
  }
  const plasterArea = wallArea - openingsArea;

  const thicknessTenths = Math.round((input.thickness ?? 0) * 10);
  const consumptionHundredths = Math.round((input.consumption ?? 0) * 100);
  const reserveTenths = Math.round((input.reserve ?? 0) * 10);
  // S[мм²]·t₁₀·c₁₀₀ — масса в единицах 10⁻⁹ кг; с запасом ещё × (1000 + z₁₀) — в единицах 10⁻¹² кг.
  const mass = BigInt(plasterArea) * BigInt(thicknessTenths) * BigInt(consumptionHundredths);
  const withReserve = mass * BigInt(1000 + reserveTenths);
  // 0,1 кг = 10⁸ единиц без запаса и 10¹¹ единиц с запасом.
  const massKg = Number(ceilDivBig(mass, 100_000_000n)) / 10;
  const massWithReserveKg = Number(ceilDivBig(withReserve, 100_000_000_000n)) / 10;

  const bagGrams = input.bagMass === null ? null : Math.round(input.bagMass * 1000);
  // 1 г = 10⁹ единиц массы с запасом.
  const bags =
    bagGrams === null ? null : Number(ceilDivBig(withReserve, BigInt(bagGrams) * 1_000_000_000n));

  return {
    ok: true,
    result: {
      wallArea: toM2(wallArea),
      openingsArea: toM2(openingsArea),
      plasterArea: toM2(plasterArea),
      wallCount,
      thickness: thicknessTenths / 10,
      consumption: consumptionHundredths / 100,
      reserve: reserveTenths / 10,
      mass: massKg,
      massWithReserve: massWithReserveKg,
      bagMass: bagGrams === null ? null : bagGrams / 1000,
      bags,
      massToBuy: bags === null || bagGrams === null ? null : (bags * bagGrams) / 1000,
    },
  };
}
