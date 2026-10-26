# Архитектура

## Стек

| Слой          | Решение                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Фреймворк     | Astro 7.4.1, `output: 'static'`                                                                 |
| Язык          | TypeScript 5.9 (`astro/tsconfigs/strictest`)                                                    |
| Стили         | обычный CSS + CSS-переменные (дизайн-токены), scoped-стили Astro                                |
| Клиентский JS | только небольшие `<script>` в компонентах (меню, поиск, форма калькулятора), без UI-фреймворков |
| Тесты         | Vitest 5 (unit), Playwright 1.63 (devDependency) — `scripts/ui-check.mjs`, локально и в CI      |
| Качество      | ESLint 10 + typescript-eslint + eslint-plugin-astro, Prettier 3                                 |
| CI            | GitHub Actions: `.github/workflows/ci.yml`                                                      |

Почему такие версии — см. `DECISIONS.md` (D-004).

## Структура

```
astro.config.mjs          конфигурация Astro (статика, trailingSlash: always, site из SITE_URL)
src/
  config/
    site.ts               название, описание, язык, цвет темы
    navigation.ts         пункты меню, адрес каталога catalogPath, isCurrentSection (aria-current)
  data/
    catalog.types.ts      типы каталога: Category, CalculatorEntry, CalculatorStatus, CalculatorSeo
    categories.ts         4 категории
    material-presets.ts   ориентиры расхода краски, штукатурки, шпаклёвки (docs/research/MATERIAL_PRESETS.md)
    calculators.ts        калькуляторы (6: обои и ламинат — available, остальные planned)
    catalog.test.ts       проверки целостности каталога
  lib/
    catalog.ts            выборки по каталогу: ссылка только для available, getAvailableCalculators,
                          getCatalogSections (категории с калькуляторами), getRelatedCalculators
    search.ts             нормализация текста и поиск (используется и при сборке, и в браузере)
    plural.ts             русские формы множественного числа
    number.ts             разбор чисел из полей, ceilDiv, перевод м/см → целые мм
    validation.ts         общие проверки полей: checkRequired, checkOptional, hasPrecision, fmt
    site-url.ts           проверка SITE_URL (https, без пути) → адрес сайта или undefined
    seo.ts                канонический адрес, sitemap.xml, robots.txt (чистые функции)
    breadcrumbs.ts        цепочка калькулятора и её JSON-LD BreadcrumbList — один источник
  integrations/
    seo-files.mjs         SITE_URL из окружения; хук сборки пишет robots.txt и (с адресом) sitemap.xml
    format.ts             числа и рубли по-русски (Intl, ru-RU)
    form.ts               общий разбор текстовых полей в числа и объединение ошибок (без DOM)
    presets.ts            связь «тип материала ↔ значение поля» для ориентиров расхода (без DOM)
    share-link.ts         ссылка на расчёт (?v=1&…) и текст «Скопировать итог» (без DOM)
    room-memory.ts        размеры комнаты между калькуляторами: что сохранять и подставлять, формат (без DOM)
    result-bar.ts         панель итога на телефоне и объявление итога: когда показывать, что писать (без DOM)
    calculators/
      wallpaper.ts        расчёт обоев: проверка ввода + алгоритм (чистая функция)
      wallpaper-form.ts   поля формы обоев: разбор (через form.ts) и вызов расчёта
      laminate.ts         расчёт ламината: ряды по схеме смещения, доски по парам отрезков, упаковки
      laminate-form.ts    поля формы ламината (числа + направление и схема)
    *.test.ts             unit-тесты рядом с модулями
  layouts/BaseLayout.astro  <head>, метаданные, шапка, подвал
  components/             SiteHeader, SiteFooter, CalculatorCard, CategoryCard, CatalogSearch, Breadcrumbs,
                          RelatedCalculators («Другие калькуляторы» на страницах калькуляторов)
    calculator/NumberField.astro       поле ввода числа: label, единица, подсказка, место для ошибки
    calculator/SelectField.astro       выпадающий список с подписью, подсказкой и местом для ошибки
    calculator/PresetSelect.astro      выбор «Тип материала»: подставляет ориентир расхода в поле
    calculator/PresetTable.astro       таблица ориентиров расхода в статье калькулятора
    calculator/CalculatorResult.astro  блок результата: заголовок, состояния «до расчёта / ошибки / результат»,
                                       скрытая область объявления итога, панель итога на телефоне
  client/
    calculator-form.ts    поведение формы калькулятора в браузере (общее для всех калькуляторов)
  pages/
    index.astro           главная
    404.astro             страница «не найдено»
    kalkulyatory/oboi.astro  калькулятор обоев → /kalkulyatory/oboi/
    kalkulyatory/index.astro  каталог всех опубликованных калькуляторов по категориям → /kalkulyatory/
    kalkulyatory/laminat.astro  калькулятор ламината → /kalkulyatory/laminat/
  styles/
    tokens.css            дизайн-токены
    global.css            базовые стили и утилиты (.container, .section, .visually-hidden, .button)
    calculator.css        общие стили страниц калькуляторов
public/favicon.svg
public/og.png             Open Graph-изображение 1200 × 630 (npm run og:image из scripts/og/og-image.html)
scripts/ui-check.mjs      Playwright-проверка главной и калькуляторов (локально и в CI)
```

## Каталог

Каталог — единственный источник данных о калькуляторах: главная, поиск, а в будущем страницы
калькуляторов и sitemap строятся из `src/data/calculators.ts`.

```ts
interface CalculatorEntry {
  id: string; // стабильный id: 'wallpaper'
  slug: string; // часть URL: 'oboi'
  title: string;
  category: CategoryId; // 'repair' | 'construction' | 'area-volume' | 'cost'
  description: string;
  path: `/kalkulyatory/${string}/`;
  status: 'planned' | 'in-progress' | 'available';
  popular: boolean;
  searchTerms: readonly string[];
  seo: { title: string; description: string; keywords: readonly string[] };
}
```

Правила:

- `path` всегда равен `/kalkulyatory/<slug>/` (проверяется тестом).
- Ссылка выводится только для `status: 'available'` — через `getCalculatorHref()`.
  Остальные карточки показываются с бейджем «Скоро» и без ссылки.
- Тест `src/data/catalog.test.ts` сверяет файлы в `src/pages/kalkulyatory/` (через `import.meta.glob`)
  с записями `available`: страница без записи или запись без страницы — ошибка.

## Поиск

- При сборке для каждой карточки формируется строка `data-search-index`
  (`buildSearchIndex`: название + описание + `searchTerms` + `seo.keywords`, нормализовано).
- В браузере `CatalogSearch` фильтрует карточки функцией `matchesQuery` — той же, что покрыта тестами.
- Нормализация: NFKC, нижний регистр, «ё» → «е», только буквы/цифры. Каждое слово запроса должно
  совпадать с началом какого-либо слова индекса.
- Без JavaScript форма поиска скрыта (атрибут `hidden`), чтобы не показывать неработающий элемент.

## Навигация

На ширине < 768 px меню сворачивается в кнопку «Меню» (только если JS доступен: класс `js` на `<html>`
ставится inline-скриптом). Без JS ссылки остаются видимыми строкой. Меню закрывается при выборе пункта и по Escape.

## Страница калькулятора (образец — обои)

- Файл `src/pages/kalkulyatory/<slug>.astro` → URL `/kalkulyatory/<slug>/`. Отдельный файл на калькулятор,
  а не `[slug].astro`: у каждого калькулятора своя форма и свой текст.
- `title`/`description` берутся из `seo` записи каталога; H1 — `title` записи.
- Слои и границы ответственности:

  | Слой            | Где                                                    | Общий / свой | Отвечает за                                                                                                                                                                                                                                        |
  | --------------- | ------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Математика      | `src/lib/calculators/<id>.ts`                          | свой         | проверка допустимых значений (общие проверки — `src/lib/validation.ts`), формулы, `{ ok, result }` / `{ ok: false, errors }`; никогда NaN/Infinity                                                                                                 |
  | Разбор полей    | `src/lib/form.ts` + `src/lib/calculators/<id>-form.ts` | общий + свой | текст → число (`parseNumberFields`), «Введите число.», приоритет ошибок разбора (`withParseErrors`); список полей и особые правила калькулятора (у обоев — игнор размеров проёмов при нуле проёмов)                                                |
  | Поведение формы | `src/client/calculator-form.ts`                        | общий        | чтение полей (`input` и `select`), ошибки у полей и сводка, фокус и прокрутка к первому ошибочному полю, состояния блока результата, вывод текста, строк и списков, пересчёт после первой отправки, сброс; панель итога и объявление итога (D-024) |
  | Разметка        | `NumberField`, `CalculatorResult`, `calculator.css`    | общий        | поле с подписью, единицей, подсказкой и местом для ошибки; блок результата с тремя состояниями                                                                                                                                                     |
  | Страница        | `src/pages/kalkulyatory/<slug>.astro`                  | свой         | состав полей и групп, строки результата (`data-out`, `data-row`), функция `render` с форматированием и коротким итогом `view.summary`, текст статьи                                                                                                |
  | Форматирование  | `src/lib/format.ts`, `src/lib/plural.ts`               | общий        | числа, рубли, склонения                                                                                                                                                                                                                            |

  Общий механизм не знает формул и состава результата: страница передаёт ему `fields`, `evaluate` и `render`.
  Математика не знает о DOM. Обобщать дальше (конфигурация полей, генерация форм) не нужно, пока нет второго
  калькулятора, которому это реально требуется.

- Поведение формы: до первой отправки ошибки не показываются; после «Рассчитать» результат пересчитывается
  при каждом вводе. Ошибки — у поля (`aria-invalid`, `aria-describedby`) и сводкой со ссылками в блоке результата;
  фокус переходит на первое поле с ошибкой (с прокруткой мимо липкой шапки) или на заголовок результата.
  При ошибках результат скрывается — устаревшие цифры не показываются. «Сбросить» возвращает значения по умолчанию.
- Ссылка на расчёт (D-027): кнопки в `CalculatorResult`, логика в общем механизме; страница передаёт в `render`
  `view.report(параметры, к покупке)`. Ссылка `?v=1&…` — значения видимых полей; при открытии форма заполняется
  и считается, значения ссылки важнее сохранённых размеров. Разбор — `src/lib/share-link.ts`.
- Размеры комнаты (D-026): поля `roomLength`, `roomWidth`, `wallHeight` общий механизм сохраняет в `localStorage`
  после успешного расчёта (если видны длина и ширина помещения) и подставляет в пустые поля при открытии; логика —
  `src/lib/room-memory.ts`. Странице ничего делать не нужно — достаточно этих имён полей.
- Поля одного режима (D-025): `showWhen="mode=room"` у `NumberField` / `SelectField` — поле видно, пока в выборе
  `mode` значение `room`; переключает общий механизм. `evaluate…Form` страницы разбирает только поля выбранного
  режима (шпаклёвка, штукатурка: «помещение / отдельные стены»).
- Итог на виду (D-024): на экране уже 960 px, когда главный итог вне экрана, внизу закреплена панель с коротким
  итогом (`view.summary`) — кнопка «К результату»; при ошибках — «Исправьте значения в полях»; при открытой
  клавиатуре и до первого расчёта панели нет. Диктор слышит итог по «Рассчитать» и после паузы ввода 1 с
  (`[data-result-announce]`), а не на каждое нажатие.
- Без JavaScript расчёт недоступен (сообщение в `<noscript>`), текст страницы и формулы остаются.
- Калькулятор обоев: алгоритм, допущения, аудит — `docs/calculators/WALLPAPER.md`.

### Как добавить калькулятор (например, ламинат)

1. `docs/calculators/<ID>.md`: алгоритм, допущения, ограничения, контрольные примеры, посчитанные вручную.
2. `src/lib/calculators/<id>.ts` + тесты по контрольным примерам и свойствам (перебор для неизвестных данных).
3. `src/lib/calculators/<id>-form.ts`: список полей, `evaluate…Form` через `parseNumberFields` / `withParseErrors`.
4. Страница: `NumberField` в `<fieldset class="calc-group">`, `CalculatorResult` со строками результата,
   `<script>` с `initCalculatorForm({ form, result, fields, evaluate, render })`; в `render` — `view.summary(…)`
   с главным итогом одной строкой («11,9 л краски · 5 банок») и `view.report([...параметры], 'к покупке')`.
5. Статус `available` в каталоге — после `npm run check` и `npm run ui:check` (добавить проверки страницы в `scripts/ui-check.mjs`).

## Телеметрия

Анонимная телеметрия Astro отключена переменной `ASTRO_TELEMETRY_DISABLED=1` в npm-скриптах и CI (D-008).
