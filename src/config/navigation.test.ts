import { describe, expect, it } from 'vitest';
import { catalogPath, isCurrentSection, navLinks } from './navigation';

describe('isCurrentSection', () => {
  it('«Калькуляторы» — текущий раздел на странице каталога и на страницах калькуляторов', () => {
    expect(isCurrentSection(catalogPath, '/kalkulyatory/')).toBe(true);
    expect(isCurrentSection(catalogPath, '/kalkulyatory/oboi/')).toBe(true);
  });

  it('на главной и других страницах текущего раздела нет; якорь не бывает текущим', () => {
    expect(isCurrentSection(catalogPath, '/')).toBe(false);
    expect(isCurrentSection(catalogPath, '/404/')).toBe(false);
    expect(isCurrentSection('/#about', '/')).toBe(false);
    expect(isCurrentSection('/', '/')).toBe(false);
  });

  it('в меню нет пункта «Категории», «Калькуляторы» ведёт на каталог', () => {
    expect(navLinks.map((link) => link.label)).toEqual(['Калькуляторы', 'О сервисе']);
    expect(navLinks[0]?.href).toBe('/kalkulyatory/');
  });
});
