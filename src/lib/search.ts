import type { CalculatorEntry } from '../data/catalog.types';

/**
 * Приводит текст к виду для сравнения: NFKC («м²» → «м2», составная «ё» → одна буква),
 * нижний регистр, «ё» → «е», только буквы и цифры через одиночный пробел.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Строка, по которой ищется калькулятор: название, описание, поисковые слова и SEO-запросы. */
export function buildSearchIndex(entry: CalculatorEntry): string {
  return normalizeSearchText(
    [entry.title, entry.description, ...entry.searchTerms, ...entry.seo.keywords].join(' '),
  );
}

/**
 * Проверяет, подходит ли индекс под запрос.
 * Каждое слово запроса должно быть началом какого-либо слова индекса,
 * поэтому «плит» находит «плитка», а «ламинат пол» — только ламинат.
 */
export function matchesQuery(index: string, query: string): boolean {
  const queryWords = normalizeSearchText(query).split(' ').filter(Boolean);
  if (queryWords.length === 0) return true;
  const indexWords = index.split(' ');
  return queryWords.every((queryWord) =>
    indexWords.some((indexWord) => indexWord.startsWith(queryWord)),
  );
}

export function searchCatalog(list: readonly CalculatorEntry[], query: string): CalculatorEntry[] {
  return list.filter((entry) => matchesQuery(buildSearchIndex(entry), query));
}
