/**
 * Адреса для поисковых систем: канонический адрес страницы, sitemap.xml и robots.txt.
 * Чистые функции без Astro и DOM: их используют BaseLayout и хук сборки в astro.config.mjs.
 * `site` — адрес сайта без слэша на конце (результат parseSiteUrl).
 */
import { catalogPath } from '../config/navigation';
import type { CalculatorEntry } from '../data/catalog.types';
import { getCalculatorHref } from './catalog';

/**
 * Канонический абсолютный адрес страницы: путь со слэшем на конце (`trailingSlash: 'always'`),
 * без `index.html`, параметров и якоря.
 */
export function canonicalUrl(site: string, pathname: string): string {
  const url = new URL(pathname, `${site}/`);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');
  return url.href;
}

/**
 * Страницы для sitemap.xml: главная, каталог /kalkulyatory/ и опубликованные калькуляторы
 * (каталог — единственный источник).
 */
export function sitemapPaths(calculators: readonly CalculatorEntry[]): string[] {
  const paths = calculators
    .map((entry) => getCalculatorHref(entry))
    .filter((href): href is string => href !== null);
  return ['/', catalogPath, ...paths];
}

const xmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => xmlEscapes[char] ?? char);

/** sitemap.xml без lastmod: честной даты изменения страниц нет. */
export function buildSitemap(site: string, paths: readonly string[]): string {
  const urls = [...new Set(paths.map((path) => canonicalUrl(site, path)))];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/** robots.txt: индексировать всё; строка Sitemap — только с адресом сайта. Директива Host не нужна. */
export function buildRobots(site: string | undefined): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (site) lines.push('', `Sitemap: ${canonicalUrl(site, '/')}sitemap.xml`);
  return `${lines.join('\n')}\n`;
}
