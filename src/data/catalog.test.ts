import { describe, expect, it } from 'vitest';
import { calculators } from './calculators';
import { categories } from './categories';

describe('целостность каталога', () => {
  it('идентификаторы калькуляторов уникальны и в формате kebab-case', () => {
    const ids = calculators.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('slug уникальны и path построен из slug', () => {
    const slugs = calculators.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of calculators) {
      expect(entry.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(entry.path).toBe(`/kalkulyatory/${entry.slug}/`);
    }
  });

  it('каждый калькулятор ссылается на существующую категорию', () => {
    const categoryIds = new Set(categories.map((category) => category.id));
    for (const entry of calculators) expect(categoryIds.has(entry.category)).toBe(true);
  });

  it('категории уникальны по id и порядку', () => {
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length);
    expect(new Set(categories.map((c) => c.order)).size).toBe(categories.length);
  });

  it('у каждого калькулятора заполнены название, описание и SEO-метаданные', () => {
    for (const entry of calculators) {
      expect(entry.title.trim()).not.toBe('');
      expect(entry.description.trim()).not.toBe('');
      expect(entry.seo.title.length).toBeGreaterThan(0);
      expect(entry.seo.title.length).toBeLessThanOrEqual(70);
      expect(entry.seo.description.length).toBeGreaterThan(0);
      expect(entry.seo.description.length).toBeLessThanOrEqual(160);
      expect(entry.seo.keywords.length).toBeGreaterThan(0);
    }
  });

  it('содержит шесть калькуляторов первой очереди', () => {
    expect(calculators.map((entry) => entry.id)).toEqual([
      'wallpaper',
      'laminate',
      'paint',
      'tile',
      'putty',
      'plaster',
    ]);
  });

  it('пока нет ни одного опубликованного калькулятора — страницы ещё не созданы', () => {
    // Когда появится первая страница калькулятора, этот тест нужно заменить проверкой,
    // что для каждого `available` существует файл страницы.
    expect(calculators.filter((entry) => entry.status === 'available')).toEqual([]);
  });
});
