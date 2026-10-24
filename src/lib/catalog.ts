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
