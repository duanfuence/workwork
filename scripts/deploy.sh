#!/usr/bin/env bash
# Выкладка собранного сайта (dist/) на хостинг по SSH (D-034, D-035; инструкция — docs/DEPLOY.md).
#
# Запускается из .github/workflows/deploy.yml после проверок; можно запустить и локально с теми же переменными
# (список — в scripts/deploy-lib.sh). Дополнительно: DIST_DIR — папка сборки, по умолчанию dist.
#
# Порядок: настройки и точный путь → полнота сборки → вход и папка сайта (только чтение) → резервная копия
# (ошибка — остановка) → копирование. До резервной копии на сервере ничего не меняется.
set -euo pipefail

# shellcheck source=scripts/deploy-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/deploy-lib.sh"

DIST_DIR="${DIST_DIR:-dist}"

check_settings

# Защита от пустой выкладки: без этих файлов сборка неполная, и удаление лишнего стёрло бы рабочий сайт.
for file in index.html 404.html .htaccess robots.txt sitemap.xml; do
  [[ -s "$DIST_DIR/$file" ]] || fail "В $DIST_DIR нет $file — выкладка остановлена до подключения к серверу."
done
pages=$(find "$DIST_DIR" -name index.html -type f | wc -l)
((pages >= 2)) || fail "В $DIST_DIR всего $pages страниц — выкладка остановлена до подключения к серверу."
echo "Сборка: $pages страниц, $(find "$DIST_DIR" -type f | wc -l) файлов."

setup_ssh
preflight

# Метка копии — коммит, который выкладывается (первые 7 знаков), или «manual» при запуске вне GitHub.
label=manual
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] && label="${GITHUB_SHA:0:7}"
make_backup "$label"

transfer "$DIST_DIR"
echo 'Готово: сайт выложен в папку сайта.'
