import { describe, expect, it } from 'vitest';
import type { CalculatorEntry, Category } from '../data/catalog.types';
import {
  getAvailableCalculators,
  getCalculatorHref,
  getCalculatorsByCategory,
  getCatalogSections,
  getPopularCalculators,
  getRelatedCalculators,
  getRoomNextCalculators,
  relatedLimit,
  sheetLabel,
  sortCategories,
  statusLabels,
} from './catalog';

function entry(overrides: Partial<CalculatorEntry> & Pick<CalculatorEntry, 'id'>): CalculatorEntry {
  return {
    slug: overrides.id,
    title: `Калькулятор ${overrides.id}`,
    shortTitle: overrides.id,
    sheet: 1,
    sheetTitle: 'Отделка стен',
    roomFields: [],
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

const ids = (list: readonly CalculatorEntry[]) => list.map((item) => item.id);

describe('getAvailableCalculators', () => {
  it('только опубликованные, в порядке каталога', () => {
    const list = [
      entry({ id: 'a', status: 'available' }),
      entry({ id: 'b' }),
      entry({ id: 'c', status: 'in-progress' }),
      entry({ id: 'd', status: 'available' }),
    ];
    expect(ids(getAvailableCalculators(list))).toEqual(['a', 'd']);
  });
});

describe('getCatalogSections', () => {
  const categories: Category[] = [
    { id: 'construction', title: 'Строительство', description: '', order: 2 },
    { id: 'repair', title: 'Ремонт', description: '', order: 1 },
    { id: 'cost', title: 'Стоимость', description: '', order: 3 },
  ];

  it('категории по порядку, без пустых и без категорий только с неготовыми калькуляторами', () => {
    const list = [
      entry({ id: 'wall', category: 'construction', status: 'available' }),
      entry({ id: 'paint', category: 'repair', status: 'available' }),
      entry({ id: 'tile', category: 'repair' }),
      entry({ id: 'estimate', category: 'cost' }),
    ];
    const sections = getCatalogSections(list, categories);
    expect(sections.map((section) => section.category.id)).toEqual(['repair', 'construction']);
    expect(sections.map((section) => ids(section.entries))).toEqual([['paint'], ['wall']]);
  });
});

describe('getRelatedCalculators', () => {
  const list = [
    entry({ id: 'a', status: 'available' }),
    entry({ id: 'b', status: 'available', category: 'construction' }),
    entry({ id: 'c', status: 'available' }),
    entry({ id: 'd' }),
    entry({ id: 'e', status: 'available' }),
    entry({ id: 'f', status: 'available', category: 'construction' }),
    entry({ id: 'g', status: 'available' }),
  ];
  const byId = (id: string) => list.find((item) => item.id === id)!;

  it('сначала та же категория, затем остальные; по кругу от следующего за текущим', () => {
    expect(ids(getRelatedCalculators(list, byId('c'), 10))).toEqual(['e', 'g', 'a', 'f', 'b']);
    expect(ids(getRelatedCalculators(list, byId('b'), 10))).toEqual(['f', 'c', 'e', 'g', 'a']);
  });

  it('текущий исключён, неготовые не попадают', () => {
    for (const current of list) {
      const related = ids(getRelatedCalculators(list, current, 10));
      expect(related).not.toContain(current.id);
      expect(related).not.toContain('d');
    }
  });

  it('не больше лимита; по умолчанию — relatedLimit', () => {
    expect(getRelatedCalculators(list, byId('a'), 2)).toHaveLength(2);
    expect(getRelatedCalculators(list, byId('a'))).toHaveLength(relatedLimit);
    expect(getRelatedCalculators(list, byId('a'), 0)).toEqual([]);
  });

  it('порядок стабилен и не зависит от числа вызовов', () => {
    expect(getRelatedCalculators(list, byId('e'))).toEqual(getRelatedCalculators(list, byId('e')));
  });

  it('при лимите меньше числа калькуляторов каждый показывается одинаково часто', () => {
    const shown = new Map<string, number>();
    const repair = list.filter((item) => item.status === 'available' && item.category === 'repair');
    for (const current of repair) {
      for (const item of getRelatedCalculators(repair, current, 2)) {
        shown.set(item.id, (shown.get(item.id) ?? 0) + 1);
      }
    }
    expect(new Set(shown.values())).toEqual(new Set([2]));
  });
});

describe('штамп листа', () => {
  it('номер двумя цифрами и раздел работ', () => {
    expect(sheetLabel(entry({ id: 'oboi', sheet: 1, sheetTitle: 'Отделка стен' }))).toBe(
      'Лист 01 · Отделка стен',
    );
    expect(sheetLabel(entry({ id: 'x', sheet: 12, sheetTitle: 'Полы' }))).toBe('Лист 12 · Полы');
  });
});

describe('дальше для этой комнаты', () => {
  const room = ['roomLength', 'roomWidth', 'wallHeight'] as const;
  const list = [
    entry({ id: 'oboi', status: 'available', roomFields: room }),
    entry({ id: 'laminat', status: 'available', roomFields: ['roomLength', 'roomWidth'] }),
    entry({ id: 'plitka', status: 'available', roomFields: [] }),
    entry({ id: 'kraska', status: 'planned', roomFields: room }),
    entry({ id: 'shpaklevka', status: 'available', roomFields: room }),
  ];

  it('опубликованные калькуляторы с общими полями комнаты, без текущего, в порядке каталога', () => {
    const current = list[0];
    if (!current) throw new Error('нет записи');
    expect(getRoomNextCalculators(list, current).map((item) => item.id)).toEqual([
      'laminat',
      'shpaklevka',
    ]);
  });

  it('у калькулятора без полей комнаты — пусто', () => {
    const tile = list[2];
    if (!tile) throw new Error('нет записи');
    expect(getRoomNextCalculators(list, tile)).toEqual([]);
  });
});
