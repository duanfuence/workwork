/**
 * Разбор текстовых полей формы калькулятора в числа. Чистый модуль: без DOM.
 * Проверку допустимых значений делает функция расчёта конкретного калькулятора.
 */
import { parseDecimal } from './number';

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export type Calculation<F extends string, R> =
  { ok: true; result: R } | { ok: false; errors: FieldErrors<F> };

export interface ParsedFields<F extends string> {
  /** Число или `null`, если поле пустое либо не разобрано. */
  values: Record<F, number | null>;
  /** «Введите число.» для полей, где текст не является числом. */
  errors: FieldErrors<F>;
}

export function parseNumberFields<F extends string>(
  fields: readonly F[],
  raw: Record<F, string>,
): ParsedFields<F> {
  const values = {} as Record<F, number | null>;
  const errors: FieldErrors<F> = {};
  for (const field of fields) {
    const parsed = parseDecimal(raw[field]);
    values[field] = parsed.kind === 'number' ? parsed.value : null;
    if (parsed.kind === 'invalid') errors[field] = 'Введите число.';
  }
  return { values, errors };
}

/**
 * Объединяет ошибки разбора с результатом расчёта: ошибка разбора важнее ошибки расчёта
 * того же поля, и при любой ошибке разбора расчёт не показывается.
 */
export function withParseErrors<F extends string, R>(
  calculation: Calculation<F, R>,
  parseErrors: FieldErrors<F>,
): Calculation<F, R> {
  if (Object.keys(parseErrors).length === 0) return calculation;
  return {
    ok: false,
    errors: calculation.ok ? parseErrors : { ...calculation.errors, ...parseErrors },
  };
}
