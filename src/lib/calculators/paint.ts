/**
 * Расход краски на стены и потолок прямоугольного помещения.
 * Модель, допущения и контрольные примеры — docs/calculators/PAINT.md.
 *
 * Внутри — целые единицы: длины в мм, площади в мм², укрывистость в десятых м²/л, запас в десятых
 * процента, банка в мл. Округления — целочисленные, без ошибок двоичных дробей (2,0 · 1,05 = 2,1, а не 2,1000…1).
 */
import { checkPrice, kopecksToRubles, packCost, toKopecks } from '../cost';
import { ceilDiv, metersToMm } from '../number';
import { type Range, checkOptional, checkRequired, fmt, hasPrecision } from '../validation';

/** Входные данные. `null` — поле не заполнено. Размеры в метрах, площадь проёмов в м², банка в литрах. */
export interface PaintInput {
  roomLength: number | null;
  roomWidth: number | null;
  wallHeight: number | null;
  openingsArea: number | null;
  ceiling: string | null;
  coats: number | null;
  coverage: number | null;
  reserve: number | null;
  canVolume: number | null;
  /** Цена одной банки, ₽ (D-033); без объёма банки стоимость не считается. */
  canPrice: number | null;
}

export type PaintField = keyof PaintInput;
export type PaintErrors = Partial<Record<PaintField, string>>;

export interface PaintResult {
  /** Периметр, м. */
  perimeter: number;
  /** Площади, м². */
  wallArea: number;
  openingsArea: number;
  /** Площадь потолка, если он красится, иначе 0. */
  ceilingArea: number;
  paintArea: number;
  ceilingIncluded: boolean;
  coats: number;
  /** Укрывистость, м²/л за один слой. */
  coverage: number;
  reserve: number;
  /** Расход без запаса и с запасом, л — округлены вверх до 0,1 л. */
  liters: number;
  litersWithReserve: number;
  /** Банки — от точного расхода с запасом; `null`, если объём банки не указан. */
  canVolume: number | null;
  cans: number | null;
  /** Литров в купленных банках. */
  litersToBuy: number | null;
  /** Цена банки и стоимость купленных банок, ₽ (D-033); `null` — цена или объём банки не указаны. */
  canPrice: number | null;
  totalCost: number | null;
  /** Цена указана, а объёма банки нет — стоимость не посчитать (подсказка у поля, не ошибка). */
  costNeedsPack: boolean;
}

export type PaintCalculation =
  { ok: true; result: PaintResult } | { ok: false; errors: PaintErrors };

export const paintLimits = {
  roomLength: { min: 0.1, max: 100 },
  roomWidth: { min: 0.1, max: 100 },
  wallHeight: { min: 0.5, max: 10 },
  openingsArea: { min: 0, max: 10_000 },
  coats: { min: 1, max: 10 },
  coverage: { min: 0.5, max: 50 },
  reserve: { min: 0, max: 50 },
  canVolume: { min: 0.1, max: 100 },
} as const satisfies Record<string, Range>;

export const paintDefaults = { coats: 2, reserve: 10 } as const;

export function calculatePaint(input: PaintInput): PaintCalculation {
  const errors: PaintErrors = {};
  const setError = (field: PaintField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };

  setError('roomLength', checkRequired(input.roomLength, paintLimits.roomLength, 'м'));
  setError('roomWidth', checkRequired(input.roomWidth, paintLimits.roomWidth, 'м'));
  setError('wallHeight', checkRequired(input.wallHeight, paintLimits.wallHeight, 'м'));
  setError('openingsArea', checkOptional(input.openingsArea, paintLimits.openingsArea, 'м²'));
  setError('coats', checkRequired(input.coats, paintLimits.coats, 'слоёв'));
  if (!errors.coats && !Number.isInteger(input.coats)) setError('coats', 'Введите целое число.');
  setError('coverage', checkRequired(input.coverage, paintLimits.coverage, 'м²/л'));
  if (!errors.coverage && input.coverage !== null && !hasPrecision(input.coverage, 1)) {
    setError('coverage', 'Не больше одного знака после запятой.');
  }
  setError('reserve', checkOptional(input.reserve, paintLimits.reserve, '%'));
  if (!errors.reserve && input.reserve !== null && !hasPrecision(input.reserve, 1)) {
    setError('reserve', 'Не больше одного знака после запятой.');
  }
  setError('canVolume', checkOptional(input.canVolume, paintLimits.canVolume, 'л'));
  if (!errors.canVolume && input.canVolume !== null && !hasPrecision(input.canVolume, 3)) {
    setError('canVolume', 'Не точнее 1 мл (три знака после запятой).');
  }
  setError('canPrice', checkPrice(input.canPrice));
  const ceiling = input.ceiling === 'yes' ? true : input.ceiling === 'no' ? false : null;
  if (ceiling === null) setError('ceiling', 'Выберите, красить ли потолок.');

  if (Object.keys(errors).length > 0 || ceiling === null) return { ok: false, errors };

  const L = metersToMm(input.roomLength ?? 0);
  const W = metersToMm(input.roomWidth ?? 0);
  const H = metersToMm(input.wallHeight ?? 0);
  const perimeter = 2 * (L + W);
  const wallArea = perimeter * H;
  const openingsArea = Math.round((input.openingsArea ?? 0) * 1_000_000);
  const toM2 = (mm2: number) => mm2 / 1_000_000;

  if (openingsArea > wallArea) {
    return {
      ok: false,
      errors: {
        openingsArea: `Больше площади стен (${fmt(toM2(wallArea))} м²).`,
      },
    };
  }
  const ceilingArea = ceiling ? L * W : 0;
  const paintArea = wallArea - openingsArea + ceilingArea;
  if (paintArea <= 0) {
    return {
      ok: false,
      errors: {
        openingsArea: 'Проёмы занимают все стены, а потолок не красится — красить нечего.',
      },
    };
  }

  const coats = input.coats ?? paintDefaults.coats;
  const coverageTenths = Math.round((input.coverage ?? 0) * 10);
  const reserveTenths = Math.round((input.reserve ?? 0) * 10);
  // Расход в мл = S[мм²]·n / (100·c₁₀); с запасом — ещё × (1000 + z₁₀) / 1000.
  const volume = paintArea * coats;
  const mlDivisor = 100 * coverageTenths;
  const withReserve = volume * (1000 + reserveTenths);
  const reserveDivisor = mlDivisor * 1000;
  // Литры вверх до 0,1 л: 0,1 л = 100 мл.
  const liters = ceilDiv(volume, mlDivisor * 100) / 10;
  const litersWithReserve = ceilDiv(withReserve, reserveDivisor * 100) / 10;

  const canMl = input.canVolume === null ? null : Math.round(input.canVolume * 1000);
  const cans = canMl === null ? null : ceilDiv(withReserve, reserveDivisor * canMl);
  // Стоимость — по целым банкам (D-033).
  const cost =
    input.canPrice === null || cans === null ? null : packCost(cans, toKopecks(input.canPrice));
  if (cost && !cost.ok) return { ok: false, errors: { canPrice: cost.error } };

  return {
    ok: true,
    result: {
      perimeter: perimeter / 1000,
      wallArea: toM2(wallArea),
      openingsArea: toM2(openingsArea),
      ceilingArea: toM2(ceilingArea),
      paintArea: toM2(paintArea),
      ceilingIncluded: ceiling,
      coats,
      coverage: coverageTenths / 10,
      reserve: reserveTenths / 10,
      liters,
      litersWithReserve,
      canVolume: canMl === null ? null : canMl / 1000,
      cans,
      litersToBuy: cans === null || canMl === null ? null : (cans * canMl) / 1000,
      canPrice: input.canPrice,
      totalCost: cost ? kopecksToRubles(cost.kopecks) : null,
      costNeedsPack: input.canPrice !== null && cans === null,
    },
  };
}
