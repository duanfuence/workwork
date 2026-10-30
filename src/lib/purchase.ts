/**
 * «К покупке» — то, что покупают (D-031): если известен объём упаковки, главная цифра — число упаковок с подписью
 * («1 банка по 30 л», «23 мешка по 25 кг», «18 упаковок по 11 шт.»), а нужное количество — строкой под ней.
 * Чистая функция без DOM: её вызывают страницы калькуляторов в `render`; строки — для блока результата,
 * панели итога и диктора (`summary`) и текста «Скопировать» (`purchase`).
 */
import { pluralizeRu } from './plural';

export interface PackagePurchase {
  /** Главная цифра: «23». */
  number: string;
  /** Подпись к ней: «мешка по 25 кг». */
  unit: string;
  /** Коротко для панели итога и диктора: «23 мешка по 25 кг». */
  summary: string;
  /** Позиция списка покупок: «23 мешка по 25 кг — нужно 568,4 кг». */
  purchase: string;
}

/**
 * @param count число упаковок (целое, уже округлено вверх)
 * @param forms формы слова для 1, 2–4 и 5+: «банка», «банки», «банок»
 * @param packSize объём одной упаковки с единицей: «2,7 л», «25 кг», «11 шт.»
 * @param need сколько нужно с запасом, с единицей: «12,7 л», «196 плиток»
 */
export function packagePurchase(
  count: number,
  forms: readonly [string, string, string],
  packSize: string,
  need: string,
): PackagePurchase {
  const unit = `${pluralizeRu(count, forms)} по ${packSize}`;
  const summary = `${count} ${unit}`;
  return { number: String(count), unit, summary, purchase: `${summary} — нужно ${need}` };
}
