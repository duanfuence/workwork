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
const calcPath = '/kalkulyatory/oboi/';
const laminatePath = '/kalkulyatory/laminat/';
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
  const h1 = (await page.textContent('h1'))?.trim();
  check(h1 === 'ДомРасчёт', `${label}: h1 кириллицей «${h1}»`);
  await checkOverflow(page, label);
  if (!fullCheckViewports.has(viewport.name)) {
    await page.screenshot({ path: path.join(outDir, `home-${viewport.name}.png`), fullPage: true });
    return;
  }

  // Каталог: обои и ламинат опубликованы, остальные — «Скоро» без ссылок
  const cards = page.locator('#catalog-list > li');
  check((await cards.count()) === 6, `${label}: 6 карточек калькуляторов`);
  const cardLinks = await page
    .locator('#catalog-list a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  check(
    cardLinks.join(',') === [calcPath, laminatePath].join(','),
    `${label}: ссылки только у калькуляторов обоев и ламината (${cardLinks.join(', ')})`,
  );
  check(
    (await page.locator('#catalog-list .badge--soon').count()) === 4,
    `${label}: 4 карточки со статусом «Скоро»`,
  );
  check(
    plain(await page.locator('#catalog-list > li').first().textContent()).includes(
      'Калькулятор обоев',
    ),
    `${label}: доступный калькулятор стоит первым`,
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
    await page.locator('#site-nav a[href="/#categories"]').click();
    await page.waitForTimeout(600);
    check(!(await nav.isVisible()), `${label}: меню закрывается после выбора пункта`);
    check(page.url().endsWith('#categories'), `${label}: переход к «Категориям»`);
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

const server = spawn('npx', ['astro', 'preview', '--port', String(port)], {
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
    check(
      consoleErrors.length === 0,
      `${viewport.name}: нет ошибок в консоли (${consoleErrors.join(' | ') || '0'})`,
    );

    // 404 — после проверки консоли: браузер сам пишет в неё об ответе 404.
    const notFound = await page.goto(baseUrl + '/kalkulyatory/kraska/');
    check(notFound?.status() === 404, `${viewport.name}: неготовый калькулятор отдаёт 404`);
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
