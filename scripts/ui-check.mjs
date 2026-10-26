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
import { mkdir } from 'node:fs/promises';
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
    (await field('wallCount').inputValue()) === '1' &&
      (await field('thickness').inputValue()) === '10' &&
      (await field('consumption').inputValue()) === '' &&
      (await field('reserve').inputValue()) === '10',
    `${label}: по умолчанию 1 стена, слой 10 мм, запас 10 %, расход пуст`,
  );
  await page.locator('form[data-plaster-form] button[type="submit"]').click();
  check(
    (await state()) === 'invalid' && (await page.locator('[data-error-summary] li').count()) === 3,
    `${label}: пустая форма — 3 ошибки (длина, высота, расход)`,
  );
  // Ш2 (PLASTER.md): 4 стены 4 × 2,7, проёмы 3,9, слой 15, расход 0,85, запас 10 %, мешок 25 кг.
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
    (await field('wallCount').inputValue()) === '1' &&
      (await field('layers').inputValue()) === '1' &&
      (await field('consumption').inputValue()) === '' &&
      (await field('reserve').inputValue()) === '10',
    `${label}: по умолчанию 1 стена, 1 слой, запас 10 %, расход пуст`,
  );
  await page.locator('form[data-putty-form] button[type="submit"]').click();
  check(
    (await state()) === 'invalid' && (await page.locator('[data-error-summary] li').count()) === 3,
    `${label}: пустая форма — 3 ошибки (длина, высота, расход)`,
  );
  // Шп2 (PUTTY.md): 4 стены 4 × 2,7, проёмы 3,9, 2 слоя по 1,1 кг/м², запас 10 %, упаковка 20 кг.
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
