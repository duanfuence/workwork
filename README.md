# ДомРасчёт

Бесплатный русскоязычный сайт калькуляторов для ремонта и строительства: обои, ламинат, краска, плитка,
штукатурка и шпаклёвка. Статический сайт на Astro.

```bash
npm ci                    # установка зависимостей
npm run dev               # локальный сервер разработки
npm run check             # типы, линтер, форматирование, тесты, сборка
npm run ui:check          # проверка интерфейса в Playwright (после сборки)
npm run og:image          # пересоздать public/og.png из scripts/og/og-image.html
```

## Адрес сайта: `SITE_URL`

Абсолютный адрес сайта задаётся переменной окружения `SITE_URL` при сборке — только `https://<домен>`,
без пути, параметров и якоря. С ней сборка выводит canonical, `og:url`, `og:image`, JSON-LD хлебных крошек,
создаёт `sitemap.xml` и добавляет строку `Sitemap` в `robots.txt`. Без неё всё это не выводится.
Неверное значение останавливает сборку с объяснением.

```bash
SITE_URL=https://konturix.ru npm run build
```

## Выкладка: konturix.ru на REG.RU

Сайт выкладывается на виртуальный хостинг REG.RU (Apache) автоматически после слияния в `main`
(`.github/workflows/deploy.yml`): проверки и сборка с `SITE_URL` из переменной репозитория, затем копирование
`dist/` по SSH (`scripts/deploy.sh`: rsync, а без него на сервере — SFTP). Настройки сервера — `public/.htaccess`
(https без www, слэш на конце, 404, кэш, сжатие). Что добавить в GitHub и как проверить выкладку —
[docs/DEPLOY.md](docs/DEPLOY.md); решение — D-034.

Требуется Node.js ≥ 22.22.0. Правила работы — [CLAUDE.md](CLAUDE.md), документация — [docs/](docs/),
SEO — [docs/SEO_STRATEGY.md](docs/SEO_STRATEGY.md).
