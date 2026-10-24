# Архитектура

## Стек

| Слой          | Решение                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| Фреймворк     | Astro 7.4.1, `output: 'static'`                                             |
| Язык          | TypeScript 5.9 (`astro/tsconfigs/strictest`)                                |
| Стили         | обычный CSS + CSS-переменные (дизайн-токены), scoped-стили Astro            |
| Клиентский JS | только небольшие `<script>` в компонентах (меню, поиск), без UI-фреймворков |
| Тесты         | Vitest 5 (unit), Playwright — локальный скрипт `scripts/ui-check.mjs`       |
| Качество      | ESLint 10 + typescript-eslint + eslint-plugin-astro, Prettier 3             |
| CI            | GitHub Actions: `.github/workflows/ci.yml`                                  |

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
    calculators.ts        калькуляторы (сейчас 6, все planned)
    catalog.test.ts       проверки целостности каталога
  lib/
    catalog.ts            выборки по каталогу, ссылка только для available
    search.ts             нормализация текста и поиск (используется и при сборке, и в браузере)
    plural.ts             русские формы множественного числа
    *.test.ts             unit-тесты
  layouts/BaseLayout.astro  <head>, метаданные, шапка, подвал
  components/             SiteHeader, SiteFooter, CalculatorCard, CategoryCard, CatalogSearch
  pages/
    index.astro           главная
    404.astro             страница «не найдено»
  styles/
    tokens.css            дизайн-токены
    global.css            базовые стили и утилиты (.container, .section, .visually-hidden)
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
- Сейчас тест требует, чтобы `available`-калькуляторов не было: страниц ещё нет.
  На этапе 2 его нужно заменить проверкой, что для каждого `available` есть страница.

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

## Будущие страницы калькуляторов (план этапа 2)

- URL: `/kalkulyatory/<slug>/` (транслит, со слэшем в конце).
- Логика расчёта — `src/lib/calculators/<id>.ts` + тесты; страница только собирает форму и вызывает функцию.
- Форма работает без перезагрузки (небольшой `<script>`), но содержание страницы (заголовок,
  описание, пояснение формулы) — статический HTML для поисковиков.
