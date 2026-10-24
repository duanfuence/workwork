/**
 * Проверка интерфейса в Chromium через Playwright.
 *
 * Использование: npm run build && npm run ui:check [-- <папка для скриншотов>]
 * Папка по умолчанию — .ui-check/ (в .gitignore).
 *
 * Playwright не входит в зависимости проекта: скрипт использует установленный в среде пакет
 * (в облачной среде Claude Code он предустановлен). Запускается вручную, в CI не входит.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright не найден. Установите его глобально или запустите в облачной среде.');
  process.exit(2);
}

const outDir = path.resolve(process.argv[2] ?? '.ui-check');
const port = 4329;
const baseUrl = `http://localhost:${port}`;
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
];

const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? '✓' : '✗'} ${message}`);
  if (!condition) failures.push(message);
};

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // сервер ещё запускается
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Сервер не ответил за ${timeoutMs} мс: ${url}`);
}

const server = spawn('npx', ['astro', 'preview', '--port', String(port)], {
  stdio: 'ignore',
  detached: true,
});

try {
  await waitForServer(baseUrl);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();

  for (const viewport of viewports) {
    console.log(`\n— ${viewport.name} (${viewport.width}×${viewport.height})`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      locale: 'ru-RU',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const response = await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
    check(response?.status() === 200, 'главная отвечает 200');
    check((response?.headers()['content-type'] ?? '').includes('text/html'), 'ответ — text/html');

    // Метаданные
    const meta = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      charset: document.characterSet,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content'),
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      h1Count: document.querySelectorAll('h1').length,
    }));
    check(meta.lang === 'ru', `lang="ru" (${meta.lang})`);
    check(meta.charset === 'UTF-8', `кодировка UTF-8 (${meta.charset})`);
    check(meta.title.startsWith('ДомРасчёт'), `title: «${meta.title}»`);
    check((meta.description ?? '').length >= 50, 'meta description заполнен');
    check(meta.viewport?.includes('width=device-width') ?? false, 'meta viewport');
    check(Boolean(meta.ogTitle), 'og:title');
    check(meta.h1Count === 1, `ровно один h1 (${meta.h1Count})`);

    // Кириллица
    const h1 = (await page.textContent('h1'))?.trim();
    check(h1 === 'ДомРасчёт', `h1 отображается кириллицей: «${h1}»`);

    // Горизонтальная прокрутка
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    check(
      overflow.scrollWidth <= overflow.clientWidth,
      `нет горизонтальной прокрутки (${overflow.scrollWidth} ≤ ${overflow.clientWidth})`,
    );

    // Карточки «Скоро» не являются ссылками
    const cards = page.locator('#catalog-list > li');
    check((await cards.count()) === 6, `6 карточек калькуляторов (${await cards.count()})`);
    const cardLinks = await page.locator('#catalog-list a').count();
    check(cardLinks === 0, `карточки «Скоро» не содержат ссылок (${cardLinks})`);
    const soonBadges = await page.locator('#catalog-list .badge--soon').count();
    check(soonBadges === 6, `у всех карточек статус «Скоро» (${soonBadges})`);

    // Все внутренние ссылки ведут на существующие страницы или якоря
    const hrefs = await page.$$eval('a[href]', (links) => links.map((a) => a.getAttribute('href')));
    for (const href of new Set(hrefs)) {
      if (!href || href.startsWith('http')) continue;
      const url = new URL(href, baseUrl);
      const linkResponse = await fetch(url);
      let ok = linkResponse.ok;
      if (ok && url.hash) {
        ok = (await page.locator(url.hash).count()) === 1;
      }
      check(ok, `ссылка ${href} ведёт на существующую страницу/раздел`);
    }

    // Навигация
    const toggle = page.locator('[data-nav-toggle]');
    if (viewport.isMobile) {
      check(await toggle.isVisible(), 'кнопка «Меню» видна');
      check(!(await page.locator('#site-nav').isVisible()), 'меню свёрнуто по умолчанию');
      await toggle.click();
      check(
        (await toggle.getAttribute('aria-expanded')) === 'true',
        'aria-expanded=true после нажатия',
      );
      check(await page.locator('#site-nav').isVisible(), 'меню раскрывается');
      await page.waitForTimeout(300); // дождаться анимации значка
      await page.screenshot({ path: path.join(outDir, `${viewport.name}-menu.png`) });
      await page.locator('#site-nav a[href="/#categories"]').click();
      await page.waitForTimeout(600);
      check(!(await page.locator('#site-nav').isVisible()), 'меню закрывается после выбора пункта');
      check(page.url().endsWith('#categories'), 'переход к разделу «Категории»');
      await toggle.click();
      await page.keyboard.press('Escape');
      check(!(await page.locator('#site-nav').isVisible()), 'меню закрывается по Escape');
    } else {
      check(!(await toggle.isVisible()), 'кнопка «Меню» скрыта на широком экране');
      check(await page.locator('#site-nav').isVisible(), 'навигация видна');
      await page.locator('#site-nav a[href="/#about"]').click();
      await page.waitForTimeout(600);
      check(page.url().endsWith('#about'), 'переход к разделу «О сервисе»');
    }

    // Поиск
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
    const search = page.locator('#catalog-search-input');
    check(await search.isVisible(), 'поисковая строка видна');
    const visibleCards = () => page.locator('#catalog-list > li:not([hidden])').count();
    await search.fill('плит');
    check((await visibleCards()) === 1, `«плит» → 1 карточка (${await visibleCards()})`);
    check(
      (await page.textContent('#catalog-search-status'))?.includes('Найдено: 1 калькулятор') ??
        false,
      'статус поиска «Найдено: 1 калькулятор»',
    );
    await search.fill('шпаклевка');
    check((await visibleCards()) === 1, `«шпаклевка» (без ё) → 1 карточка`);
    await search.fill('стены');
    check((await visibleCards()) >= 4, `«стены» → несколько карточек (${await visibleCards()})`);
    await search.fill('бетон');
    check((await visibleCards()) === 0, '«бетон» → 0 карточек');
    check(await page.locator('[data-catalog-empty]').isVisible(), 'сообщение «ничего не найдено»');
    await page.screenshot({ path: path.join(outDir, `${viewport.name}-search-empty.png`) });
    await search.fill('');
    check((await visibleCards()) === 6, 'пустой запрос возвращает все карточки');

    // Скриншот всей страницы
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(outDir, `${viewport.name}.png`), fullPage: true });

    check(consoleErrors.length === 0, `нет ошибок в консоли (${consoleErrors.join(' | ') || '0'})`);

    // 404 — после проверки консоли: браузер сам пишет в неё об ответе 404.
    const notFound = await page.goto(baseUrl + '/kalkulyatory/oboi/');
    check(notFound?.status() === 404, 'несуществующая страница калькулятора отдаёт 404');

    await context.close();
  }

  await browser.close();
} finally {
  try {
    process.kill(-server.pid);
  } catch {
    // сервер уже остановлен
  }
}

console.log(`\nСкриншоты: ${outDir}`);
if (failures.length > 0) {
  console.error(`\nПровалено проверок: ${failures.length}`);
  process.exit(1);
}
console.log('\nВсе проверки интерфейса пройдены.');
