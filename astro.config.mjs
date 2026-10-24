// @ts-check
import { defineConfig } from 'astro/config';

// Статическая генерация (output: 'static') — значение Astro по умолчанию.
// Адрес `site` будет задан, когда появится реальный домен: от него зависят canonical и sitemap.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
