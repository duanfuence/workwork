import { describe, expect, it } from 'vitest';
import { calculators } from '../data/calculators';
import { breadcrumbList, calculatorCrumbs, catalogCrumbs, serializeJsonLd } from './breadcrumbs';

const site = 'https://example.com';

describe('calculatorCrumbs', () => {
  it('Главная → Калькуляторы → название калькулятора', () => {
    expect(calculatorCrumbs({ title: 'Калькулятор обоев' })).toEqual([
      { label: 'Главная', href: '/' },
      { label: 'Калькуляторы', href: '/kalkulyatory/' },
      { label: 'Калькулятор обоев' },
    ]);
  });

  it('каталог: Главная → Калькуляторы (текущая страница)', () => {
    expect(catalogCrumbs()).toEqual([{ label: 'Главная', href: '/' }, { label: 'Калькуляторы' }]);
    expect(breadcrumbList(catalogCrumbs(), site, '/kalkulyatory/').itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://example.com/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Калькуляторы',
        item: 'https://example.com/kalkulyatory/',
      },
    ]);
  });
});

describe('breadcrumbList', () => {
  it.each(
    calculators.filter((entry) => entry.status === 'available').map((entry) => [entry.path, entry]),
  )('%s: те же названия и порядок, что у видимой цепочки; адреса абсолютные', (_path, entry) => {
    const crumbs = calculatorCrumbs(entry);
    const list = breadcrumbList(crumbs, site, entry.path);
    expect(list['@context']).toBe('https://schema.org');
    expect(list['@type']).toBe('BreadcrumbList');
    expect(list.itemListElement.map((item) => item.name)).toEqual(crumbs.map((c) => c.label));
    expect(list.itemListElement.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(list.itemListElement.map((item) => item.item)).toEqual([
      'https://example.com/',
      'https://example.com/kalkulyatory/',
      `https://example.com${entry.path}`,
    ]);
  });
});

describe('serializeJsonLd', () => {
  it('разбирается JSON.parse и не может закрыть тег script', () => {
    const data = { name: '</script><b>' };
    const json = serializeJsonLd(data);
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual(data);
  });
});
