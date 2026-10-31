/**
 * Адрес сайта из переменной окружения SITE_URL. Без адреса сайт собирается без всего, что требует
 * абсолютных ссылок (canonical, og:url, og:image, sitemap.xml, строка Sitemap в robots.txt, JSON-LD).
 *
 * Модуль без зависимостей: его импортирует astro.config.mjs.
 */

/**
 * Проверяет SITE_URL и возвращает адрес в виде `https://домен` (без слэша на конце) или `undefined`,
 * если переменная не задана или пуста. Неверное значение — ошибка с объяснением на русском.
 */
export function parseSiteUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const problem = (reason: string) =>
    new Error(
      `SITE_URL задан неверно: «${value}» — ${reason}. Нужен адрес вида https://<домен> без пути, ` +
        'параметров и якоря. Чтобы собрать сайт без адреса, не задавайте SITE_URL.',
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw problem('это не абсолютный адрес');
  }
  if (url.protocol !== 'https:') throw problem('нужен протокол https');
  if (url.username || url.password) throw problem('логин и пароль в адресе недопустимы');
  if (url.pathname !== '/') throw problem('адрес не должен содержать путь');
  if (url.search || value.includes('?')) throw problem('адрес не должен содержать параметры (?…)');
  if (url.hash || value.includes('#')) throw problem('адрес не должен содержать якорь (#…)');
  return url.origin;
}
