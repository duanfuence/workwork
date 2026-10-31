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

const nbsp = ' ';

/**
 * Русская типографика для строк на экране и в тексте «Скопировать»: неразрывный пробел
 * - перед тире — строка не начинается с «—»;
 * - между числом и единицей, знаком или словом — «10 %», «66 м²», «2,7 л», «14 шт.», «5 банок»;
 * - после коротких предлогов и союзов — «в комнате», «и потолок», «на 1 мм».
 * Текст не меняется по смыслу: заменяются только обычные пробелы.
 */
export function typograph(text: string): string {
  return text
    .replace(/ +(?=[—–] )/g, nbsp)
    .replace(/(\d) +(?=[%‰₽°]|\p{L})/gu, `$1${nbsp}`)
    .replace(
      /(?<![\p{L}\d])(в|во|и|с|со|к|ко|на|из|по|за|до|от|о|об|у|а|не|но|для) +/giu,
      `$1${nbsp}`,
    );
}
