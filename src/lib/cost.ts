/**
 * Стоимость покупки (D-033): цена — как на ценнике, необязательна; стоимость — по тому, что реально покупается
 * (целые упаковки или купленная площадь), а не по точному расходу. Чистые функции без DOM; их используют все шесть
 * калькуляторов (контрольные примеры — «Стоимость» в docs/calculators/*.md).
 *
 * Деньги внутри — целые копейки; произведения считаются точно в BigInt. Сумма за пределом точных целых чисел
 * (2⁵³ − 1 копеек, ~90 трлн ₽) — ошибка, а не неточное число.
 */
import { formatNumber, formatRubles } from './format';
import { parseDecimal } from './number';
import { pluralizeRu } from './plural';
import { checkOptional, hasPrecision } from './validation';

/** Цена на ценнике: от 0 до 1 000 000 ₽. */
export const priceLimits = { min: 0, max: 1_000_000 } as const;

export const costTooLarge = 'Слишком большая сумма для расчёта — проверьте цену.';

/** Проверка поля цены: пусто — можно, иначе 0–1 000 000 ₽ и не точнее копейки. */
export function checkPrice(value: number | null): string | null {
  const range = checkOptional(value, priceLimits, '₽');
  if (range !== null || value === null) return range;
  return hasPrecision(value, 2) ? null : 'Не точнее 1 копейки.';
}

/** Рубли → целые копейки (цена уже проверена: не точнее копейки). */
export function toKopecks(rubles: number): number {
  return Math.round(rubles * 100);
}

export type CostCalculation = { ok: true; kopecks: number } | { ok: false; error: string };

function safe(kopecks: bigint): CostCalculation {
  return kopecks <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { ok: true, kopecks: Number(kopecks) }
    : { ok: false, error: costTooLarge };
}

/** Стоимость целых упаковок: `число · цена` в копейках, точно. */
export function packCost(count: number, priceKopecks: number): CostCalculation {
  return safe(BigInt(count) * BigInt(priceKopecks));
}

/**
 * Стоимость купленной площади по цене за м²: `площадь[мм²] · цена[коп.] / 10⁶`, округление до копейки
 * (половина — вверх). Площадь — целые мм².
 */
export function areaCost(areaMm2: number, priceKopecksPerM2: number): CostCalculation {
  return safe((BigInt(areaMm2) * BigInt(priceKopecksPerM2) + 500_000n) / 1_000_000n);
}

/** Копейки → рубли для результата расчёта (`formatRubles` покажет копейки, только если они есть). */
export const kopecksToRubles = (kopecks: number) => kopecks / 100;

/** Разбивка стоимости упаковок: «2 банки × 2 380 ₽». */
export function packCostDetail(
  count: number,
  forms: readonly [string, string, string],
  price: number,
): string {
  return `${count} ${pluralizeRu(count, forms)} × ${formatRubles(price)}`;
}

/** Разбивка стоимости площади: «19,2 м² × 1 250 ₽/м²» (площадь — с двумя знаками). */
export function areaCostDetail(areaM2: number, price: number): string {
  return `${formatNumber(areaM2, 2)}\u00a0м² × ${formatRubles(price)}/м²`;
}

/** Строка стоимости для результата, панели и «Скопировать»: «Стоимость ≈ 11 900 ₽». */
export const costText = (total: number) => `Стоимость ≈ ${formatRubles(total)}`;

/**
 * Подсказка у поля цены «Укажите объём банки — тогда посчитаем стоимость»: цена введена (число), а размера
 * упаковки, без которого стоимость не считается, нет. Это не ошибка — расчёт количества идёт как обычно.
 */
export function needsPackSize(priceText: string, packText: string): boolean {
  const price = parseDecimal(priceText);
  const pack = parseDecimal(packText);
  return price.kind === 'number' && price.value >= 0 && !(pack.kind === 'number' && pack.value > 0);
}
