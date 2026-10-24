/**
 * Выбор формы слова по числу по правилам русского языка.
 * @param forms формы для 1, 2–4 и 5+ (например: «калькулятор», «калькулятора», «калькуляторов»)
 */
export function pluralizeRu(count: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(count));
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export const calculatorWordForms = ['калькулятор', 'калькулятора', 'калькуляторов'] as const;
export const rollWordForms = ['рулон', 'рулона', 'рулонов'] as const;
export const stripWordForms = ['полоса', 'полосы', 'полос'] as const;
