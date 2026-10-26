import type {
  CalculatorEntry,
  CalculatorStatus,
  Category,
  CategoryId,
} from '../data/catalog.types';

export const statusLabels: Record<CalculatorStatus, string> = {
  planned: 'Скоро',
  'in-progress': 'Скоро',
  available: 'Доступен',
};

/** Можно ли ссылаться на страницу калькулятора. */
export function isAvailable(entry: CalculatorEntry): boolean {
  return entry.status === 'available';
}

/** Ссылка на страницу калькулятора или `null`, если страница ещё не создана. */
export function getCalculatorHref(entry: CalculatorEntry): string | null {
  return isAvailable(entry) ? entry.path : null;
}

export function sortCategories(list: readonly Category[]): Category[] {
  return [...list].sort((a, b) => a.order - b.order);
}

export function getCalculatorsByCategory(
  list: readonly CalculatorEntry[],
  categoryId: CategoryId,
): CalculatorEntry[] {
  return list.filter((entry) => entry.category === categoryId);
}

/** Популярные инструменты: сначала доступные, затем остальные; порядок внутри групп сохраняется. */
export function getPopularCalculators(list: readonly CalculatorEntry[]): CalculatorEntry[] {
  const popular = list.filter((entry) => entry.popular);
  return [
    ...popular.filter((entry) => isAvailable(entry)),
    ...popular.filter((entry) => !isAvailable(entry)),
  ];
}

/** Опубликованные калькуляторы в порядке каталога. */
export function getAvailableCalculators(list: readonly CalculatorEntry[]): CalculatorEntry[] {
  return list.filter((entry) => isAvailable(entry));
}

export interface CatalogSection {
  category: Category;
  entries: CalculatorEntry[];
}

/** Разделы каталога: категории по порядку, только с опубликованными калькуляторами. */
export function getCatalogSections(
  list: readonly CalculatorEntry[],
  categories: readonly Category[],
): CatalogSection[] {
  return sortCategories(categories)
    .map((category) => ({
      category,
      entries: getAvailableCalculators(getCalculatorsByCategory(list, category.id)),
    }))
    .filter((section) => section.entries.length > 0);
}

/** Сколько карточек в блоке «Другие калькуляторы». */
export const relatedLimit = 4;

/**
 * «Другие калькуляторы» для страницы `current`: только опубликованные, без текущего; сначала той же
 * категории, затем остальные. Внутри групп — по порядку каталога, начиная со следующего за текущим
 * и по кругу: при лимите меньше числа калькуляторов каждый попадает на одинаковое число страниц,
 * а не только первые по списку. Порядок стабилен — без случайности.
 */
export function getRelatedCalculators(
  list: readonly CalculatorEntry[],
  current: CalculatorEntry,
  limit = relatedLimit,
): CalculatorEntry[] {
  const index = list.findIndex((entry) => entry.id === current.id);
  const rotated = index === -1 ? [...list] : [...list.slice(index + 1), ...list.slice(0, index)];
  const candidates = getAvailableCalculators(rotated).filter((entry) => entry.id !== current.id);
  return [
    ...candidates.filter((entry) => entry.category === current.category),
    ...candidates.filter((entry) => entry.category !== current.category),
  ].slice(0, Math.max(0, limit));
}
