// @ts-check
import { defineConfig } from 'astro/config';
import { seoFiles, siteUrl } from './src/integrations/seo-files.mjs';

// Статическая генерация (output: 'static') — значение Astro по умолчанию.
// Адрес сайта — переменная окружения SITE_URL (https://домен без пути); от него зависят canonical,
// og:url, og:image, JSON-LD и sitemap.xml. Без адреса сайт собирается без них.
export default defineConfig({
  output: 'static',
  ...(siteUrl ? { site: siteUrl } : {}),
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [seoFiles(siteUrl)],
});
