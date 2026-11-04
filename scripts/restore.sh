#!/usr/bin/env bash
# Восстановление сайта из резервной копии на сервере (D-035; инструкция — docs/DEPLOY.md, «Откат»).
#
# Запускается из .github/workflows/restore.yml; можно и локально с теми же переменными, что у deploy.sh
# (scripts/deploy-lib.sh). Дополнительно:
#   RESTORE_BACKUP   list — показать копии и выйти; latest (по умолчанию) — последняя копия;
#                    или имя копии konturix-ГГГГММДД-ЧЧММСС-метка.tar.gz
#   RESTORED_INDEX   необязательно: куда положить index.html из копии (для проверки ответа сайта)
#
# Порядок: настройки и точный путь → выбор копии → копия скачивается и проверяется на раннере → резервная
# копия текущего состояния (ошибка — остановка) → копирование тем же способом, что и при выкладке.
# Восстановление тоже обратимо: «latest» после него — состояние до восстановления. Это не атомарная операция:
# копирование идёт теми же тремя этапами, что и выкладка (scripts/deploy-lib.sh, transfer).
set -euo pipefail

# shellcheck source=scripts/deploy-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/deploy-lib.sh"

choice="${RESTORE_BACKUP:-latest}"
check_settings
[[ "$choice" == list || "$choice" == latest || "$choice" =~ $BACKUP_NAME_RE ]] ||
  fail 'RESTORE_BACKUP: нужно list, latest или имя копии вида konturix-20261104-120000-abc1234.tar.gz.'

setup_ssh
preflight

listing=$(remote list) || fail 'Не удалось получить список резервных копий.'
if [[ "$choice" == list ]]; then
  if [[ -z "$listing" ]]; then
    echo 'Резервных копий пока нет.'
  else
    echo 'Резервные копии (новые сверху; имя и размер в байтах):'
    printf '%s\n' "$listing"
  fi
  exit 0
fi

[[ -n "$listing" ]] || fail 'Резервных копий нет — восстанавливать не из чего.'
if [[ "$choice" == latest ]]; then
  name="${listing%%$'\n'*}"
  name="${name%% *}"
else
  name=''
  while read -r candidate _; do
    [[ "$candidate" == "$choice" ]] && name="$candidate"
  done <<<"$listing"
  [[ -n "$name" ]] || fail "Копии $choice на сервере нет. Список — запуск с RESTORE_BACKUP=list."
fi
[[ "$name" =~ $BACKUP_NAME_RE ]] || fail 'Сервер вернул неожиданное имя копии.'
echo "Восстанавливается копия: $name."

# Копия скачивается на раннер и проверяется до любых изменений на сервере.
archive="$workdir/backup.tar.gz"
remote cat "$name" >"$archive" || fail 'Не удалось скачать резервную копию — на сервере ничего не изменено.'
gzip -t "$archive" 2>/dev/null || fail 'Резервная копия повреждена — на сервере ничего не изменено.'
site_base="${SITE_DIR##*/}"
# Внутри — только папка сайта: обычные файлы и папки, без ссылок, абсолютных путей и «..».
# (Без grep -q: ранний выход grep оборвал бы tar сигналом PIPE, и с pipefail проверка бы не сработала.)
other_types=$(tar -tvzf "$archive" | cut -c1 | grep -v '^[-d]$' || true)
[[ -z "$other_types" ]] || fail 'В резервной копии есть ссылки или специальные файлы — восстановление остановлено.'
while IFS= read -r entry; do
  [[ "$entry" == "$site_base" || "$entry" == "$site_base/"* ]] ||
    fail 'В резервной копии есть файлы вне папки сайта — восстановление остановлено.'
  [[ "/$entry/" != *'/../'* ]] || fail 'В резервной копии есть путь с «..» — восстановление остановлено.'
done < <(tar -tzf "$archive")

restore_root="$workdir/restore"
mkdir "$restore_root"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$restore_root"
src="$restore_root/$site_base"
[[ -d "$src" ]] || fail 'В резервной копии нет папки сайта.'
# Служебное не восстанавливается: .well-known на сервере не трогается, остатки прерванных копирований
# (.~tmp~ у rsync, .in.* у lftp) не нужны.
rm -rf "${src:?}/.well-known"
find "$src" -depth -name '.~tmp~' -exec rm -rf {} +
find "$src" -name '.in.*' -type f -delete
echo "В копии: $(find "$src" -type f | wc -l) файлов."
if [[ -n "${RESTORED_INDEX:-}" && -f "$src/index.html" ]]; then
  cp "$src/index.html" "$RESTORED_INDEX"
fi

# Копия текущего состояния; восстанавливаемая копия передаётся как защищённая — ротация её не удалит.
make_backup restore "$name"
transfer "$src"
echo "Готово: папка сайта восстановлена из $name."
