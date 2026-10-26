/**
 * Проверка интерфейса в Chromium через Playwright.
 *
 * Использование: npm run build && npm run ui:check [-- <папка для скриншотов>]
 * Папка по умолчанию — .ui-check/ (в .gitignore).
 *
 * Playwright — devDependency проекта с точной версией (`npm ci`); браузер ставится отдельно:
 * `npx playwright install --with-deps --only-shell chromium` (в облачной среде Claude Code он предустановлен).
 * Запускается в CI после сборки и вручную. При любом провале — код выхода 1.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright не найден: выполните npm ci.');
  process.exit(2);
}

const outDir = path.resolve(process.argv[2] ?? '.ui-check');
const port = 4329;
const baseUrl = `http://localhost:${port}`;
const calcPath = '/kalkulyatory/oboi/';
const laminatePath = '/kalkulyatory/laminat/';
const paintPath = '/kalkulyatory/kraska/';
const tilePath = '/kalkulyatory/plitka/';
const plasterPath = '/kalkulyatory/shtukaturka/';
const puttyPath = '/kalkulyatory/shpaklevka/';
const calculatorPaths = [calcPath, laminatePath, paintPath, tilePath, puttyPath, plasterPath];
const catalogPath = '/kalkulyatory/';
/**
 * Адрес сайта, с которым собран dist/ (SITE_URL при сборке). С ним проверяется SEO-разметка
 * (canonical, og:image, JSON-LD, sitemap.xml), без него — что её нет.
 */
const siteOrigin = process.env.SITE_URL?.trim()
  ? new URL(process.env.SITE_URL.trim()).origin
  : null;
const viewports = [
  { name: '320', width: 320, height: 640, isMobile: true },
  { name: '390', width: 390, height: 844, isMobile: true },
  { name: '768', width: 768, height: 1024, isMobile: true },
  { name: '1440', width: 1440, height: 900, isMobile: false },
];
/** Подробные функциональные проверки — на одном мобильном и одном широком экране. */
const fullCheckViewports = new Set(['390', '1440']);

const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? '✓' : '✗'} ${message}`);
  if (!condition) failures.push(message);
};
/** Неразрывные пробелы из Intl → обычные, для сравнения текста. */
const plain = (text) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ').trim();

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

async function checkCommon(page, label) {
  const meta = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    charset: document.characterSet,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content'),
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    h1Count: document.querySelectorAll('h1').length,
  }));
  check(meta.lang === 'ru', `${label}: lang="ru"`);
  check(meta.charset === 'UTF-8', `${label}: кодировка UTF-8`);
  check((meta.description ?? '').length >= 50, `${label}: meta description заполнен`);
  check(meta.viewport?.includes('width=device-width') ?? false, `${label}: meta viewport`);
  check(meta.ogTitle === meta.title, `${label}: og:title совпадает с title`);
  check(meta.robots === null, `${label}: страница индексируется (нет meta robots)`);
  check(meta.h1Count === 1, `${label}: ровно один h1 (${meta.h1Count})`);
  return meta;
}

async function checkOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(
    overflow.scrollWidth <= overflow.clientWidth,
    `${label}: нет горизонтальной прокрутки (${overflow.scrollWidth} ≤ ${overflow.clientWidth})`,
  );
}

/**
 * Общие требования к полям форм (аудит, A11Y-1, A11Y-2, UI-1): единица измерения входит в подпись
 * словами (« (в метрах)»), рамка поля контрастна к фону (≥ 3:1, WCAG 1.4.11), поля одного ряда
 * начинаются на одном уровне, в одной колонке между полями ровно один промежуток сетки.
 */
async function checkFormFields(page, viewport) {
  for (const calculatorPath of calculatorPaths) {
    const label = `поля ${calculatorPath.split('/')[2]} ${viewport.name}`;
    await page.goto(baseUrl + calculatorPath, { waitUntil: 'networkidle' });
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(100);
    const result = await page.evaluate(() => {
      const parse = (color) => {
        const parts = color.match(/[\d.]+/g).map(Number);
        return parts.slice(0, 3);
      };
      const luminance = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const contrast = (a, b) => {
        const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
        return (x + 0.05) / (y + 0.05);
      };
      const background = (element) => {
        for (let e = element; e; e = e.parentElement) {
          const color = getComputedStyle(e).backgroundColor;
          if (!color.endsWith(', 0)') && color !== 'transparent') return parse(color);
        }
        return [255, 255, 255];
      };
      const noUnit = [];
      let minBorder = Infinity;
      for (const input of document.querySelectorAll('.field__input, .field__select')) {
        const field = input.closest('.field');
        const unit = field.querySelector('.field__unit');
        const labelText = field.querySelector('.field__label').textContent;
        if (unit && !/\S \(в [^()]+\)$/.test(labelText.trim())) noUnit.push(labelText.trim());
        if (input.getAttribute('aria-invalid') === 'true') continue;
        const border = parse(getComputedStyle(input).borderTopColor);
        minBorder = Math.min(
          minBorder,
          contrast(border, background(input)),
          contrast(border, background(field.parentElement)),
        );
      }
      const misaligned = [];
      const gaps = new Set();
      for (const group of document.querySelectorAll('.calc-group__fields')) {
        const fields = [...group.querySelectorAll(':scope > .field')];
        const rows = new Map();
        for (const field of fields) {
          const top = Math.round(field.getBoundingClientRect().top);
          rows.set(top, [...(rows.get(top) ?? []), field]);
        }
        for (const row of rows.values()) {
          const tops = row.map(
            (f) => f.querySelector('.field__control').getBoundingClientRect().top,
          );
          if (Math.max(...tops) - Math.min(...tops) > 1) {
            misaligned.push(row.map((f) => f.querySelector('[name]').name).join('+'));
          }
        }
        if (rows.size === fields.length) {
          for (let i = 1; i < fields.length; i++) {
            const body = fields[i - 1].querySelector('.field__body').getBoundingClientRect();
            const next = fields[i].getBoundingClientRect();
            gaps.add(Math.round(next.top - body.bottom));
          }
        }
      }
      return { noUnit, minBorder, misaligned, gaps: [...gaps] };
    });
    check(
      result.noUnit.length === 0,
      `${label}: единица в подписи словами (${result.noUnit.join(', ') || 'у всех'})`,
    );
    check(result.minBorder >= 3, `${label}: контраст рамки ${result.minBorder.toFixed(2)} ≥ 3`);
    check(
      result.misaligned.length === 0,
      `${label}: поля в рядах выровнены (${result.misaligned.join(', ') || 'да'})`,
    );
    check(
      result.gaps.every((gap) => gap === 16),
      `${label}: промежуток между полями в колонке 16 px (${result.gaps.join(', ') || '—'})`,
    );
  }
}

/** SEO-разметка и файлы для поисковых систем: один раз, на широком экране. */
async function checkSeo(page) {
  const mode = siteOrigin ? `SEO (${siteOrigin})` : 'SEO без SITE_URL';
  const readHead = () =>
    page.evaluate(() => {
      const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) ?? null;
      return {
        canonical: attr('link[rel="canonical"]', 'href'),
        ogUrl: attr('meta[property="og:url"]', 'content'),
        ogImage: attr('meta[property="og:image"]', 'content'),
        ogImageSize: `${attr('meta[property="og:image:width"]', 'content')}×${attr('meta[property="og:image:height"]', 'content')}`,
        ogImageAlt: attr('meta[property="og:image:alt"]', 'content'),
        twitterCard: attr('meta[name="twitter:card"]', 'content'),
        robots: attr('meta[name="robots"]', 'content'),
        jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
          (script) => script.textContent,
        ),
        crumbs: [...document.querySelectorAll('.breadcrumbs__item')].map((item) =>
          item.textContent.trim(),
        ),
      };
    });

  for (const pagePath of ['/', catalogPath, ...calculatorPaths]) {
    const label = `${mode} ${pagePath}`;
    await page.goto(baseUrl + pagePath, { waitUntil: 'networkidle' });
    const head = await readHead();
    if (!siteOrigin) {
      check(
        !head.canonical && !head.ogUrl && !head.ogImage && !head.twitterCard,
        `${label}: нет canonical, og:url, og:image и twitter:card`,
      );
      check(head.jsonLd.length === 0, `${label}: нет JSON-LD`);
      continue;
    }
    const expected = siteOrigin + pagePath;
    check(head.canonical === expected, `${label}: canonical ${head.canonical}`);
    check(head.ogUrl === expected, `${label}: og:url совпадает с canonical`);
    check(
      head.ogImage === `${siteOrigin}/og.png` &&
        head.ogImageSize === '1200×630' &&
        Boolean(head.ogImageAlt) &&
        head.twitterCard === 'summary_large_image',
      `${label}: og:image ${head.ogImage}, ${head.ogImageSize}, alt, twitter:card`,
    );
    if (pagePath === '/') {
      check(head.jsonLd.length === 0, `${label}: на главной нет JSON-LD`);
      continue;
    }
    let list;
    try {
      list = head.jsonLd.length === 1 ? JSON.parse(head.jsonLd[0]) : null;
    } catch {
      list = null;
    }
    check(
      list?.['@type'] === 'BreadcrumbList',
      `${label}: один JSON-LD BreadcrumbList, разбирается JSON.parse`,
    );
    const items = list?.itemListElement ?? [];
    check(
      items.map((item) => item.name).join(' / ') === head.crumbs.join(' / ') &&
        items.every((item, index) => item.position === index + 1),
      `${label}: BreadcrumbList совпадает с видимой цепочкой (${head.crumbs.join(' / ')})`,
    );
    check(
      items.every((item) => item.item.startsWith(`${siteOrigin}/`)) &&
        items.at(-1)?.item === expected,
      `${label}: адреса в BreadcrumbList абсолютные, последний — canonical`,
    );
    check(
      items[1]?.item === siteOrigin + catalogPath,
      `${label}: второй пункт BreadcrumbList — каталог ${items[1]?.item}`,
    );
  }

  const notFound = await page.goto(baseUrl + '/kalkulyatory/nesushchestvuyushchiy/');
  const head404 = await readHead();
  check(
    notFound?.status() === 404 &&
      head404.robots === 'noindex' &&
      !head404.canonical &&
      !head404.ogUrl,
    `${mode} 404: noindex, без canonical и og:url`,
  );

  const robots = await fetch(`${baseUrl}/robots.txt`);
  const robotsText = robots.ok ? await robots.text() : '';
  check(
    robots.ok && robotsText.startsWith('User-agent: *\nAllow: /') && !/^host:/im.test(robotsText),
    `${mode}: robots.txt разрешает всё, без Host`,
  );
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  if (!siteOrigin) {
    check(!/^sitemap:/im.test(robotsText), `${mode}: в robots.txt нет строки Sitemap`);
    check(sitemap.status === 404, `${mode}: sitemap.xml не создан (${sitemap.status})`);
    return;
  }
  check(
    robotsText.includes(`\nSitemap: ${siteOrigin}/sitemap.xml\n`),
    `${mode}: robots.txt ссылается на абсолютный sitemap.xml`,
  );
  const xml = sitemap.ok ? await sitemap.text() : '';
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  const expectedLocs = ['/', catalogPath, ...calculatorPaths].map(
    (pagePath) => siteOrigin + pagePath,
  );
  check(
    sitemap.ok &&
      [...locs].sort().join() === [...expectedLocs].sort().join() &&
      !xml.includes('lastmod'),
    `${mode}: sitemap.xml — главная, каталог и ${calculatorPaths.length} калькуляторов (${locs.length} адресов), без lastmod`,
  );
  const statuses = await Promise.all(
    locs.map(async (loc) => (await fetch(baseUrl + new URL(loc).pathname)).status),
  );
  check(
    statuses.every((status) => status === 200),
    `${mode}: все адреса из sitemap.xml отвечают 200`,
  );
  const og = await fetch(`${baseUrl}/og.png`);
  check(
    og.ok && og.headers.get('content-type') === 'image/png',
    `${mode}: /og.png отдаётся (${og.status}, ${og.headers.get('content-type')})`,
  );
}

/** Пункт меню «Калькуляторы» с aria-current="page" — только в разделе каталога и калькуляторов. */
async function currentNav(page) {
  return page.$$eval('#site-nav a[aria-current="page"]', (links) =>
    links.map((a) => a.getAttribute('href')),
  );
}

/** Страница каталога /kalkulyatory/: все опубликованные калькуляторы по разделам, поиск. */
async function checkCatalogPage(page, viewport) {
  const label = `каталог ${viewport.name}`;
  const response = await page.goto(baseUrl + catalogPath, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(
    meta.title.startsWith('Строительные калькуляторы онлайн'),
    `${label}: title «${meta.title}»`,
  );
  check(
    plain(await page.textContent('h1')) === 'Строительные калькуляторы онлайн',
    `${label}: h1 под запрос`,
  );
  const links = await page.$$eval('#catalog-groups .calc-card a', (items) =>
    items.map((a) => a.getAttribute('href')),
  );
  check(
    [...links].sort().join() === [...calculatorPaths].sort().join(),
    `${label}: карточки — ссылки на все ${calculatorPaths.length} опубликованных калькуляторов`,
  );
  const statuses = await Promise.all(
    links.map(async (href) => (await fetch(baseUrl + href)).status),
  );
  check(
    statuses.every((status) => status === 200),
    `${label}: все карточки ведут на страницы с ответом 200`,
  );
  check(
    (await page.locator('#catalog-groups .badge--soon').count()) === 0,
    `${label}: нет карточек «Скоро»`,
  );
  check(
    (await currentNav(page)).join() === catalogPath,
    `${label}: aria-current="page" у пункта «Калькуляторы»`,
  );
  await checkOverflow(page, label);
  if (!fullCheckViewports.has(viewport.name)) return;

  const search = page.locator('#catalog-search-input');
  const visibleCards = () => page.locator('#catalog-groups .calc-card-item:not([hidden])').count();
  await search.fill('плитка');
  check((await visibleCards()) === 1, `${label}: поиск «плитка» — одна карточка`);
  await search.fill('несуществующий материал');
  check(
    (await visibleCards()) === 0 &&
      (await page.locator('#catalog-groups .catalog-group:not([hidden])').count()) === 0 &&
      (await page.locator('[data-catalog-empty]').isVisible()),
    `${label}: ничего не найдено — разделы скрыты, сообщение видно`,
  );
  await search.fill('');
  check(
    (await visibleCards()) === calculatorPaths.length,
    `${label}: пустой запрос — все карточки`,
  );
  await page.screenshot({
    path: path.join(outDir, `catalog-${viewport.name}.png`),
    fullPage: true,
  });
}

/** «Другие калькуляторы» внизу каждой страницы калькулятора и текущий пункт меню. */
async function checkRelated(page, viewport) {
  for (const calculatorPath of calculatorPaths) {
    const label = `другие калькуляторы ${calculatorPath.split('/')[2]} ${viewport.name}`;
    await page.goto(baseUrl + calculatorPath, { waitUntil: 'networkidle' });
    const block = page.locator('[data-related]');
    const hrefs = await block
      .locator('.related__list a')
      .evaluateAll((items) => items.map((a) => a.getAttribute('href')));
    check(
      (await block.count()) === 1 &&
        hrefs.length >= 1 &&
        hrefs.length <= 4 &&
        !hrefs.includes(calculatorPath) &&
        hrefs.every((href) => calculatorPaths.includes(href)),
      `${label}: ${hrefs.length} ссылок на другие опубликованные калькуляторы, без себя`,
    );
    check(
      (await block.locator(`a[href="${catalogPath}"]`).count()) === 1,
      `${label}: ссылка «Все калькуляторы» на каталог`,
    );
    const afterFaq = await page.evaluate(() => {
      const faq = document.querySelector('.faq');
      const related = document.querySelector('[data-related]');
      return Boolean(
        faq && related && faq.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    check(afterFaq, `${label}: блок после FAQ`);
    const targets = await block
      .locator('a')
      .evaluateAll((items) =>
        items.map((a) =>
          Math.round(Math.min(a.getBoundingClientRect().height, a.getBoundingClientRect().width)),
        ),
      );
    check(
      targets.every((size) => size >= 44),
      `${label}: зоны нажатия ≥ 44 px (${Math.min(...targets)})`,
    );
    check(
      (await currentNav(page)).join() === catalogPath,
      `${label}: aria-current="page" у пункта «Калькуляторы»`,
    );
  }
  if (viewport.name === '390' || viewport.name === '1440') {
    await page.goto(baseUrl + plasterPath, { waitUntil: 'networkidle' });
    await page.locator('[data-related]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `related-${viewport.name}.png`) });
  }
}

/**
 * Обход сайта: все внутренние ссылки со всех страниц, начиная с главной, отвечают 200,
 * а якоря существуют на странице назначения.
 */
async function crawlSite() {
  const pages = new Map();
  const queue = ['/'];
  const broken = [];
  const fetchPage = async (pathname) => {
    if (!pages.has(pathname)) {
      const response = await fetch(baseUrl + pathname);
      const type = response.headers.get('content-type') ?? '';
      pages.set(pathname, {
        status: response.status,
        html: type.includes('text/html') ? await response.text() : '',
      });
    }
    return pages.get(pathname);
  };
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    const { html } = await fetchPage(from);
    for (const [, href] of html.matchAll(/<a\b[^>]*?\bhref="([^"]*)"/g)) {
      const url = new URL(href, baseUrl + from);
      if (url.origin !== baseUrl) continue;
      const target = await fetchPage(url.pathname);
      if (target.status !== 200) broken.push(`${from} → ${href} (${target.status})`);
      else if (url.hash && !target.html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)) {
        broken.push(`${from} → ${href} (нет якоря)`);
      }
      if (target.html && !queue.includes(url.pathname)) queue.push(url.pathname);
    }
  }
  check(
    broken.length === 0 && queue.length >= calculatorPaths.length + 2,
    `обход сайта: ${queue.length} страниц, все внутренние ссылки и якоря отвечают 200 ${broken.join('; ')}`,
  );
  check(
    queue.includes(catalogPath) &&
      calculatorPaths.every((calculatorPath) => queue.includes(calculatorPath)),
    'обход сайта: каталог и все калькуляторы достижимы по ссылкам с главной',
  );
}

/**
 * Ориентиры расхода (выбор «Тип материала»): подстановка в поле, результат по ориентиру, пометка в результате,
 * переключение на «Своё значение» при ручной правке, сброс. Ожидаемые числа посчитаны вручную по формулам
 * PAINT.md, PLASTER.md, PUTTY.md.
 */
async function checkPresets(page, viewport) {
  const cases = [
    {
      path: paintPath,
      field: 'coverage',
      preset: 'paint-interior',
      fieldText: '7',
      fill: { roomLength: '4', roomWidth: '3', wallHeight: '2,7' },
      // 37,8 м² × 2 слоя ÷ 7 м²/л = 10,8 л; с запасом 10 % — 11,88 → 11,9.
      out: ['litersWithReserve', '11,9'],
      note: 'водно-дисперсионной интерьерной краски',
      range: 'от 7 до 14 м²/л',
      manual: '8',
    },
    {
      path: plasterPath,
      field: 'consumption',
      preset: 'plaster-gypsum',
      fieldText: '1',
      fill: { wallLength: '5', wallHeight: '2,7' },
      // 13,5 м² × 10 мм × 1 = 135 кг; с запасом 10 % — 148,5.
      out: ['massWithReserve', '148,5'],
      note: 'гипсовой штукатурки',
      range: 'от 0,8 до 1,3 кг/м² на 1 мм',
      manual: '1,2',
    },
    {
      path: puttyPath,
      field: 'consumption',
      preset: 'putty-gypsum-finish',
      fieldText: '0,9',
      fill: { wallLength: '5', wallHeight: '2,7' },
      // 13,5 м² × 0,9 кг/м² × 1 слой = 12,15 кг; с запасом 10 % — 13,365 → 13,4.
      out: ['massWithReserve', '13,4'],
      note: 'гипсовой финишной шпаклёвки',
      range: 'от 0,9 до 1 кг/м² при слое 1 мм',
      manual: '1,2',
    },
  ];
  for (const item of cases) {
    const label = `ориентир ${item.path.split('/')[2]} ${viewport.name}`;
    await page.goto(baseUrl + item.path, { waitUntil: 'networkidle' });
    const select = page.locator(`select[name="${item.field}Preset"]`);
    const input = page.locator(`input[name="${item.field}"]`);
    const note = page.locator(`[data-preset-note="${item.field}"]`);
    const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
    const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());

    const wiring = await page.evaluate((field) => {
      const sel = document.querySelector(`select[name="${field}Preset"]`);
      const inp = document.querySelector(`input[name="${field}"]`);
      const hint = document.getElementById(
        (inp?.getAttribute('aria-describedby') ?? '').split(' ')[0],
      );
      return {
        controls: sel?.getAttribute('aria-controls') === inp?.id,
        label: Boolean(sel?.labels?.length),
        hint: (hint?.textContent ?? '').includes('ориентир'),
        height: Math.round(sel?.getBoundingClientRect().height ?? 0),
      };
    }, item.field);
    check(
      wiring.controls && wiring.label && wiring.hint && wiring.height >= 44,
      `${label}: выбор с подписью связан с полем (aria-controls), подсказка поля об ориентире, высота ${wiring.height} px`,
    );
    check(
      (await select.inputValue()) === '' && (await input.inputValue()) === '',
      `${label}: по умолчанию «Своё значение», поле пустое`,
    );

    // Штукатурка и шпаклёвка: ожидаемые числа — для одной стены 5 × 2,7 м (режим «стены»).
    if (item.path !== paintPath) await page.selectOption('[name="mode"]', 'walls');
    for (const [name, value] of Object.entries(item.fill))
      await page.fill(`[name="${name}"]`, value);
    await select.focus();
    await select.selectOption(item.preset);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('name'));
    check(
      (await input.inputValue()) === item.fieldText && focused === `${item.field}Preset`,
      `${label}: выбор подставил ${item.fieldText}, фокус остался на выборе`,
    );
    await page.locator('form button[type="submit"]').click();
    check(
      (await state()) === 'ready' && (await out(item.out[0])) === item.out[1],
      `${label}: результат по ориентиру — ${item.out[1]}`,
    );
    check(
      (await note.isVisible()) &&
        plain(await note.textContent()) ===
          `Ориентир для ${item.note}; у разных марок ${item.range} — сверьте с упаковкой.`,
      `${label}: пометка «Ориентир для ${item.note}; у разных марок ${item.range} — сверьте с упаковкой»`,
    );

    await input.fill(item.manual);
    check(
      (await select.inputValue()) === '' &&
        !(await note.isVisible()) &&
        (await state()) === 'ready',
      `${label}: ручная правка — «Своё значение», пометки нет`,
    );
    await select.selectOption(item.preset);
    check(
      (await input.inputValue()) === item.fieldText && (await note.isVisible()),
      `${label}: повторный выбор снова подставляет ориентир и пересчитывает`,
    );
    await checkOverflow(page, label);
    if (item.path === plasterPath) {
      await page.locator(`select[name="${item.field}Preset"]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(outDir, `preset-plaster-${viewport.name}.png`) });
    }
    await page.locator('form button[type="reset"]').click();
    await page.waitForTimeout(100);
    check(
      (await select.inputValue()) === '' &&
        (await input.inputValue()) === '' &&
        (await state()) === 'empty',
      `${label}: «Сбросить» — исходное состояние`,
    );
  }
}

/**
 * Панель итога на телефоне (UX-1, D-024) — общий механизм форм, проверяется на краске; на 390 px ещё
 * снимок ламината с панелью. На 1440 px панели нет.
 */
async function checkResultBar(page, viewport) {
  const label = `панель итога ${viewport.name}`;
  await page.goto(baseUrl + paintPath, { waitUntil: 'networkidle' });
  const bar = page.locator('[data-result-bar]');
  const barText = async () => plain(await page.locator('[data-result-bar-text]').textContent());
  const announced = async () => plain(await page.locator('[data-result-announce]').textContent());
  const field = (name) => page.locator(`form [name="${name}"]`);
  const toTop = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    // Кадр на пересчёт и 200 мс анимации появления.
    await page.waitForTimeout(350);
  };

  await field('roomLength').fill('4');
  await field('roomWidth').fill('3');
  await field('wallHeight').fill('2,7');
  await field('coverage').fill('8');
  await field('canVolume').fill('2,7');
  await toTop();
  check(!(await bar.isVisible()), `${label}: до расчёта панели нет`);

  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(150);
  check(
    !(await bar.isVisible()) &&
      (await page.evaluate(() => document.activeElement?.hasAttribute('data-result-heading'))),
    `${label}: сразу после «Рассчитать» результат на экране — панели нет`,
  );
  // Не live-регион: объявляет только скрытая область результата.
  const roles = await page.evaluate(() => ({
    bar: document.querySelector('[data-result-bar]')?.closest('[role="status"], [aria-live]'),
    main: document.querySelector('.calc-result__main')?.getAttribute('role'),
  }));
  check(
    !roles.bar && roles.main === null,
    `${label}: панель и число — не live-регионы (объявляет [data-result-announce])`,
  );
  // 37,8 м² × 2 слоя ÷ 8 = 9,45 л; с запасом 10 % — 10,395 → 10,4 л; банок по 2,7 л — ⌈3,85⌉ = 4.
  check(
    (await announced()) === 'Результат: 10,4 л краски · 4 банки',
    `${label}: по «Рассчитать» объявлен итог («${await announced()}»)`,
  );

  await toTop();
  if (viewport.name === '1440') {
    check(
      !(await bar.isVisible()) &&
        !(await page.evaluate(() =>
          document.documentElement.hasAttribute('data-result-bar-shown'),
        )),
      `${label}: на широком экране панели нет`,
    );
    return;
  }
  check(
    (await bar.isVisible()) && (await barText()) === '10,4 л краски · 4 банки',
    `${label}: после расчёта и прокрутки вверх — панель «${await barText()}»`,
  );
  const size = await bar.evaluate((element) => ({
    bar: element.getBoundingClientRect().height,
    action: element.querySelector('.result-bar__action')?.getBoundingClientRect().height ?? 0,
    bottom: Math.round(element.getBoundingClientRect().bottom),
    text: element.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  check(
    size.bar >= 44 && size.action >= 44 && size.bottom === viewport.height,
    `${label}: панель у нижнего края, высота ${size.bar} px, «К результату» ${size.action} px`,
  );
  check(
    size.text === '10,4 л краски · 4 банки К результату',
    `${label}: подпись кнопки «${size.text}»`,
  );
  await page.screenshot({ path: path.join(outDir, `result-bar-paint-${viewport.name}.png`) });
  await checkOverflow(page, `${label}, панель видна`);

  // Правка параметра: итог в панели меняется сразу, диктор — после паузы ввода.
  await field('coverage').fill('7');
  await page.waitForTimeout(150);
  // 37,8 × 2 ÷ 7 = 10,8 л; с запасом — 11,88 → 11,9 л; банок ⌈4,4⌉ = 5.
  check(
    (await bar.isVisible()) && (await barText()) === '11,9 л краски · 5 банок',
    `${label}: правка укрывистости — в панели «${await barText()}»`,
  );
  check(
    (await announced()) === 'Результат: 10,4 л краски · 4 банки',
    `${label}: во время ввода диктор не объявляет новый итог`,
  );
  await page.waitForTimeout(1100);
  check(
    (await announced()) === 'Результат: 11,9 л краски · 5 банок',
    `${label}: после паузы ввода ~1 с объявлен новый итог`,
  );

  await field('coverage').fill('');
  await page.waitForTimeout(150);
  check(
    (await bar.isVisible()) &&
      (await barText()) === 'Исправьте значения в полях' &&
      (await bar.getAttribute('data-tone')) === 'invalid',
    `${label}: ошибка в поле — «${await barText()}»`,
  );
  await field('coverage').fill('7');
  await page.waitForTimeout(150);

  // Экранная клавиатура (эмуляция старого Android: окно уменьшается) — панель прячется.
  await field('coverage').focus();
  await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.5) });
  await page.waitForTimeout(200);
  const hiddenWithKeyboard = !(await bar.isVisible());
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(200);
  check(
    hiddenWithKeyboard && (await bar.isVisible()),
    `${label}: окно ниже 75 % при фокусе в поле (клавиатура) — панели нет, после — снова есть`,
  );

  // Фокус с клавиатуры по всем полям и кнопкам формы: ничто не уходит под панель.
  await toTop();
  await field('roomLength').focus();
  const covered = [];
  const visited = [];
  for (let step = 0; step < 30; step += 1) {
    await page.waitForTimeout(60);
    const hit = await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.querySelector('[data-result-bar]');
      if (!(active instanceof HTMLElement) || !active.closest('form')) return { done: true };
      const name = active.getAttribute('name') ?? active.textContent?.trim() ?? '';
      if (!panel || panel.hidden) return { done: false, name, covered: false };
      const top = panel.getBoundingClientRect().top;
      return { done: false, name, covered: active.getBoundingClientRect().bottom > top };
    });
    if (hit.done) break;
    visited.push(hit.name);
    if (hit.covered) covered.push(hit.name);
    await page.keyboard.press('Tab');
  }
  check(
    covered.length === 0 && visited.length >= 12 && visited.at(-1) === 'Сбросить',
    `${label}: Tab по ${visited.length} элементам формы до «Сбросить» — ни один не под панелью ${covered.join(', ')}`,
  );

  // Нажатие: плавная прокрутка к результату и фокус на заголовке.
  await toTop();
  await bar.click();
  await page.waitForTimeout(900);
  const landed = await page.evaluate(() => {
    const heading = document.querySelector('[data-result-heading]');
    const rect = heading?.getBoundingClientRect();
    return {
      focused: document.activeElement === heading,
      inView: rect ? rect.top >= 0 && rect.bottom <= window.innerHeight : false,
    };
  });
  check(
    landed.focused && landed.inView && !(await bar.isVisible()),
    `${label}: «К результату» — заголовок результата на экране и в фокусе, панель скрыта`,
  );

  await page.locator('form button[type="reset"]').click();
  await page.waitForTimeout(150);
  await toTop();
  check(
    !(await bar.isVisible()) &&
      !(await page.evaluate(() =>
        document.documentElement.hasAttribute('data-result-bar-shown'),
      )) &&
      (await announced()) === '',
    `${label}: «Сбросить» скрывает панель и очищает объявление`,
  );

  if (viewport.name !== '390') return;
  // Снимок ламината с панелью (К13 → 8 упаковок).
  await page.goto(baseUrl + laminatePath, { waitUntil: 'networkidle' });
  const values = { roomLength: '4', roomWidth: '3,5', boardLength: '1380', boardWidth: '193' };
  for (const [name, value] of Object.entries({ ...values, boardsPerPack: '8' }))
    await field(name).fill(value);
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(150);
  await toTop();
  check(
    (await bar.isVisible()) && (await barText()) === '8 упаковок',
    `ламинат ${viewport.name}: панель итога «${await barText()}»`,
  );
  await checkOverflow(page, `ламинат ${viewport.name}, панель видна`);
  await page.screenshot({ path: path.join(outDir, `result-bar-laminate-${viewport.name}.png`) });
}

const roomKey = 'domraschet:room';

/** Новый контекст браузера с ширинами viewport; ошибки консоли — в `errors`. */
async function freshPage(browser, viewport, errors, init) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    locale: 'ru-RU',
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page };
}

/**
 * Размеры комнаты между калькуляторами (D-026): расчёт в краске → в шпаклёвке подставлены, строка с «Очистить»;
 * ламинат — длина и ширина; плитка и режим «стены» — без запоминания; хранилище запрещено — без ошибок.
 */
async function checkRoomMemory(browser, viewport) {
  const label = `размеры комнаты ${viewport.name}`;
  const errors = [];
  const { context, page } = await freshPage(browser, viewport, errors);
  const stored = () => page.evaluate((key) => window.localStorage.getItem(key), roomKey);
  const value = (name) => page.locator(`form [name="${name}"]`).inputValue();
  const notice = page.locator('[data-room-notice]');

  await page.goto(baseUrl + paintPath, { waitUntil: 'networkidle' });
  for (const [name, text] of Object.entries({
    roomLength: '4',
    roomWidth: '3',
    wallHeight: '2,7',
    coverage: '8',
  }))
    await page.fill(`form [name="${name}"]`, text);
  check((await stored()) === null, `${label}: до расчёта ничего не сохранено`);
  await page.locator('form button[type="submit"]').click();
  check(
    (await stored()) === '{"v":1,"roomLength":4,"roomWidth":3,"wallHeight":2.7}',
    `${label}: после расчёта в краске сохранены только три размера (${await stored()})`,
  );

  await page.goto(baseUrl + puttyPath, { waitUntil: 'networkidle' });
  const filled = [await value('roomLength'), await value('roomWidth'), await value('wallHeight')];
  check(
    filled.join(' ') === '4 3 2,7' &&
      (await page.locator('[data-calculator-result]').getAttribute('data-state')) === 'empty',
    `${label}: в шпаклёвке подставлены 4 × 3 × 2,7, расчёт сам не запущен`,
  );
  const noticeText = plain(await notice.textContent());
  const clearButton = notice.locator('button');
  const clearHeight = await clearButton.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  check(
    (await notice.isVisible()) &&
      noticeText === 'Размеры комнаты подставлены из прошлого расчёта: 4 × 3 × 2,7 м · Очистить' &&
      clearHeight >= 44,
    `${label}: строка «${noticeText}», «Очистить» ${clearHeight} px`,
  );
  await checkOverflow(page, `${label}, строка над формой`);
  if (viewport.name === '390') {
    await notice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `room-memory-${viewport.name}.png`) });
  }
  await clearButton.click();
  check(
    (await value('roomLength')) === '' &&
      (await value('wallHeight')) === '' &&
      (await notice.count()) === 0 &&
      (await stored()) === null &&
      (await page.evaluate(() => document.activeElement?.getAttribute('name'))) === 'roomLength',
    `${label}: «Очистить» — поля пусты, строки нет, сохранённое удалено, фокус на длине`,
  );

  // Режим «отдельные стены» не меняет размеров комнаты.
  await page.goto(baseUrl + plasterPath, { waitUntil: 'networkidle' });
  await page.selectOption('form [name="mode"]', 'walls');
  for (const [name, text] of Object.entries({
    wallLength: '5',
    wallHeight: '2,5',
    consumption: '1',
  }))
    await page.fill(`form [name="${name}"]`, text);
  await page.locator('form button[type="submit"]').click();
  check(
    (await stored()) === null,
    `${label}: расчёт отдельной стены в штукатурке ничего не сохраняет`,
  );

  await page.evaluate(
    (key) =>
      window.localStorage.setItem(key, '{"v":1,"roomLength":4,"roomWidth":3,"wallHeight":2.7}'),
    roomKey,
  );
  await page.goto(baseUrl + laminatePath, { waitUntil: 'networkidle' });
  check(
    (await value('roomLength')) === '4' &&
      (await value('roomWidth')) === '3' &&
      plain(await notice.textContent()).includes(': 4 × 3 м'),
    `${label}: ламинат — подставлены длина и ширина «4 × 3 м»`,
  );
  await page.goto(baseUrl + tilePath, { waitUntil: 'networkidle' });
  check(
    (await notice.count()) === 0 && (await value('surfaceLength')) === '',
    `${label}: плитка — ничего не подставлено`,
  );
  await page.evaluate(
    (key) => window.localStorage.setItem(key, '{"v":0,"roomLength":4,"roomWidth":3}'),
    roomKey,
  );
  await page.goto(baseUrl + calcPath, { waitUntil: 'networkidle' });
  check(
    (await notice.count()) === 0 && (await value('roomLength')) === '',
    `${label}: запись старой версии формата не читается`,
  );
  await context.close();

  // Хранилище запрещено (приватный режим, запрет сайтам хранить данные).
  const denied = await freshPage(browser, viewport, errors, () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Хранилище запрещено', 'SecurityError');
      },
    });
  });
  await denied.page.goto(baseUrl + paintPath, { waitUntil: 'networkidle' });
  for (const [name, text] of Object.entries({
    roomLength: '4',
    roomWidth: '3',
    wallHeight: '2,7',
    coverage: '8',
  }))
    await denied.page.fill(`form [name="${name}"]`, text);
  await denied.page.locator('form button[type="submit"]').click();
  const deniedState = await denied.page
    .locator('[data-calculator-result]')
    .getAttribute('data-state');
  await denied.page.goto(baseUrl + puttyPath, { waitUntil: 'networkidle' });
  check(
    deniedState === 'ready' && (await denied.page.locator('[data-room-notice]').count()) === 0,
    `${label}: хранилище запрещено — расчёт работает, подстановки нет`,
  );
  await denied.context.close();
  check(errors.length === 0, `${label}: нет ошибок в консоли (${errors.join(' | ') || '0'})`);
}

/**
 * Ссылка на расчёт и «Скопировать итог» (D-027) на шпаклёвке (Шп10): буфер обмена, ссылка в новом контексте —
 * та же форма и тот же результат, приоритет над сохранёнными размерами, битые ссылки, буфер недоступен.
 */
async function checkShare(browser, viewport) {
  const label = `ссылка на расчёт ${viewport.name}`;
  const errors = [];
  const { context, page } = await freshPage(browser, viewport, errors);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const status = page.locator('[data-share-status]');

  await page.goto(baseUrl + puttyPath, { waitUntil: 'networkidle' });
  check(
    !(await page.locator('[data-share]').isVisible()),
    `${label}: до расчёта кнопок нет (блок результата пуст)`,
  );
  await fillPuttyRoom(page);
  const buttons = page.locator('[data-share] button');
  const heights = await buttons.evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().height)),
  );
  check(
    (await buttons.count()) === 2 && heights.every((height) => height >= 44),
    `${label}: после расчёта — полоса «Скопировать» и «Поделиться», высота ${heights.join(' / ')} px`,
  );
  await checkOverflow(page, `${label}, кнопки в результате`);

  await page.locator('[data-share-link]').click();
  await page.waitForTimeout(150);
  const url = await clipboard();
  const expectedQuery =
    'v=1&mode=room&roomLength=4&roomWidth=3&wallHeight=2.7&openingsArea=3.9&ceiling=yes&layers=2' +
    '&consumption=1.1&packMass=20&reserve=10';
  check(
    url === `${baseUrl}${puttyPath}?${expectedQuery}`,
    `${label}: в буфере ссылка со значениями видимых полей (${url})`,
  );
  check(
    plain(await status.textContent()) === 'Скопировано',
    `${label}: подтверждение «Скопировано»`,
  );

  await page.locator('[data-share-copy]').click();
  await page.waitForTimeout(150);
  const text = await clipboard();
  const expectedText = [
    'Список покупок · Калькулятор шпаклёвки (ДомРасчёт)',
    '□ 6 упаковок по 20 кг (120 кг)',
    '',
    'Исходные данные:',
    '— Площадь 45,9 м² (с потолком)',
    '— 2 слоя по 1,1 кг/м², запас 10 %',
    '',
    `Расчёт с формулами: ${url}`,
  ].join('\n');
  check(
    plain(text) === plain(expectedText),
    `${label}: «Скопировать» — список покупок ${JSON.stringify(text)}`,
  );
  if (viewport.name !== '320') {
    await page.locator('[data-share]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `share-${viewport.name}.png`) });
  }
  await context.close();

  // Ссылка в новой вкладке другого браузера: форма заполнена, результат тот же; сохранённые размеры не мешают.
  const opened = await freshPage(browser, viewport, errors, (key) => {
    window.localStorage.setItem(key, '{"v":1,"roomLength":6,"roomWidth":5,"wallHeight":3}');
  });
  const other = opened.page;
  await other.goto(url, { waitUntil: 'networkidle' });
  const value = (name) => other.locator(`form [name="${name}"]`).inputValue();
  const outOther = async (name) => plain(await other.locator(`[data-out="${name}"]`).textContent());
  check(
    (await other.locator('[data-calculator-result]').getAttribute('data-state')) === 'ready' &&
      (await value('mode')) === 'room' &&
      (await value('roomLength')) === '4' &&
      (await value('wallHeight')) === '2,7' &&
      (await value('ceiling')) === 'yes' &&
      (await outOther('massWithReserve')) === '111,1' &&
      (await outOther('packs')) === '6',
    `${label}: открытая ссылка заполнила форму и сразу показала 111,1 кг, 6 упаковок`,
  );
  check(
    (await other.locator('[data-room-notice]').count()) === 0,
    `${label}: значения ссылки важнее сохранённых размеров (6 × 5 × 3 не подставлены)`,
  );
  const canonical = await other
    .locator('link[rel="canonical"]')
    .getAttribute('href')
    .catch(() => null);
  check(
    siteOrigin ? canonical === `${siteOrigin}${puttyPath}` : canonical === null,
    `${label}: canonical без параметров (${canonical ?? 'нет — сборка без SITE_URL'})`,
  );

  // Битые ссылки: буквы вместо чисел, лишние и неизвестные параметры, без версии.
  await other.goto(
    `${baseUrl}${puttyPath}?v=1&roomLength=abc&roomWidth=3&mode=ceiling&wallHeight=%3Cscript%3E&utm_source=x&layers=1e400`,
    { waitUntil: 'networkidle' },
  );
  check(
    (await other.locator('[data-calculator-result]').getAttribute('data-state')) === 'invalid' &&
      (await value('roomLength')) === '' &&
      (await value('roomWidth')) === '3' &&
      (await value('mode')) === 'room' &&
      (await value('wallHeight')) === '',
    `${label}: битая ссылка — неверные параметры пропущены, остальное проверено полями`,
  );
  await other.goto(`${baseUrl}${puttyPath}?roomLength=4&roomWidth=3`, { waitUntil: 'networkidle' });
  check(
    (await other.locator('[data-calculator-result]').getAttribute('data-state')) === 'empty',
    `${label}: параметры без v=1 — не ссылка на расчёт, форма не считается`,
  );
  await opened.context.close();

  // Буфер обмена недоступен — ссылка в поле, выделена для копирования вручную.
  const noClipboard = await freshPage(browser, viewport, errors, () => {
    Object.defineProperty(navigator, 'clipboard', { get: () => undefined });
  });
  await noClipboard.page.goto(url, { waitUntil: 'networkidle' });
  await noClipboard.page.locator('[data-share-link]').click();
  await noClipboard.page.waitForTimeout(150);
  const manual = await noClipboard.page.evaluate(() => {
    const area = document.querySelector('[data-share-text]');
    return {
      visible: area instanceof HTMLTextAreaElement && area.offsetParent !== null,
      value: area instanceof HTMLTextAreaElement ? area.value : '',
      focused: document.activeElement === area,
      selected:
        area instanceof HTMLTextAreaElement &&
        area.selectionEnd - area.selectionStart === area.value.length,
    };
  });
  check(
    manual.visible && manual.value === url && manual.focused && manual.selected,
    `${label}: буфер недоступен — ссылка в поле, в фокусе и выделена`,
  );
  await checkOverflow(noClipboard.page, `${label}, поле для копирования`);
  await noClipboard.context.close();
  check(errors.length === 0, `${label}: нет ошибок в консоли (${errors.join(' | ') || '0'})`);
}

/**
 * Высокая контрастность (forced-colors): тени отключены — у элемента в фокусе должен быть видимый outline
 * (ссылки, кнопки, поля, списки, поиск, «Очистить», кнопки ссылки, панель итога).
 */
async function checkForcedColors(browser, viewport) {
  const label = `высокая контрастность ${viewport.name}`;
  const errors = [];
  const { context, page } = await freshPage(browser, viewport, errors);
  await page.emulateMedia({ forcedColors: 'active' });
  const focusOutline = (selector) =>
    page.evaluate((target) => {
      const element = document.querySelector(target);
      if (!(element instanceof HTMLElement)) return { found: false };
      element.focus();
      const style = getComputedStyle(element);
      const color = style.outlineColor;
      const transparent = color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
      return {
        found: true,
        focused: document.activeElement === element && element.matches(':focus-visible'),
        visible:
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1 && !transparent,
        detail: `${style.outlineStyle} ${style.outlineWidth} ${color}`,
      };
    }, selector);
  const expectOutline = async (selector, name) => {
    const result = await focusOutline(selector);
    check(
      result.found && result.focused && result.visible,
      `${label}: ${name} в фокусе — видимый outline (${result.detail ?? 'не найден'})`,
    );
  };

  await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
  check(
    await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches),
    `${label}: эмуляция forced-colors включена`,
  );
  // Клавиатура: :focus-visible у ссылок и кнопок — после нажатия клавиши, как у человека с клавиатуры.
  await page.keyboard.press('Tab');
  await expectOutline('#catalog-list a', 'ссылка-карточка');
  await expectOutline('.site-header a', 'ссылка в шапке');
  await expectOutline('.catalog-search__input', 'поиск');

  if (viewport.name !== '1440') {
    const icon = await page.evaluate(() => {
      const line = document.querySelector('.nav-toggle__icon');
      const button = document.querySelector('.nav-toggle');
      if (!line || !button) return { line: 'нет', button: '' };
      return {
        line: getComputedStyle(line).backgroundColor,
        button: getComputedStyle(button).backgroundColor,
      };
    });
    check(
      icon.line !== 'нет' &&
        !/rgba\(.*,\s*0\)$|transparent/.test(icon.line) &&
        icon.line !== icon.button,
      `${label}: значок «Меню» виден (линии ${icon.line} на фоне ${icon.button})`,
    );
  }

  await page.goto(baseUrl + puttyPath, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  await expectOutline('form [name="roomLength"]', 'поле ввода');
  await expectOutline('form [name="mode"]', 'выпадающий список');
  await expectOutline('form button[type="submit"]', 'кнопка «Рассчитать»');
  await fillPuttyRoom(page);
  await page.keyboard.press('Shift+Tab');
  await expectOutline('[data-share-link]', 'кнопка «Поделиться»');
  if (viewport.name !== '1440') {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(350);
    await expectOutline('[data-result-bar]', 'панель итога');
  }
  await page.evaluate(
    (key) => window.localStorage.setItem(key, '{"v":1,"roomLength":4,"roomWidth":3}'),
    roomKey,
  );
  await page.goto(baseUrl + paintPath, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  await expectOutline('.calc-memory__clear', '«Очистить»');
  await page.screenshot({ path: path.join(outDir, `forced-colors-${viewport.name}.png`) });
  await context.close();
  check(errors.length === 0, `${label}: нет ошибок в консоли (${errors.join(' | ') || '0'})`);
}

/** Контраст по WCAG 2.x для цветов вида rgb(…)/rgba(…) — полупрозрачный цвет накладывается на фон. */
function contrastRatio(fg, bg) {
  const parse = (color) => (color.match(/[\d.]+/g) ?? []).map(Number);
  const [br, bgG, bb] = parse(bg);
  const [fr, fgG, fb, alpha = 1] = parse(fg);
  const mix = [
    fr * alpha + br * (1 - alpha),
    fgG * alpha + bgG * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  ];
  const lum = ([r, g, b]) => {
    const f = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(mix), lum([br, bgG, bb])].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Цвет текста (или рамки) элемента и фон ближайшего предка с непрозрачным фоном. */
async function colorPair(page, selector, property = 'color') {
  return page.evaluate(
    ({ target, prop }) => {
      const element = document.querySelector(target);
      if (!element) return null;
      let node = element;
      let bg = 'rgb(244, 246, 248)';
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        const alpha = Number((color.match(/[\d.]+/g) ?? [])[3] ?? 1);
        if (color !== 'transparent' && alpha > 0) {
          bg = color;
          break;
        }
        node = node.parentElement;
      }
      return { fg: getComputedStyle(element)[prop], bg };
    },
    { target: selector, prop: property },
  );
}

/**
 * Визуальная система «Чертёж» (DES-1): контраст пар «текст / фон» ≥ 4.5:1 и рамки полей ≥ 3:1 на вычисленных цветах,
 * форма калькулятора на первом экране 390 × 844, шрифты загружены и в бюджете, нет сдвига при подгрузке шрифтов.
 */
async function checkDesign(browser, viewport) {
  const label = `дизайн ${viewport.name}`;
  const errors = [];
  const { context, page } = await freshPage(browser, viewport, errors);

  const pairs = [
    ['/', 'h1', 'заголовок', 4.5],
    ['/', '.hero__lead', 'лид героя', 4.5],
    ['/', '.hero__status', 'штамп героя', 4.5],
    ['/', '.calc-card__category', 'раздел на карточке', 4.5],
    ['/', '.calc-card__action', '«Рассчитать →»', 4.5],
    ['/', '.catalog-search__label', 'подпись поиска', 4.5],
    [calcPath, '.breadcrumbs__item a', 'ссылка в крошках', 4.5],
    [calcPath, '.breadcrumbs [aria-current]', 'текущая крошка', 4.5],
    [calcPath, '.calc-intro__sheet', 'штамп листа', 4.5],
    [calcPath, '.calc-intro__lead', 'лид калькулятора', 4.5],
    [calcPath, '.calc-group__title', 'заголовок группы', 4.5],
    [calcPath, '.field__label', 'подпись поля', 4.5],
    [calcPath, '.field__hint', 'подсказка поля', 4.5],
    [calcPath, '.field__unit', 'единица в поле', 4.5],
    [calcPath, '.button--primary', 'основная кнопка', 4.5],
    [calcPath, '.button--secondary', 'вторичная кнопка', 4.5],
    [calcPath, '.calc-result__placeholder', 'подсказка результата', 4.5],
    [calcPath, '.site-footer__links a', 'ссылка в подвале', 4.5],
  ];
  let current = '';
  for (const [pagePath, selector, name, min] of pairs) {
    if (pagePath !== current) {
      await page.goto(baseUrl + pagePath, { waitUntil: 'networkidle' });
      current = pagePath;
    }
    const pair = await colorPair(page, selector);
    const ratio = pair ? contrastRatio(pair.fg, pair.bg) : 0;
    check(ratio >= min, `${label}: контраст «${name}» ${ratio.toFixed(2)}:1 (≥ ${min})`);
  }
  // Номер группы «01 ·» — псевдоэлемент: цвет — размерный текст на белом.
  const groupNumber = await page.evaluate(() => {
    const title = document.querySelector('.calc-group__title');
    return title ? getComputedStyle(title, '::before').color : '';
  });
  const groupRatio = contrastRatio(groupNumber, 'rgb(255, 255, 255)');
  check(groupRatio >= 4.5, `${label}: контраст номера группы ${groupRatio.toFixed(2)}:1`);
  // Рамка поля (WCAG 1.4.11): боковая к белому фону карточки ≥ 3:1, нижняя линия — чернилами.
  const border = await colorPair(page, 'form .field__input', 'borderLeftColor');
  const underline = await colorPair(page, 'form .field__input', 'borderBottomColor');
  const borderRatio = border ? contrastRatio(border.fg, 'rgb(255, 255, 255)') : 0;
  const underlineRatio = underline ? contrastRatio(underline.fg, 'rgb(255, 255, 255)') : 0;
  check(
    borderRatio >= 3 && underlineRatio >= 4.5,
    `${label}: рамка поля ${borderRatio.toFixed(2)}:1, нижняя линия ${underlineRatio.toFixed(2)}:1`,
  );
  const fieldStyle = await page.evaluate(() => {
    const input = document.querySelector('form .field__input');
    if (!input) return null;
    const style = getComputedStyle(input);
    return {
      font: style.fontFamily,
      size: style.fontSize,
      height: Math.round(input.getBoundingClientRect().height),
      bottom: style.borderBottomWidth,
    };
  });
  check(
    fieldStyle !== null &&
      fieldStyle.font.startsWith('"JetBrains Mono"') &&
      fieldStyle.size === '18px' &&
      fieldStyle.height >= 48 &&
      fieldStyle.bottom === '2px',
    `${label}: поле — JetBrains Mono 18 px, высота ${fieldStyle?.height} px, нижняя линия ${fieldStyle?.bottom}`,
  );
  // Рамка карточки группы — outline, legend её не разрывает.
  const group = await page.evaluate(() => {
    const element = document.querySelector('.calc-group');
    if (!element) return null;
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, border: style.borderTopStyle };
  });
  check(
    group?.outline === 'solid' && group.border === 'none',
    `${label}: рамка группы полей — outline (legend её не разрывает)`,
  );

  // Шрифты сайта загружены и используются.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      onest: document.fonts.check('400 16px Onest', 'Расчёт'),
      mono: document.fonts.check('500 16px "JetBrains Mono"', '0123'),
      body: getComputedStyle(document.body).fontFamily,
    };
  });
  check(
    fonts.onest && fonts.mono && fonts.body.startsWith('Onest'),
    `${label}: шрифты Onest и JetBrains Mono загружены (${fonts.body.split(',')[0]})`,
  );

  if (viewport.name === '390') {
    // Форма на первом экране 390 × 844: первое поле видно целиком, без прокрутки.
    for (const calcPage of calculatorPaths) {
      await page.goto(baseUrl + calcPage, { waitUntil: 'networkidle' });
      const firstField = await page.evaluate(() => {
        const input = document.querySelector('form input, form select');
        return input ? Math.round(input.getBoundingClientRect().bottom) : 9999;
      });
      check(
        firstField <= viewport.height,
        `${label}: ${calcPage} — первое поле формы на первом экране (низ ${firstField} ≤ ${viewport.height} px)`,
      );
    }
  }
  await context.close();

  if (viewport.name === '1440') {
    // Бюджет шрифтов: все файлы public/fonts — до 150 КБ.
    const dir = path.resolve('public/fonts');
    const files = (await readdir(dir)).filter((file) => file.endsWith('.woff2'));
    const sizes = await Promise.all(
      files.map(async (file) => (await stat(path.join(dir, file))).size),
    );
    const total = sizes.reduce((sum, size) => sum + size, 0);
    check(
      total <= 150 * 1024 && files.length === 10,
      `${label}: шрифты — ${files.length} файлов, ${(total / 1024).toFixed(1)} КБ (≤ 150 КБ)`,
    );
    const licenses = (await readdir(dir)).filter((file) => file.startsWith('OFL-'));
    check(
      licenses.length === 2,
      `${label}: лицензии OFL рядом со шрифтами (${licenses.join(', ')})`,
    );
  }

  // Сдвиг при подгрузке шрифтов: файлы отдаются с задержкой 800 мс, CLS считается до и после замены.
  if (viewport.name === '390' || viewport.name === '1440') {
    for (const target of ['/', calcPath]) {
      const slow = await freshPage(browser, viewport, errors, () => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await slow.page.route('**/fonts/*.woff2', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      });
      await slow.page.goto(baseUrl + target, { waitUntil: 'load' });
      await slow.page.evaluate(() => document.fonts.ready);
      await slow.page.waitForTimeout(300);
      const cls = await slow.page.evaluate(() => window.__cls);
      check(
        cls < 0.05,
        `${label}: ${target} — сдвиг при подгрузке шрифтов CLS ${cls.toFixed(4)} (< 0.05)`,
      );
      await slow.context.close();
    }
  }
  check(errors.length === 0, `${label}: нет ошибок в консоли (${errors.join(' | ') || '0'})`);
}

/**
 * Результат — «спецификация» (DES-1, часть 2) на обоях: тёмная полоса со штампом, «К покупке» крупным моноширинным
 * числом, «Как получилось» с выносками и вычитаниями, полоса «Скопировать / Поделиться», «Дальше для этой комнаты»
 * (пометка — только когда размеры сохранены), тёмная панель итога на телефоне.
 */
async function checkSpec(browser, viewport) {
  const label = `спецификация ${viewport.name}`;
  const errors = [];
  const { context, page } = await freshPage(browser, viewport, errors);
  const hint = page.locator('[data-room-next-hint]');
  await page.goto(baseUrl + calcPath, { waitUntil: 'networkidle' });
  const heading = plain(await page.locator('[data-result-heading]').textContent());
  check(
    heading === 'Результат: Спецификация · Обои',
    `${label}: заголовок результата «${heading}» (для диктора — «Результат:»)`,
  );
  const next = await page
    .locator('.room-next__link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  check(
    next.join(' ') === `${laminatePath} ${paintPath} ${puttyPath} ${plasterPath}` &&
      !(await hint.isVisible()),
    `${label}: «Дальше для этой комнаты» — ламинат, краска, шпаклёвка, штукатурка; до расчёта без пометки`,
  );

  // Обои: 4 × 3 × 2,7, окно 1,5 × 1,4, рулон 0,53 × 10,05 по 1200 ₽ → 9 рулонов, 10 800 ₽ (WALLPAPER.md).
  const values = {
    roomLength: '4',
    roomWidth: '3',
    wallHeight: '2,7',
    windowCount: '1',
    windowWidth: '1,5',
    windowHeight: '1,4',
    rollWidth: '0,53',
    rollLength: '10,05',
    rollPrice: '1200',
  };
  for (const [name, value] of Object.entries(values))
    await page.fill(`form [name="${name}"]`, value);
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(200);
  const spec = await page.evaluate(() => {
    const result = document.querySelector('[data-calculator-result]');
    const title = document.querySelector('[data-result-heading]');
    const ready = result?.querySelector('[data-state-panel="ready"]');
    const number = result?.querySelector('.calc-result__number');
    const minus = result?.querySelector('.calc-result__minus dd');
    const row = result?.querySelector('.calc-result__list > div');
    const buttons = [...(result?.querySelectorAll('[data-share] button') ?? [])].map((button) =>
      button.getBoundingClientRect(),
    );
    const style = (element) => (element ? getComputedStyle(element) : null);
    return {
      titleBg: style(title)?.backgroundColor ?? '',
      titleColor: style(title)?.color ?? '',
      first: ready?.firstElementChild?.textContent?.trim() ?? '',
      number: number?.textContent?.trim() ?? '',
      numberFont: style(number)?.fontFamily ?? '',
      numberSize: parseFloat(style(number)?.fontSize ?? '0'),
      explain: result?.querySelector('.calc-result__explain')?.textContent?.trim() ?? '',
      ddFont: style(row?.querySelector('dd'))?.fontFamily ?? '',
      leader: style(row)?.backgroundImage ?? '',
      minus: minus?.textContent?.trim() ?? '',
      minusColor: style(minus)?.color ?? '',
      minusSign: minus ? getComputedStyle(minus, '::before').content : '',
      buttons: buttons.map((rect) => ({
        top: Math.round(rect.top),
        height: Math.round(rect.height),
      })),
    };
  });
  check(
    contrastRatio(spec.titleColor, spec.titleBg) >= 4.5 && spec.titleBg === 'rgb(19, 36, 61)',
    `${label}: шапка — тёмная полоса, контраст ${contrastRatio(spec.titleColor, spec.titleBg).toFixed(2)}:1`,
  );
  const minSize = viewport.name === '1440' ? 64 : 48;
  check(
    spec.first === 'К покупке' &&
      spec.number === '9' &&
      spec.numberFont.startsWith('"JetBrains Mono"') &&
      spec.numberSize >= minSize &&
      spec.explain === 'одной партии',
    `${label}: первым «К покупке» — ${spec.number}, JetBrains Mono ${spec.numberSize} px, «${spec.explain}»`,
  );
  check(
    spec.ddFont.startsWith('"JetBrains Mono"') && spec.leader.includes('radial-gradient'),
    `${label}: «Как получилось» — значения моноширинные, точечная выноска`,
  );
  check(
    spec.minus === '2,1 м²' &&
      spec.minusSign.includes('−') &&
      contrastRatio(spec.minusColor, 'rgb(255, 255, 255)') >= 4.5 &&
      spec.minusColor === 'rgb(181, 64, 14)',
    `${label}: вычитание «−${spec.minus}» размерным цветом, контраст ${contrastRatio(spec.minusColor, 'rgb(255, 255, 255)').toFixed(2)}:1`,
  );
  check(
    spec.buttons.length === 2 &&
      spec.buttons[0]?.top === spec.buttons[1]?.top &&
      spec.buttons.every((button) => button.height >= 44),
    `${label}: «Скопировать» и «Поделиться» — одной полосой, высота ${spec.buttons.map((b) => b.height).join(' / ')} px`,
  );
  check(await hint.isVisible(), `${label}: после расчёта — пометка «Размеры комнаты подставятся»`);
  await checkOverflow(page, `${label}, спецификация`);
  if (viewport.name !== '1440') {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(350);
    const bar = await page.evaluate(() => {
      const element = document.querySelector('[data-result-bar]');
      const text = element?.querySelector('.result-bar__text');
      if (!element || !text) return null;
      return {
        bg: getComputedStyle(element).backgroundColor,
        color: getComputedStyle(text).color,
        font: getComputedStyle(text).fontFamily,
      };
    });
    check(
      bar !== null &&
        bar.bg === 'rgb(19, 36, 61)' &&
        bar.font.startsWith('"JetBrains Mono"') &&
        contrastRatio(bar.color, bar.bg) >= 4.5,
      `${label}: панель итога — тёмная полоса, моноширинное число, контраст ${bar ? contrastRatio(bar.color, bar.bg).toFixed(2) : 0}:1`,
    );
  }
  await page.locator('[data-calculator-result]').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(outDir, `spec-oboi-${viewport.name}.png`),
    fullPage: true,
  });
  await page.goto(baseUrl + tilePath, { waitUntil: 'networkidle' });
  check(
    (await page.locator('.room-next').count()) === 0,
    `${label}: у плитки блока «Дальше для этой комнаты» нет`,
  );
  await context.close();

  // Хранилище запрещено — блок есть, а пометки «размеры подставятся» нет и после расчёта.
  const denied = await freshPage(browser, viewport, errors, () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Хранилище запрещено', 'SecurityError');
      },
    });
  });
  await denied.page.goto(baseUrl + calcPath, { waitUntil: 'networkidle' });
  for (const [name, value] of Object.entries(values))
    await denied.page.fill(`form [name="${name}"]`, value);
  await denied.page.locator('form button[type="submit"]').click();
  check(
    (await denied.page.locator('.room-next').isVisible()) &&
      !(await denied.page.locator('[data-room-next-hint]').isVisible()),
    `${label}: хранилище запрещено — ссылки есть, пометки «размеры подставятся» нет`,
  );
  await denied.context.close();
  check(errors.length === 0, `${label}: нет ошибок в консоли (${errors.join(' | ') || '0'})`);
}

async function checkLinks(page, label) {
  const hrefs = await page.$$eval('a[href]', (links) => links.map((a) => a.getAttribute('href')));
  const broken = [];
  for (const href of new Set(hrefs)) {
    if (!href || href.startsWith('http')) continue;
    const url = new URL(href, page.url());
    const response = await fetch(url);
    let ok = response.ok;
    if (ok && url.hash) {
      const html = await response.text();
      ok = html.includes(`id="${url.hash.slice(1)}"`);
    }
    if (!ok) broken.push(href);
  }
  check(
    broken.length === 0,
    `${label}: все внутренние ссылки и якоря существуют ${broken.join(' ')}`,
  );
}

async function checkHome(page, viewport) {
  const label = `главная ${viewport.name}`;
  const response = await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(meta.title.startsWith('ДомРасчёт'), `${label}: title «${meta.title}»`);
  const h1 = plain(await page.textContent('h1'));
  check(
    h1 === 'ДомРасчёт — калькуляторы для ремонта и строительства',
    `${label}: h1 с брендом и запросом «${h1}»`,
  );
  await checkOverflow(page, label);
  if (!fullCheckViewports.has(viewport.name)) {
    await page.screenshot({ path: path.join(outDir, `home-${viewport.name}.png`), fullPage: true });
    return;
  }

  // Каталог: все шесть калькуляторов первой очереди опубликованы, карточек «Скоро» нет
  const cards = page.locator('#catalog-list > li');
  check((await cards.count()) === 6, `${label}: 6 карточек калькуляторов`);
  const cardLinks = await page
    .locator('#catalog-list a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  check(
    cardLinks.join(',') ===
      [calcPath, laminatePath, paintPath, tilePath, puttyPath, plasterPath].join(','),
    `${label}: ссылки только у готовых калькуляторов (${cardLinks.join(', ')})`,
  );
  check(
    (await page.locator('#catalog-list .badge--soon').count()) === 0,
    `${label}: нет карточек со статусом «Скоро»`,
  );
  check(
    plain(await page.locator('#catalog-list > li').first().textContent()).includes(
      'Калькулятор обоев',
    ),
    `${label}: доступный калькулятор стоит первым`,
  );
  check(
    (await page.locator(`#catalog a[href="${catalogPath}"]`).count()) === 1,
    `${label}: «Все калькуляторы →» ведёт на каталог`,
  );
  check((await currentNav(page)).length === 0, `${label}: на главной нет aria-current в меню`);
  check(
    (await page.locator('#categories').count()) === 0,
    `${label}: раздела «Категории» нет — категория с калькуляторами одна (D-022)`,
  );
  await checkLinks(page, label);

  // Навигация
  const toggle = page.locator('[data-nav-toggle]');
  const nav = page.locator('#site-nav');
  if (viewport.isMobile) {
    check(await toggle.isVisible(), `${label}: кнопка «Меню» видна`);
    check(!(await nav.isVisible()), `${label}: меню свёрнуто`);
    await toggle.click();
    await page.waitForTimeout(300);
    check((await toggle.getAttribute('aria-expanded')) === 'true', `${label}: aria-expanded=true`);
    check(await nav.isVisible(), `${label}: меню раскрывается`);
    await page.screenshot({ path: path.join(outDir, `home-${viewport.name}-menu.png`) });
    await page.locator('#site-nav a[href="/#about"]').click();
    await page.waitForTimeout(600);
    check(!(await nav.isVisible()), `${label}: меню закрывается после выбора пункта`);
    check(page.url().endsWith('#about'), `${label}: переход к «О сервисе»`);
    await toggle.click();
    await page.keyboard.press('Escape');
    check(!(await nav.isVisible()), `${label}: меню закрывается по Escape`);
  } else {
    check(!(await toggle.isVisible()), `${label}: кнопка «Меню» скрыта`);
    check(await nav.isVisible(), `${label}: навигация видна`);
  }

  // Поиск
  await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
  const search = page.locator('#catalog-search-input');
  const visibleCards = () => page.locator('#catalog-list > li:not([hidden])').count();
  await search.fill('плит');
  check((await visibleCards()) === 1, `${label}: поиск «плит» → 1 карточка`);
  await search.fill('обои');
  check((await visibleCards()) === 1, `${label}: поиск «обои» → 1 карточка`);
  await search.fill('бетон');
  check((await visibleCards()) === 0, `${label}: поиск «бетон» → 0`);
  check(await page.locator('[data-catalog-empty]').isVisible(), `${label}: «ничего не найдено»`);
  await search.fill('');
  check((await visibleCards()) === 6, `${label}: пустой запрос → все карточки`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outDir, `home-${viewport.name}.png`), fullPage: true });

  // Переход с карточки на калькулятор
  await page.locator(`#catalog-list a[href="${calcPath}"]`).click();
  await page.waitForURL(`**${calcPath}`);
  check(new URL(page.url()).pathname === calcPath, `${label}: карточка обоев ведёт на калькулятор`);
}

async function checkCalculator(page, viewport) {
  const label = `обои ${viewport.name}`;
  const response = await page.goto(baseUrl + calcPath, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(
    meta.title === 'Калькулятор обоев — сколько рулонов нужно на комнату — ДомРасчёт',
    `${label}: title «${meta.title}»`,
  );
  check(
    (meta.description ?? '').startsWith('Рассчитайте количество рулонов обоев'),
    `${label}: уникальный description`,
  );
  check(plain(await page.textContent('h1')) === 'Калькулятор обоев', `${label}: h1`);
  check(
    (await page
      .locator('nav[aria-label="Навигационная цепочка"] [aria-current="page"]')
      .count()) === 1,
    `${label}: навигационная цепочка`,
  );
  await checkOverflow(page, `${label}, пустая форма`);

  const field = (name) => page.locator(`input[name="${name}"]`);
  const error = (name) => page.locator(`[data-error-for="${name}"]`);
  const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
  const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());
  const submit = page.locator('form[data-wallpaper-form] button[type="submit"]');
  const fill = async (values) => {
    for (const [name, value] of Object.entries(values)) await field(name).fill(value);
  };

  check((await state()) === 'empty', `${label}: до расчёта результат пуст`);
  check(
    (await field('rollWidth').inputValue()) === '0,53' &&
      (await field('rollLength').inputValue()) === '10,05' &&
      (await field('trimAllowance').inputValue()) === '10',
    `${label}: значения по умолчанию — рулон 0,53 × 10,05, подрезка 10 см`,
  );

  // Пустые поля
  await submit.click();
  check((await state()) === 'invalid', `${label}: пустая форма → состояние «ошибка»`);
  for (const name of ['roomLength', 'roomWidth', 'wallHeight']) {
    check(
      plain(await error(name).textContent()) === 'Заполните поле.' &&
        (await field(name).getAttribute('aria-invalid')) === 'true',
      `${label}: ошибка рядом с пустым полем ${name}`,
    );
  }
  check(
    (await page.locator('[data-error-summary] li').count()) === 3,
    `${label}: сводка ошибок — 3 поля`,
  );
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('name') === 'roomLength'),
    `${label}: фокус переходит на первое поле с ошибкой`,
  );
  await page.waitForTimeout(600); // плавная прокрутка
  check(
    await page.evaluate(() => {
      const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      const rect = document.activeElement?.getBoundingClientRect();
      return rect ? rect.top >= header && rect.bottom <= window.innerHeight : false;
    }),
    `${label}: поле с ошибкой видно на экране, не под шапкой`,
  );
  check(
    !(await page.locator('[data-state-panel="ready"]').isVisible()),
    `${label}: результат не показывается при ошибках`,
  );
  if (viewport.name === '390') {
    await page.screenshot({ path: path.join(outDir, `calc-${viewport.name}-errors.png`) });
  }

  if (!fullCheckViewports.has(viewport.name)) {
    // Для промежуточных ширин — только расчёт, переполнение и скриншот.
    await fill({ roomLength: '5', roomWidth: '4', wallHeight: '2,7' });
    await fill({ windowCount: '2', windowWidth: '1,5', windowHeight: '1,4' });
    await fill({ doorCount: '1', doorWidth: '0,9', doorHeight: '2', rollPrice: '1299,95' });
    await submit.click();
    check((await out('rolls')) === '12', `${label}: пример 4 → 12 рулонов`);
    await checkOverflow(page, `${label}, с результатом`);
    await page.screenshot({ path: path.join(outDir, `calc-${viewport.name}.png`), fullPage: true });
    return;
  }

  // Клавиатура: ввод, Tab между полями, Enter отправляет форму
  await field('roomLength').focus();
  await page.keyboard.type('4');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2,5');
  await page.keyboard.press('Enter');
  check((await state()) === 'ready', `${label}: Enter в поле выполняет расчёт`);
  check(
    await page.evaluate(() => document.activeElement?.id === 'calc-result-title'),
    `${label}: после расчёта фокус на заголовке результата`,
  );
  await page.waitForTimeout(600); // плавная прокрутка
  check(
    await page.evaluate(() => {
      const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      const rect = document.activeElement?.getBoundingClientRect();
      return rect ? rect.top >= header - 1 && rect.bottom <= window.innerHeight : false;
    }),
    `${label}: заголовок результата виден на экране`,
  );

  // Пример 1
  check((await out('rolls')) === '10', `${label}: пример 1 → 10 (${await out('rolls')})`);
  check((await out('rollsWord')) === 'рулонов', `${label}: «10 рулонов»`);
  check((await out('perimeter')) === '14', `${label}: периметр 14 м`);
  check((await out('wallArea')) === '35', `${label}: площадь стен 35 м²`);
  check((await out('stripsForWalls')) === '28', `${label}: 28 полос по стенам`);
  check((await out('stripLength')) === '2,6', `${label}: полоса 2,6 м`);
  check((await out('stripsPerRoll')) === '3', `${label}: 3 полосы из рулона`);
  check(
    !(await page.locator('[data-row="openings"]').first().isVisible()),
    `${label}: строки про проёмы скрыты, когда проёмов нет`,
  );
  check(
    !(await page.locator('[data-row="totalCost"]').isVisible()),
    `${label}: стоимость скрыта без цены`,
  );

  // Изменение параметров после расчёта — без кнопки
  await field('wallHeight').fill('2,3');
  check((await out('rolls')) === '7', `${label}: высота 2,3 → 7 рулонов без перезагрузки`);
  check((await out('stripsPerRoll')) === '4', `${label}: 4 полосы из рулона`);
  await field('patternRepeat').fill('64');
  check((await out('stripLength')) === '2,56', `${label}: раппорт 64 → полоса 2,56 м`);
  check((await out('rolls')) === '10', `${label}: раппорт 64 → 10 рулонов`);
  check(
    (await page.locator('[data-row="rollStart"]').isVisible()) &&
      (await out('rollStartAllowance')) === '0,64',
    `${label}: показана подгонка рисунка в начале рулона до 0,64 м`,
  );
  await fill({ patternRepeat: '', wallHeight: '2,5', rollPrice: '1299,95' });
  check(
    !(await page.locator('[data-row="rollStart"]').isVisible()),
    `${label}: без раппорта строка подгонки скрыта`,
  );
  check(
    (await out('totalCost')) === '12 999,50 ₽',
    `${label}: стоимость 10 × 1 299,95 = «${await out('totalCost')}»`,
  );
  check((await out('rollsWord')) === 'рулонов', `${label}: склонение «рулонов»`);

  // Пример 4: окна и двери
  await fill({ roomLength: '5', roomWidth: '4', wallHeight: '2,7' });
  await fill({ windowCount: '2', windowWidth: '1,5', windowHeight: '1,4' });
  await fill({ doorCount: '1', doorWidth: '0,9', doorHeight: '2' });
  check((await out('rolls')) === '12', `${label}: пример 4 → 12 рулонов`);
  check((await out('stripsForWalls')) === '36', `${label}: 36 полос по стенам`);
  check((await out('openingsArea')) === '6', `${label}: площадь проёмов 6 м²`);
  check((await out('stripsSavedByOpenings')) === '2', `${label}: проёмы экономят 2 полосы`);
  check((await out('shortPieces')) === '2', `${label}: 2 коротких куска`);
  check((await out('totalCost')) === '15 599,40 ₽', `${label}: стоимость 12 × 1 299,95`);
  check(
    !(await page.locator('[data-row="openingsNote"]').isVisible()),
    `${label}: пояснение «проёмы не уменьшили расход» скрыто, когда экономия есть`,
  );
  await fill({ windowCount: '0' });
  check(
    (await page.locator('[data-row="openingsNote"]').isVisible()) &&
      (await out('stripsSavedByOpenings')) === '0',
    `${label}: только узкая дверь → пояснение, что проёмы не уменьшили расход`,
  );
  await fill({ windowCount: '2' });
  await checkOverflow(page, `${label}, с результатом`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outDir, `calc-${viewport.name}.png`), fullPage: true });

  // Некорректные значения
  const expectError = async (values, name, message, title) => {
    await fill(values);
    check(
      (await state()) === 'invalid' && plain(await error(name).textContent()) === message,
      `${label}: ${title} → «${plain(await error(name).textContent())}»`,
    );
  };
  await expectError(
    { roomLength: '-5' },
    'roomLength',
    'Значение должно быть больше нуля.',
    'отрицательная длина',
  );
  await expectError(
    { roomLength: '0' },
    'roomLength',
    'Значение должно быть больше нуля.',
    'нулевая длина',
  );
  await expectError({ roomLength: 'пять' }, 'roomLength', 'Введите число.', 'текст вместо числа');
  await fill({ roomLength: '5' });
  check((await state()) === 'ready', `${label}: после исправления результат возвращается`);
  await expectError(
    { patternRepeat: '250' },
    'patternRepeat',
    'Не больше 200 см.',
    'чрезмерный раппорт',
  );
  await fill({ patternRepeat: '' });
  await expectError(
    { wallHeight: '10' },
    'rollLength',
    'Полоса (10,1 м с подрезкой) длиннее рулона.',
    'полоса длиннее рулона',
  );
  await fill({ wallHeight: '2,7' });
  await expectError(
    { windowWidth: '6' },
    'windowWidth',
    'Окно шире самой длинной стены (5 м).',
    'окно шире стены',
  );
  await fill({ windowWidth: '1,5' });
  await expectError(
    { doorHeight: '3' },
    'doorHeight',
    'Дверь выше стены (2,7 м).',
    'дверь выше стены',
  );
  await fill({ doorHeight: '2' });
  await expectError(
    { windowCount: '1,5' },
    'windowCount',
    'Введите целое число.',
    'дробное число окон',
  );
  await expectError(
    { windowCount: '-1' },
    'windowCount',
    'Значение не может быть отрицательным.',
    'отрицательное число окон',
  );
  await fill({ windowCount: '2' });
  await expectError(
    { rollPrice: '-10' },
    'rollPrice',
    'Значение не может быть отрицательным.',
    'отрицательная цена',
  );
  await fill({ rollPrice: '1299,95' });
  check((await state()) === 'ready', `${label}: после исправления всех полей — результат`);
  check(
    (await page.locator('[aria-invalid="true"]').count()) === 0,
    `${label}: отметки ошибок сняты`,
  );
  await checkOverflow(page, `${label}, после ошибок`);

  // Порядок Tab по форме
  await field('roomLength').focus();
  const order = [];
  for (let i = 0; i < 15; i += 1) {
    order.push(
      await page.evaluate(
        () => document.activeElement?.getAttribute('name') ?? document.activeElement?.textContent,
      ),
    );
    await page.keyboard.press('Tab');
  }
  check(
    order.join(',') ===
      'roomLength,roomWidth,wallHeight,windowCount,windowWidth,windowHeight,doorCount,doorWidth,doorHeight,rollWidth,rollLength,patternRepeat,trimAllowance,rollPrice,Рассчитать',
    `${label}: порядок Tab соответствует порядку полей`,
  );
  const focusShadow = await field('roomWidth').evaluate((input) => {
    input.focus();
    return getComputedStyle(input).boxShadow;
  });
  check(focusShadow !== 'none', `${label}: у поля в фокусе видимое выделение`);

  // Сброс
  await page.locator('form[data-wallpaper-form] button[type="reset"]').click();
  await page.waitForTimeout(100);
  check((await state()) === 'empty', `${label}: «Сбросить» очищает результат`);
  check(
    (await field('roomLength').inputValue()) === '' &&
      (await field('rollWidth').inputValue()) === '0,53',
    `${label}: «Сбросить» возвращает значения по умолчанию`,
  );
  await field('roomLength').fill('4');
  check((await state()) === 'empty', `${label}: после сброса расчёт снова по кнопке`);

  await checkLinks(page, label);
}

async function checkPaint(page, viewport) {
  const label = `краска ${viewport.name}`;
  const response = await page.goto(baseUrl + paintPath, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(
    meta.title === 'Калькулятор краски — расход на стены и потолок — ДомРасчёт',
    `${label}: title «${meta.title}»`,
  );
  await checkOverflow(page, label);
  if (viewport.name !== '390') return;

  const field = (name) => page.locator(`[name="${name}"]`);
  const error = async (name) =>
    plain(await page.locator(`[data-error-for="${name}"]`).textContent());
  const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
  const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());
  const fill = async (values) => {
    for (const [name, value] of Object.entries(values)) await field(name).fill(value);
  };
  check(
    (await field('coats').inputValue()) === '2' &&
      (await field('reserve').inputValue()) === '10' &&
      (await field('ceiling').inputValue()) === 'no',
    `${label}: по умолчанию 2 слоя, запас 10 %, потолок не красится`,
  );
  await page.locator('form[data-paint-form] button[type="submit"]').click();
  check(
    (await state()) === 'invalid' && (await page.locator('[data-error-summary] li').count()) === 4,
    `${label}: пустая форма — 4 ошибки (размеры и укрывистость)`,
  );
  // П5 (PAINT.md): 45,9 м², 11,475 л → 11,5; с запасом 12,6225 → 12,7; банок по 2,7 л — 5.
  await fill({ roomLength: '4', roomWidth: '3', wallHeight: '2,7', openingsArea: '3,9' });
  await fill({ coverage: '8', canVolume: '2,7' });
  await field('ceiling').selectOption('yes');
  check(
    (await state()) === 'ready' &&
      (await out('paintArea')) === '45,9' &&
      (await out('liters')) === '11,5' &&
      (await out('litersWithReserve')) === '12,7' &&
      (await out('cans')) === '5' &&
      (await out('litersToBuy')) === '13,5' &&
      (await page.locator('[data-row="ceilingArea"]').isVisible()),
    `${label}: П5 — 45,9 м², 11,5 л, с запасом 12,7 л, 5 банок по 2,7 л`,
  );
  await fill({ openingsArea: '50' });
  check(
    (await state()) === 'invalid' &&
      (await error('openingsArea')).startsWith('Больше площади стен'),
    `${label}: проёмы больше стен — ошибка у поля`,
  );
  await fill({ openingsArea: '3,9', coverage: '8,55' });
  check(
    (await error('coverage')) === 'Не больше одного знака после запятой.',
    `${label}: укрывистость 8,55 — ошибка у поля`,
  );
  await fill({ coverage: '8' });
  await checkOverflow(page, `${label}, с результатом`);
  await page.screenshot({ path: path.join(outDir, `paint-${viewport.name}.png`), fullPage: true });
  await page.locator('form[data-paint-form] button[type="reset"]').click();
  await page.waitForTimeout(100);
  check(
    (await state()) === 'empty' && (await field('coats').inputValue()) === '2',
    `${label}: «Сбросить» — результат пуст, значения по умолчанию`,
  );
}

async function checkTile(page, viewport) {
  const label = `плитка ${viewport.name}`;
  const response = await page.goto(baseUrl + tilePath, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(
    meta.title === 'Калькулятор плитки — расчёт для пола и стен — ДомРасчёт',
    `${label}: title «${meta.title}»`,
  );
  await checkOverflow(page, label);
  if (viewport.name !== '390') return;

  const field = (name) => page.locator(`[name="${name}"]`);
  const error = async (name) =>
    plain(await page.locator(`[data-error-for="${name}"]`).textContent());
  const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
  const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());
  const fill = async (values) => {
    for (const [name, value] of Object.entries(values)) await field(name).fill(value);
  };
  check(
    (await field('surface').inputValue()) === 'floor' &&
      (await field('surfaceCount').inputValue()) === '1' &&
      (await field('joint').inputValue()) === '2' &&
      (await field('reserve').inputValue()) === '10',
    `${label}: по умолчанию пол, 1 поверхность, шов 2 мм, запас 10 %`,
  );
  await page.locator('form[data-tile-form] button[type="submit"]').click();
  check(
    (await state()) === 'invalid' && (await page.locator('[data-error-summary] li').count()) === 4,
    `${label}: пустая форма — 4 ошибки (размеры поверхности и плитки)`,
  );
  // Т3 (TILE.md): 2 стены 2,5 × 2,7 м, 600 × 200, шов 2 — 5 × 14 × 2 = 140, с запасом 154, по 8 — 20 упаковок.
  await field('surface').selectOption('wall');
  await fill({ surfaceLength: '2,5', surfaceWidth: '2,7', surfaceCount: '2' });
  await fill({ tileLength: '600', tileWidth: '200', tilesPerPack: '8' });
  check(
    (await state()) === 'ready' &&
      (await out('tiles')) === '140' &&
      (await out('tilesWithReserve')) === '154' &&
      (await out('tilesWord')) === 'плитки' &&
      (await out('packs')) === '20' &&
      (await out('tilesToBuy')) === '160' &&
      (await out('grid')) === '5 × 14 × 2' &&
      (await out('area')) === '13,5',
    `${label}: Т3 — 140 плиток, 154 с запасом, 20 упаковок по 8`,
  );
  await fill({ joint: '21' });
  check(
    (await state()) === 'invalid' && (await error('joint')) === 'Не больше 20 мм.',
    `${label}: шов 21 мм — ошибка у поля`,
  );
  await fill({ joint: '2', tileLength: '0' });
  check(
    (await error('tileLength')) === 'Значение должно быть больше нуля.',
    `${label}: нулевая плитка — ошибка у поля`,
  );
  await fill({ tileLength: '600' });
  await checkOverflow(page, `${label}, с результатом`);
  await page.screenshot({ path: path.join(outDir, `tile-${viewport.name}.png`), fullPage: true });
  await page.locator('form[data-tile-form] button[type="reset"]').click();
  await page.waitForTimeout(100);
  check(
    (await state()) === 'empty' && (await field('surface').inputValue()) === 'floor',
    `${label}: «Сбросить» — результат пуст, значения по умолчанию`,
  );
}

async function checkPlaster(page, viewport) {
  const label = `штукатурка ${viewport.name}`;
  const response = await page.goto(baseUrl + plasterPath, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(
    meta.title === 'Калькулятор штукатурки — расход и количество мешков — ДомРасчёт',
    `${label}: title «${meta.title}»`,
  );
  await checkOverflow(page, label);
  if (viewport.name !== '390') return;

  const field = (name) => page.locator(`[name="${name}"]`);
  const error = async (name) =>
    plain(await page.locator(`[data-error-for="${name}"]`).textContent());
  const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
  const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());
  const fill = async (values) => {
    for (const [name, value] of Object.entries(values)) await field(name).fill(value);
  };
  check(
    (await field('mode').inputValue()) === 'room' &&
      (await field('roomLength').isVisible()) &&
      !(await field('wallLength').isVisible()) &&
      !(await field('wallCount').isVisible()) &&
      (await field('thickness').inputValue()) === '10' &&
      (await field('consumption').inputValue()) === '' &&
      (await field('reserve').inputValue()) === '10',
    `${label}: по умолчанию «помещение» (поля стены скрыты), слой 10 мм, запас 10 %, расход пуст`,
  );
  await page.locator('form[data-plaster-form] button[type="submit"]').click();
  check(
    (await state()) === 'invalid' && (await page.locator('[data-error-summary] li').count()) === 4,
    `${label}: пустая форма — 4 ошибки (длина, ширина, высота, расход)`,
  );
  // Ш9 (PLASTER.md): помещение 4 × 3 × 2,7, проёмы 3,9, слой 15, расход 0,85, запас 10 %, мешок 25 кг.
  await fill({ roomLength: '4', roomWidth: '3', wallHeight: '2,7', openingsArea: '3,9' });
  await fill({ thickness: '15', consumption: '0,85', bagMass: '25' });
  check(
    (await state()) === 'ready' &&
      (await out('wallArea')) === '37,8' &&
      (await out('plasterArea')) === '33,9' &&
      (await out('mass')) === '432,3' &&
      (await out('massWithReserve')) === '475,5' &&
      (await out('bags')) === '20' &&
      (await out('massToBuy')) === '500',
    `${label}: Ш9 (помещение) — 33,9 м², 432,3 кг, с запасом 475,5 кг, 20 мешков (500 кг)`,
  );
  // Ш2 (PLASTER.md): 4 стены 4 × 2,7, проёмы 3,9, слой 15, расход 0,85, запас 10 %, мешок 25 кг.
  await field('mode').selectOption('walls');
  check(
    (await field('wallLength').isVisible()) &&
      (await field('wallCount').isVisible()) &&
      !(await field('roomLength').isVisible()),
    `${label}: «отдельные стены» — видны длина стены и число стен, поля помещения скрыты`,
  );
  await fill({ wallLength: '4', wallHeight: '2,7', wallCount: '4', openingsArea: '3,9' });
  await fill({ thickness: '15', consumption: '0,85', bagMass: '25' });
  check(
    (await state()) === 'ready' &&
      (await out('wallArea')) === '43,2' &&
      (await out('openingsArea')) === '3,9' &&
      (await out('plasterArea')) === '39,3' &&
      (await out('mass')) === '501,1' &&
      (await out('massWithReserve')) === '551,2' &&
      (await out('bags')) === '23' &&
      (await out('massToBuy')) === '575',
    `${label}: Ш2 — 39,3 м², 501,1 кг, с запасом 551,2 кг, 23 мешка (575 кг)`,
  );
  await fill({ openingsArea: '50' });
  check(
    (await state()) === 'invalid' &&
      (await error('openingsArea')) === 'Больше площади стен (43,2 м²).',
    `${label}: проёмы больше стен — ошибка у поля`,
  );
  await fill({ openingsArea: '3,9', consumption: '0' });
  check(
    (await error('consumption')) === 'Значение должно быть больше нуля.',
    `${label}: нулевой расход — ошибка у поля`,
  );
  await fill({ consumption: '0,85' });
  await checkOverflow(page, `${label}, с результатом`);
  await page.screenshot({
    path: path.join(outDir, `plaster-${viewport.name}.png`),
    fullPage: true,
  });
  await page.locator('form[data-plaster-form] button[type="reset"]').click();
  await page.waitForTimeout(100);
  check(
    (await state()) === 'empty' && (await field('thickness').inputValue()) === '10',
    `${label}: «Сбросить» — результат пуст, значения по умолчанию`,
  );
}

/** Шп10 (PUTTY.md): помещение 4 × 3 × 2,7, проёмы 3,9, потолок, 2 слоя по 1,1, упаковка 20 кг, и «Рассчитать». */
async function fillPuttyRoom(page) {
  const values = { roomLength: '4', roomWidth: '3', wallHeight: '2,7', openingsArea: '3,9' };
  for (const [name, value] of Object.entries(values)) await page.fill(`[name="${name}"]`, value);
  await page.selectOption('[name="ceiling"]', 'yes');
  for (const [name, value] of Object.entries({ layers: '2', consumption: '1,1', packMass: '20' }))
    await page.fill(`[name="${name}"]`, value);
  await page.locator('form[data-putty-form] button[type="submit"]').click();
}

async function checkPutty(page, viewport) {
  const label = `шпаклёвка ${viewport.name}`;
  const response = await page.goto(baseUrl + puttyPath, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `${label}: ответ 200`);
  const meta = await checkCommon(page, label);
  check(
    meta.title === 'Калькулятор шпаклёвки — расход на м² стен — ДомРасчёт',
    `${label}: title «${meta.title}»`,
  );
  await checkOverflow(page, label);
  if (viewport.name === '1440') {
    // Снимок режима «помещение» с результатом на широком экране.
    await fillPuttyRoom(page);
    await checkOverflow(page, `${label}, помещение с результатом`);
    await page.screenshot({
      path: path.join(outDir, `putty-room-${viewport.name}.png`),
      fullPage: true,
    });
  }
  if (viewport.name !== '390') return;

  const field = (name) => page.locator(`[name="${name}"]`);
  const error = async (name) =>
    plain(await page.locator(`[data-error-for="${name}"]`).textContent());
  const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
  const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());
  const fill = async (values) => {
    for (const [name, value] of Object.entries(values)) await field(name).fill(value);
  };
  check(
    (await field('mode').inputValue()) === 'room' &&
      (await field('ceiling').inputValue()) === 'no' &&
      (await field('roomWidth').isVisible()) &&
      !(await field('wallLength').isVisible()) &&
      (await field('layers').inputValue()) === '1' &&
      (await field('consumption').inputValue()) === '' &&
      (await field('reserve').inputValue()) === '10',
    `${label}: по умолчанию «помещение» без потолка, 1 слой, запас 10 %, расход пуст`,
  );
  await page.locator('form[data-putty-form] button[type="submit"]').click();
  check(
    (await state()) === 'invalid' && (await page.locator('[data-error-summary] li').count()) === 4,
    `${label}: пустая форма — 4 ошибки (длина, ширина, высота, расход)`,
  );
  await fillPuttyRoom(page);
  check(
    (await state()) === 'ready' &&
      (await out('wallArea')) === '37,8' &&
      (await out('ceilingArea')) === '12' &&
      (await out('puttyArea')) === '45,9' &&
      (await out('mass')) === '101' &&
      (await out('massWithReserve')) === '111,1' &&
      (await out('packs')) === '6' &&
      (await out('massToBuy')) === '120',
    `${label}: Шп10 (помещение с потолком) — 45,9 м², 101 кг, с запасом 111,1 кг, 6 упаковок (120 кг)`,
  );
  await checkOverflow(page, `${label}, помещение с результатом`);
  await page.screenshot({
    path: path.join(outDir, `putty-room-${viewport.name}.png`),
    fullPage: true,
  });
  // Шп2 (PUTTY.md): 4 стены 4 × 2,7, проёмы 3,9, 2 слоя по 1,1 кг/м², запас 10 %, упаковка 20 кг.
  await field('mode').selectOption('walls');
  check(
    (await field('wallCount').isVisible()) && !(await field('ceiling').isVisible()),
    `${label}: «отдельные стены» — число стен видно, выбор потолка скрыт`,
  );
  await fill({ wallLength: '4', wallHeight: '2,7', wallCount: '4', openingsArea: '3,9' });
  await fill({ layers: '2', consumption: '1,1', packMass: '20' });
  check(
    (await state()) === 'ready' &&
      (await out('wallArea')) === '43,2' &&
      (await out('openingsArea')) === '3,9' &&
      (await out('puttyArea')) === '39,3' &&
      (await out('mass')) === '86,5' &&
      (await out('massWithReserve')) === '95,2' &&
      (await out('packs')) === '5' &&
      (await out('massToBuy')) === '100',
    `${label}: Шп2 — 39,3 м², 86,5 кг, с запасом 95,2 кг, 5 упаковок (100 кг)`,
  );
  await fill({ packMass: '' });
  check(
    (await state()) === 'ready' &&
      (await page.locator('[data-row="packs"]').isHidden()) &&
      (await out('massWithReserve')) === '95,2',
    `${label}: без массы упаковки — только килограммы`,
  );
  await fill({ layers: '1,5' });
  check(
    (await state()) === 'invalid' && (await error('layers')) === 'Введите целое число.',
    `${label}: дробное число слоёв — ошибка у поля`,
  );
  await fill({ layers: '2', openingsArea: '50' });
  check(
    (await error('openingsArea')) === 'Больше площади стен (43,2 м²).',
    `${label}: проёмы больше стен — ошибка у поля`,
  );
  await fill({ openingsArea: '3,9', packMass: '20' });
  await checkOverflow(page, `${label}, с результатом`);
  await page.screenshot({ path: path.join(outDir, `putty-${viewport.name}.png`), fullPage: true });
  await page.locator('form[data-putty-form] button[type="reset"]').click();
  await page.waitForTimeout(100);
  check(
    (await state()) === 'empty' && (await field('layers').inputValue()) === '1',
    `${label}: «Сбросить» — результат пуст, значения по умолчанию`,
  );
}

async function checkLaminate(page, viewport) {
  const label = `ламинат ${viewport.name}`;
  // С главной — по карточке
  await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
  await page.locator(`#catalog-list a[href="${laminatePath}"]`).click();
  await page.waitForURL(`**${laminatePath}`);
  check(
    new URL(page.url()).pathname === laminatePath,
    `${label}: карточка ламината ведёт на калькулятор`,
  );
  await page.waitForLoadState('networkidle');

  const meta = await checkCommon(page, label);
  check(
    meta.title === 'Калькулятор ламината — расчёт упаковок на комнату — ДомРасчёт',
    `${label}: title «${meta.title}»`,
  );
  check(
    (meta.description ?? '').startsWith('Рассчитайте, сколько досок и упаковок ламината'),
    `${label}: уникальный description без подложки`,
  );
  check(plain(await page.textContent('h1')) === 'Калькулятор ламината', `${label}: h1`);
  await checkOverflow(page, `${label}, пустая форма`);

  const field = (name) => page.locator(`[name="${name}"]`);
  const error = (name) => page.locator(`[data-error-for="${name}"]`);
  const state = () => page.locator('[data-calculator-result]').getAttribute('data-state');
  const out = async (name) => plain(await page.locator(`[data-out="${name}"]`).textContent());
  const submit = page.locator('form[data-laminate-form] button[type="submit"]');
  const fill = async (values) => {
    for (const [name, value] of Object.entries(values)) await field(name).fill(value);
  };
  const k13 = {
    roomLength: '4',
    roomWidth: '3,5',
    boardLength: '1380',
    boardWidth: '193',
    boardsPerPack: '8',
  };

  check(
    (await field('minPiece').inputValue()) === '400' &&
      (await field('minOffset').inputValue()) === '400' &&
      (await field('reserve').inputValue()) === '5' &&
      (await field('gap').inputValue()) === '8' &&
      (await field('kerf').inputValue()) === '3' &&
      (await field('direction').inputValue()) === 'length' &&
      (await field('scheme').inputValue()) === 'half',
    `${label}: значения по умолчанию — 400 / 400 мм, зазор 8 мм, пропил 3 мм, запас 5 %, вдоль длины, 1/2`,
  );

  // Пустая форма
  await submit.click();
  check((await state()) === 'invalid', `${label}: пустая форма → ошибки`);
  check(
    (await page.locator('[data-error-summary] li').count()) === 5,
    `${label}: сводка — 5 обязательных полей`,
  );
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('name') === 'roomLength'),
    `${label}: фокус на первом поле с ошибкой`,
  );

  if (viewport.name !== '390' && viewport.name !== '1440') {
    await fill(k13);
    await submit.click();
    check((await out('packs')) === '8', `${label}: К13 → 8 упаковок`);
    await checkOverflow(page, `${label}, с результатом`);
    await page.screenshot({
      path: path.join(outDir, `laminate-${viewport.name}.png`),
      fullPage: true,
    });
    return;
  }

  // К13 через форму при зазоре 8 и пропиле 3 (по умолчанию): поле 3984 × 3484 мм, 19 рядов, последний 10 мм;
  // пары 690 + 534 + 3 ≤ 1380 — те же 57 досок (ручной расчёт в laminate-form.test.ts).
  await fill({ roomLength: '4', roomWidth: '3,5', boardLength: '1380', boardWidth: '193' });
  await field('boardsPerPack').focus();
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  check((await state()) === 'ready', `${label}: Enter выполняет расчёт`);
  check((await out('packs')) === '8', `${label}: К13 → 8 упаковок (${await out('packs')})`);
  check((await out('packsWord')) === 'упаковок', `${label}: «8 упаковок»`);
  check((await out('boards')) === '57', `${label}: 57 досок по плану`);
  check((await out('boardsWithReserve')) === '60', `${label}: 60 досок с запасом 5 %`);
  check((await out('rows')) === '19', `${label}: 19 рядов`);
  check((await out('lastRowWidth')) === '10', `${label}: последний ряд 10 мм (поле без зазора)`);
  check(
    (await out('roomSize')) === '4000 × 3500' &&
      (await out('fieldSize')) === '3984 × 3484' &&
      (await out('gap')) === '8' &&
      (await out('kerf')) === '3' &&
      (await out('rowLength')) === '3984',
    `${label}: комната 4000 × 3500, поле 3984 × 3484, зазор 8, пропил 3, ряд 3984 мм`,
  );
  check(
    (await page.locator('[data-out="kerfLength"], [data-out="offcutLength"]').count()) === 0 &&
      !(await page.locator('[data-calculator-result]').innerText()).match(
        /kerfLength|offcutLength/,
      ),
    `${label}: пропил и обрезки отдельными числами не показываются`,
  );
  check((await out('areaBoards')) === '53 доски', `${label}: по площади 53 доски`);
  check((await out('areaPacks')) === '7 упаковок', `${label}: по площади 7 упаковок`);
  check(
    (await out('pieces')).includes('38 + 9 + 19 − 9 = 57'),
    `${label}: формула досок 38 + 9 + 19 − 9 = 57`,
  );
  check(
    (await out('difference')).startsWith('План больше расчёта по площади на 4 доски'),
    `${label}: объяснение расхождения — «${(await out('difference')).slice(0, 50)}…»`,
  );
  check(
    await page.locator('[data-row="narrowLastRow"]').isVisible(),
    `${label}: подсказка про узкий последний ряд`,
  );
  check(
    (await page.locator('[data-out-list="rowTypes"] li').count()) === 2,
    `${label}: два типа рядов`,
  );

  // Направление и схема — без кнопки. При строгих 400 мм поперёк 1/3 невыполнима; при условиях §8
  // (300 мм, запас 0, без зазора и пропила) — К13 поперёк по 1/3, 56 досок.
  await fill({ gap: '0', kerf: '0' });
  await field('direction').selectOption('width');
  await field('scheme').selectOption('third');
  check(
    (await state()) === 'invalid' &&
      plain(await error('scheme').textContent()).startsWith('Схема 1/3 невыполнима'),
    `${label}: поперёк по 1/3 при 400 мм — невыполнимо, с объяснением`,
  );
  await fill({ minPiece: '300', minOffset: '300', reserve: '0' });
  check(
    (await state()) === 'ready' && (await out('boards')) === '56' && (await out('packs')) === '7',
    `${label}: поперёк по 1/3 при 300 мм и запасе 0 → 56 досок, 7 упаковок (К13, §10)`,
  );
  await field('direction').selectOption('length');
  await field('scheme').selectOption('half');
  await fill({ minPiece: '400', minOffset: '400', reserve: '5', gap: '8', kerf: '3' });
  check((await out('packs')) === '8', `${label}: обратно вдоль по 1/2 → 8 упаковок`);
  await fill({ packPrice: '1849,90' });
  check(
    (await out('totalCost')) === '14 799,20 ₽',
    `${label}: 8 × 1 849,90 = «${await out('totalCost')}»`,
  );
  await checkOverflow(page, `${label}, с результатом`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(outDir, `laminate-${viewport.name}.png`),
    fullPage: true,
  });

  // К7б: строгая 1/3 невыполнима
  await fill({ roomLength: '2,5', roomWidth: '1', boardLength: '1200', boardWidth: '200' });
  await fill({ minPiece: '300', minOffset: '300' });
  await field('scheme').selectOption('third');
  check(
    (await state()) === 'invalid' &&
      plain(await error('scheme').textContent()).startsWith(
        'Схема 1/3 невыполнима для этих размеров',
      ),
    `${label}: К7б → ошибка у поля «Смещение стыков»`,
  );
  check(
    (await field('scheme').getAttribute('aria-invalid')) === 'true',
    `${label}: поле схемы отмечено как ошибочное`,
  );
  if (viewport.name === '390') {
    await page.locator('[data-calculator-result]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `laminate-${viewport.name}-infeasible.png`) });
  }
  await field('scheme').selectOption('half');
  check(
    (await out('boards')) === '13' && (await out('packs')) === '2',
    `${label}: те же размеры по 1/2 → 13 досок, 2 упаковки`,
  );

  // З7а: план меньше расчёта по площади; дробный и граничный пропил (LAMINATE.md §15.5)
  await fill({ roomLength: '2,413', roomWidth: '1', reserve: '0', gap: '8', kerf: '3' });
  check(
    (await out('boards')) === '10' &&
      (await out('areaBoards')) === '11 досок' &&
      (await out('packs')) === '2' &&
      (await out('fieldSize')) === '2397 × 984',
    `${label}: З7а — поле 2397 × 984, 10 досок, по площади 11, 2 упаковки`,
  );
  check(
    (await out('difference')).startsWith(
      'План меньше расчёта по площади на 1 доску: площадь считается по размерам комнаты',
    ) && (await out('difference')).endsWith('Это не экономия и не гарантированный минимум.'),
    `${label}: объяснение «план меньше площади» — «${(await out('difference')).slice(0, 60)}…»`,
  );
  check(
    (await out('wastePercent')) === '1,8' &&
      (await page.getByText('Материал сверх площади укладки', { exact: true }).count()) === 1,
    `${label}: материал сверх площади укладки 1,8 % (${await out('wastePercent')})`,
  );
  await fill({ kerf: '2,3' });
  check(
    (await out('boards')) === '10' && (await out('kerf')) === '2,3',
    `${label}: пропил 2,3 мм не округляется — 10 досок`,
  );
  await fill({ kerf: '3,1' });
  check((await out('boards')) === '12', `${label}: пропил 3,1 мм — пара не помещается, 12 досок`);
  await fill({ kerf: '5', gap: '30' });
  check(
    (await state()) === 'ready' && (await out('kerf')) === '5' && (await out('gap')) === '30',
    `${label}: границы — пропил 5 мм, зазор 30 мм`,
  );
  await fill({ kerf: '0', gap: '0' });
  check(
    (await state()) === 'ready' && (await out('fieldSize')) === '2413 × 1000',
    `${label}: зазор 0 — поле равно комнате`,
  );
  await fill({ roomLength: '2,5', gap: '8', kerf: '3', reserve: '5' });

  // Ошибки ввода
  const expectError = async (values, name, message, title) => {
    await fill(values);
    check(
      (await state()) === 'invalid' && plain(await error(name).textContent()) === message,
      `${label}: ${title} → «${plain(await error(name).textContent())}»`,
    );
  };
  await expectError(
    { boardsPerPack: '8,5' },
    'boardsPerPack',
    'Введите целое число.',
    'дробное число досок',
  );
  await fill({ boardsPerPack: '8' });
  await expectError(
    { minPiece: '1300' },
    'minPiece',
    'Не больше длины доски (1200 мм).',
    'отрезок длиннее доски',
  );
  await fill({ minPiece: '300' });
  await expectError(
    { reserve: '5,55' },
    'reserve',
    'Не больше одного знака после запятой.',
    'запас 5,55 %',
  );
  await expectError(
    { roomWidth: '-1' },
    'roomWidth',
    'Значение должно быть больше нуля.',
    'отрицательная ширина',
  );
  await fill({ reserve: '5', roomWidth: '1' });
  await expectError({ gap: '8,5' }, 'gap', 'Введите целое число миллиметров.', 'дробный зазор');
  await expectError({ gap: '31' }, 'gap', 'Не больше 30 мм.', 'зазор 31 мм');
  await fill({ gap: '8' });
  await expectError({ kerf: '5,1' }, 'kerf', 'Не больше 5 мм.', 'пропил 5,1 мм');
  await expectError(
    { kerf: '2,35' },
    'kerf',
    'Не больше одного знака после запятой.',
    'пропил 2,35 мм',
  );
  await fill({ kerf: '3' });
  check((await state()) === 'ready', `${label}: после исправления — результат`);
  await checkOverflow(page, `${label}, после ошибок`);

  // Порядок Tab: поля и выпадающие списки
  await field('roomLength').focus();
  const order = [];
  for (let i = 0; i < 14; i += 1) {
    order.push(
      await page.evaluate(
        () => document.activeElement?.getAttribute('name') ?? document.activeElement?.textContent,
      ),
    );
    await page.keyboard.press('Tab');
  }
  check(
    order.join(',') ===
      'roomLength,roomWidth,boardLength,boardWidth,boardsPerPack,direction,scheme,minPiece,minOffset,gap,kerf,reserve,packPrice,Рассчитать',
    `${label}: порядок Tab (${order.join(',')})`,
  );

  // Сброс
  await page.locator('form[data-laminate-form] button[type="reset"]').click();
  await page.waitForTimeout(100);
  check(
    (await state()) === 'empty' &&
      (await field('roomLength').inputValue()) === '' &&
      (await field('minPiece').inputValue()) === '400' &&
      (await field('gap').inputValue()) === '8' &&
      (await field('kerf').inputValue()) === '3' &&
      (await field('scheme').inputValue()) === 'half',
    `${label}: «Сбросить» — результат пуст, значения по умолчанию`,
  );
  await checkLinks(page, label);
}

// `--ignore-lock`: сервер в переднем плане и без lock-файла. Без флага Astro под ИИ-агентом уходит в фон
// (его не остановить по pid) и не запускается, если уже работает другой предпросмотр.
const server = spawn('npx', ['astro', 'preview', '--port', String(port), '--ignore-lock'], {
  stdio: 'ignore',
  detached: true,
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
});

try {
  await waitForServer(baseUrl);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();

  for (const viewport of viewports) {
    console.log(`\n— ${viewport.width}×${viewport.height}`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      locale: 'ru-RU',
    });
    // Основные сценарии — с пустыми формами: размеры комнаты из прошлых расчётов не подставляются.
    await context.addInitScript((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // хранилище недоступно
      }
    }, roomKey);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await checkHome(page, viewport);
    await checkCalculator(page, viewport);
    await checkLaminate(page, viewport);
    await checkPaint(page, viewport);
    await checkTile(page, viewport);
    await checkPlaster(page, viewport);
    await checkPutty(page, viewport);
    await checkFormFields(page, viewport);
    await checkCatalogPage(page, viewport);
    await checkRelated(page, viewport);
    if (fullCheckViewports.has(viewport.name)) await checkPresets(page, viewport);
    if (viewport.name !== '768') await checkResultBar(page, viewport);
    if (viewport.name === '320' || viewport.name === '390')
      await checkRoomMemory(browser, viewport);
    if (viewport.name !== '768') await checkShare(browser, viewport);
    if (fullCheckViewports.has(viewport.name)) await checkForcedColors(browser, viewport);
    if (viewport.name !== '768') await checkDesign(browser, viewport);
    if (viewport.name !== '768') await checkSpec(browser, viewport);
    check(
      consoleErrors.length === 0,
      `${viewport.name}: нет ошибок в консоли (${consoleErrors.join(' | ') || '0'})`,
    );

    // 404 и SEO — после проверки консоли: браузер сам пишет в неё об ответах 404.
    const notFound = await page.goto(baseUrl + '/kalkulyatory/nesushchestvuyushchiy/');
    check(notFound?.status() === 404, `${viewport.name}: несуществующий калькулятор отдаёт 404`);
    if (viewport.name === '1440') {
      await checkSeo(page);
      await crawlSite();
    }
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
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nВсе проверки интерфейса пройдены.');
