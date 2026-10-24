# Архитектура

## Стек

| Слой          | Решение                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Фреймворк     | Astro 7.4.1, `output: 'static'`                                                                 |
| Язык          | TypeScript 5.9 (`astro/tsconfigs/strictest`)                                                    |
| Стили         | обычный CSS + CSS-переменные (дизайн-токены), scoped-стили Astro                                |
| Клиентский JS | только небольшие `<script>` в компонентах (меню, поиск, форма калькулятора), без UI-фреймворков |
| Тесты         | Vitest 5 (unit), Playwright — локальный скрипт `scripts/ui-check.mjs`                           |
| Качество      | ESLint 10 + typescript-eslint + eslint-plugin-astro, Prettier 3                                 |
| CI            | GitHub Actions: `.github/workflows/ci.yml`                                                      |

Почему такие версии — см. `DECISIONS.md` (D-004).

## Структура

```
astro.config.mjs          конфигурация Astro (статика, trailingSlash: always)
src/
  config/
    site.ts               название, описание, язык, цвет темы
    navigation.ts         пункты меню (только существующие разделы)
  data/
    catalog.types.ts      типы каталога: Category, CalculatorEntry, CalculatorStatus, CalculatorSeo
    categories.ts         4 категории
    calculators.ts        калькуляторы (6: обои — available, остальные planned)
    catalog.test.ts       проверки целостности каталога
  lib/
    catalog.ts            выборки по каталогу, ссылка только для available
    search.ts             нормализация текста и поиск (используется и при сборке, и в браузере)
    plural.ts             русские формы множественного числа
    number.ts             разбор чисел из полей, ceilDiv, перевод м/см → целые мм
    format.ts             числа и рубли по-русски (Intl, ru-RU)
    calculators/
      wallpaper.ts        расчёт обоев: проверка ввода + алгоритм (чистая функция)
      wallpaper-form.ts   разбор текстовых полей формы и вызов расчёта
    *.test.ts             unit-тесты рядом с модулями
  layouts/BaseLayout.astro  <head>, метаданные, шапка, подвал
  components/             SiteHeader, SiteFooter, CalculatorCard, CategoryCard, CatalogSearch, Breadcrumbs
    calculator/NumberField.astro  поле ввода числа: label, единица, подсказка, место для ошибки
  pages/
    index.astro           главная
    404.astro             страница «не найдено»
    kalkulyatory/oboi.astro  калькулятор обоев → /kalkulyatory/oboi/
  styles/
    tokens.css            дизайн-токены
    global.css            базовые стили и утилиты (.container, .section, .visually-hidden, .button)
    calculator.css        общие стили страниц калькуляторов
public/favicon.svg
scripts/ui-check.mjs      Playwright-проверка главной
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
- Слои:
  1. `src/lib/calculators/<id>.ts` — чистая функция `calculate…(input)`: сама проверяет ввод и возвращает
     `{ ok: true, result }` или `{ ok: false, errors }` (ошибки по полям). Никогда не возвращает NaN/Infinity.
  2. `src/lib/calculators/<id>-form.ts` — текст полей → числа (`parseDecimal`) → расчёт.
  3. Страница: разметка формы (`NumberField` в `<fieldset>`), блок результата, статья; клиентский `<script>`
     только читает поля, вызывает (2) и выводит ошибки/результат. Математики в `.astro` нет.
- Поведение формы: до первой отправки ошибки не показываются; после «Рассчитать» результат пересчитывается
  при каждом вводе. Ошибки — у поля (`aria-invalid`, `aria-describedby`) и сводкой со ссылками в блоке результата;
  фокус переходит на первое поле с ошибкой (с прокруткой мимо липкой шапки) или на заголовок результата.
  При ошибках результат скрывается — устаревшие цифры не показываются. «Сбросить» возвращает значения по умолчанию.
- Без JavaScript расчёт недоступен (сообщение в `<noscript>`), текст страницы и формулы остаются.
- Калькулятор обоев: алгоритм и допущения — `docs/calculators/WALLPAPER.md`.

## Телеметрия

Анонимная телеметрия Astro отключена переменной `ASTRO_TELEMETRY_DISABLED=1` в npm-скриптах и CI (D-008).
