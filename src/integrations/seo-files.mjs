/**
 * Адрес сайта из SITE_URL и файлы для поисковых систем после сборки (D-021).
 * Отдельный модуль, потому что работает с Node.js (process.env, запись файлов), а astro.config.mjs
 * проверяется типами без @types/node.
 */
import { writeFile } from 'node:fs/promises';
import { calculators } from '../data/calculators';
import { buildRobots, buildSitemap, sitemapPaths } from '../lib/seo';
import { parseSiteUrl } from '../lib/site-url';

/**
 * Адрес сайта `https://домен` или `undefined`. Без адреса сайт собирается без canonical, og:url, og:image,
 * JSON-LD и sitemap.xml; неверное значение останавливает сборку с объяснением.
 * @type {string | undefined}
 */
export const siteUrl = parseSiteUrl(process.env.SITE_URL);

/**
 * robots.txt — всегда; sitemap.xml — только при заданном адресе (относительные адреса в нём недопустимы).
 * Состав sitemap — из каталога калькуляторов: главная и опубликованные калькуляторы.
 * @param {string | undefined} site
 * @returns {import('astro').AstroIntegration}
 */
export function seoFiles(site) {
  return {
    name: 'domraschet-seo-files',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        await writeFile(new URL('robots.txt', dir), buildRobots(site));
        if (site) {
          await writeFile(
            new URL('sitemap.xml', dir),
            buildSitemap(site, sitemapPaths(calculators)),
          );
          logger.info(`robots.txt и sitemap.xml для ${site}`);
        } else {
          logger.info('robots.txt без строки Sitemap: SITE_URL не задан, sitemap.xml не создаётся');
        }
      },
    },
  };
}
