#!/usr/bin/env bash
# Проверка после выкладки или восстановления: главная страница по адресу SITE_URL отвечает 200 и совпадает
# байт в байт с ожидаемым файлом ($1 — index.html из сборки или из резервной копии). Так ответ старой версии,
# заглушки хостинга или другого сервера с кодом 200 не считается успехом (D-035).
set -euo pipefail

expected="${1:?нужен путь к ожидаемому index.html}"
[[ -n "${SITE_URL:-}" ]] || {
  echo '::error::Не задан SITE_URL.' >&2
  exit 1
}
if [[ ! -s "$expected" ]]; then
  echo "::warning::Нет файла для сравнения ($expected) — проверка ответа сайта пропущена."
  exit 0
fi

served=$(mktemp)
trap 'rm -f "$served"' EXIT
attempts="${CHECK_ATTEMPTS:-5}"
for ((attempt = 1; attempt <= attempts; attempt++)); do
  status=$(curl -sS -o "$served" -w '%{http_code}' --max-time 30 -H 'Cache-Control: no-cache' "$SITE_URL/") ||
    status=000
  if [[ "$status" == 200 ]] && cmp -s "$served" "$expected"; then
    echo "$SITE_URL/ → 200, отдаётся ожидаемая версия главной страницы."
    exit 0
  fi
  echo "Попытка $attempt из $attempts: $SITE_URL/ → $status, $(wc -c <"$served") байт; ожидалось 200 и $(wc -c <"$expected") байт."
  ((attempt == attempts)) || sleep "${CHECK_DELAY:-10}"
done
if [[ "$status" == 200 ]]; then
  echo "::error::Сайт отвечает 200, но отдаёт не ту главную страницу (старая версия, заглушка хостинга или другой сервер). Файлы выложены; что делать — docs/DEPLOY.md, «Если что-то не так»." >&2
else
  echo "::error::Главная страница ответила $status — проверьте SSL-сертификат и привязку домена (docs/DEPLOY.md, «Если что-то не так»)." >&2
fi
exit 1
