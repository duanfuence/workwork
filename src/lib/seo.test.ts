import { describe, expect, it } from 'vitest';
import { calculators } from '../data/calculators';
import type { CalculatorEntry } from '../data/catalog.types';
import { buildRobots, buildSitemap, canonicalUrl, escapeXml, sitemapPaths } from './seo';

const site = 'https://example.com';

/** Опубликованные страницы калькуляторов (`src/pages/kalkulyatory/*.astro`). */
const pagePaths = Object.keys(import.meta.glob('../pages/kalkulyatory/**/*.astro')).map(
  (file) => `/${file.replace('../pages/', '').replace(/(\/index)?\.astro$/, '')}/`,
);

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);

describe('canonicalUrl', () => {
  it('абсолютный адрес со слэшем на конце, без параметров и якоря', () => {
    expect(canonicalUrl(site, '/')).toBe('https://example.com/');
    expect(canonicalUrl(site, '/kalkulyatory/oboi/')).toBe(
      'https://example.com/kalkulyatory/oboi/',
    );
    expect(canonicalUrl(site, '/kalkulyatory/oboi')).toBe('https://example.com/kalkulyatory/oboi/');
    expect(canonicalUrl(site, '/kalkulyatory/oboi/index.html')).toBe(
      'https://example.com/kalkulyatory/oboi/',
    );
    expect(canonicalUrl(site, '/kalkulyatory/oboi/?utm=1#calc')).toBe(
      'https://example.com/kalkulyatory/oboi/',
    );
  });
});

describe('sitemap', () => {
  const xml = buildSitemap(site, sitemapPaths(calculators));

  it('главная и только опубликованные калькуляторы', () => {
    const available = calculators.filter((entry) => entry.status === 'available');
    expect(locs(xml)).toEqual([
      'https://example.com/',
      ...available.map((entry) => `https://example.com${entry.path}`),
    ]);
  });

  it('у каждого калькулятора из sitemap есть страница; 404 и черновиков нет', () => {
    for (const loc of locs(xml).slice(1)) {
      expect(pagePaths).toContain(new URL(loc ?? '').pathname);
    }
    expect(xml).not.toContain('404');
    const planned: CalculatorEntry = {
      ...calculators[0]!,
      path: '/kalkulyatory/skoro/',
      status: 'planned',
    };
    expect(sitemapPaths([planned])).toEqual(['/']);
  });

  it('адреса абсолютные, со слэшем на конце; без lastmod', () => {
    for (const loc of locs(xml)) expect(loc).toMatch(/^https:\/\/example\.com\/(.*\/)?$/);
    expect(xml).not.toContain('lastmod');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
  });

  it('спецсимволы XML экранируются, дубли не повторяются', () => {
    expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
    const special = buildSitemap(site, ['/', '/a&b/', '/']);
    expect(locs(special)).toEqual(['https://example.com/', 'https://example.com/a&amp;b/']);
  });
});

describe('robots.txt', () => {
  it('без адреса сайта — разрешено всё, строки Sitemap нет', () => {
    expect(buildRobots(undefined)).toBe('User-agent: *\nAllow: /\n');
  });

  it('с адресом — абсолютная строка Sitemap, без Host', () => {
    const robots = buildRobots(site);
    expect(robots).toBe('User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n');
    expect(robots).not.toMatch(/host:/i);
  });
});
