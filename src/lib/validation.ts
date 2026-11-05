/**
 * Общие проверки числовых полей калькуляторов. Чистый модуль: без DOM.
 * Сообщения — для показа у поля; единица в них без точки на конце («шт», а не «шт.»),
 * иначе вместе с точкой сообщения получится «шт..».
 */

/** Допустимый диапазон значения поля. */
export interface Range {
  min: number;
  max: number;
}

/** Число для текста сообщения: десятичная запятая, без разделителей разрядов («0,1», «10000»). */
export const fmt = (value: number) => String(value).replace('.', ',');

/** Обязательное поле: пустое, нечисловое, ноль и отрицательное — ошибка, затем границы диапазона. */
export function checkRequired(value: number | null, range: Range, unit: string): string | null {
  if (value === null) return 'Заполните поле.';
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value <= 0) return 'Значение должно быть больше нуля.';
  if (value < range.min) return `Не меньше ${fmt(range.min)} ${unit}.`;
  if (value > range.max) return `Не больше ${fmt(range.max)} ${unit}.`;
  return null;
}

/** Необязательное поле: пустое допустимо; ноль допустим, если не меньше `range.min`. */
export function checkOptional(value: number | null, range: Range, unit: string): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return 'Введите число.';
  if (value < 0) return 'Значение не может быть отрицательным.';
  if (value < range.min) return `Не меньше ${fmt(range.min)} ${unit}.`;
  if (value > range.max) return `Не больше ${fmt(range.max)} ${unit}.`;
  return null;
}

/** Не больше `digits` знаков после запятой (с допуском на двоичные дроби: 0,1 + 0,2). */
export function hasPrecision(value: number, digits: number): boolean {
  const scaled = value * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}
