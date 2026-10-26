const cache = new Map<string, Intl.NumberFormat>();

function formatter(maximumFractionDigits: number, minimumFractionDigits = 0): Intl.NumberFormat {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;
  let instance = cache.get(key);
  if (!instance) {
    instance = new Intl.NumberFormat('ru-RU', { minimumFractionDigits, maximumFractionDigits });
    cache.set(key, instance);
  }
  return instance;
}

/** Число по-русски: десятичная запятая, неразрывный пробел между разрядами. */
export function formatNumber(value: number, maximumFractionDigits = 2): string {
  return formatter(maximumFractionDigits).format(value);
}

/** Сумма в рублях: копейки показываются, только если они есть. */
export function formatRubles(value: number): string {
  const hasKopecks = Math.round(value * 100) % 100 !== 0;
  return `${formatter(2, hasKopecks ? 2 : 0).format(value)}\u00a0₽`;
}

/** Перечисление по-русски: «обои», «обои и краска», «обои, ламинат и краска». */
export function listRu(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} и ${items.at(-1)}`;
}
