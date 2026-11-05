/** Результат разбора числа из текстового поля. */
export type ParsedNumber =
  { kind: 'empty' } | { kind: 'invalid' } | { kind: 'number'; value: number };

/**
 * Разбирает десятичное число, введённое пользователем: допускает запятую или точку,
 * пробелы между разрядами («10 050»). Экспоненциальная запись, несколько разделителей,
 * буквы и бесконечность считаются ошибкой ввода.
 */
export function parseDecimal(raw: string): ParsedNumber {
  const text = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (text === '') return { kind: 'empty' };
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text)) return { kind: 'invalid' };
  const value = Number(text);
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
}

/** Целочисленное деление с округлением вверх для неотрицательного `a` и положительного `b`. */
export function ceilDiv(a: number, b: number): number {
  const quotient = Math.floor(a / b);
  return quotient * b < a ? quotient + 1 : quotient;
}

/** Округляет `value` вверх до ближайшего кратного `step` (целые неотрицательные числа). */
export function ceilToMultiple(value: number, step: number): number {
  return ceilDiv(value, step) * step;
}

/** Перевод метров в целые миллиметры (точность расчёта — 1 мм). */
export function metersToMm(meters: number): number {
  return Math.round(meters * 1000);
}

/** Перевод сантиметров в целые миллиметры. */
export function centimetersToMm(centimeters: number): number {
  return Math.round(centimeters * 10);
}
