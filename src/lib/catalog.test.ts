import { describe, expect, it } from 'vitest';
import type { CalculatorEntry, Category } from '../data/catalog.types';
import {
  getCalculatorHref,
  getCalculatorsByCategory,
  getPopularCalculators,
  sortCategories,
  statusLabels,
} from './catalog';

function entry(overrides: Partial<CalculatorEntry> & Pick<CalculatorEntry, 'id'>): CalculatorEntry {
  return {
    slug: overrides.id,
    title: `Калькулятор ${overrides.id}`,
    category: 'repair',
    description: 'Описание',
    path: `/kalkulyatory/${overrides.id}/`,
    status: 'planned',
    popular: false,
    searchTerms: [],
    seo: { title: 'Заголовок', description: 'Описание', keywords: ['запрос'] },
    ...overrides,
  };
}

describe('getCalculatorHref', () => {
  it('возвращает путь только для опубликованного калькулятора', () => {
    expect(getCalculatorHref(entry({ id: 'a', status: 'available' }))).toBe('/kalkulyatory/a/');
    expect(getCalculatorHref(entry({ id: 'b', status: 'planned' }))).toBeNull();
    expect(getCalculatorHref(entry({ id: 'c', status: 'in-progress' }))).toBeNull();
  });
});

describe('statusLabels', () => {
  it('неготовые калькуляторы помечаются как «Скоро»', () => {
    expect(statusLabels.planned).toBe('Скоро');
    expect(statusLabels['in-progress']).toBe('Скоро');
  });
});

describe('getPopularCalculators', () => {
  it('берёт только популярные и ставит доступные первыми, сохраняя порядок', () => {
    const list = [
      entry({ id: 'a', popular: true }),
      entry({ id: 'b', popular: false, status: 'available' }),
      entry({ id: 'c', popular: true, status: 'available' }),
      entry({ id: 'd', popular: true }),
    ];
    expect(getPopularCalculators(list).map((e) => e.id)).toEqual(['c', 'a', 'd']);
  });
});

describe('getCalculatorsByCategory', () => {
  it('фильтрует по категории', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b', category: 'cost' })];
    expect(getCalculatorsByCategory(list, 'cost').map((e) => e.id)).toEqual(['b']);
    expect(getCalculatorsByCategory(list, 'construction')).toEqual([]);
  });
});

describe('sortCategories', () => {
  it('сортирует по order и не изменяет исходный массив', () => {
    const list: Category[] = [
      { id: 'cost', title: 'Б', description: '', order: 2 },
      { id: 'repair', title: 'А', description: '', order: 1 },
    ];
    expect(sortCategories(list).map((c) => c.id)).toEqual(['repair', 'cost']);
    expect(list[0]?.id).toBe('cost');
  });
});
