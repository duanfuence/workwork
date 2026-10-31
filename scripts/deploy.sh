#!/usr/bin/env bash
# Выкладка собранного сайта (dist/) на виртуальный хостинг по SSH (D-034, инструкция — docs/DEPLOY.md).
#
# Запускается из .github/workflows/deploy.yml после проверок; можно запустить и локально с теми же переменными.
# Переменные окружения (в GitHub — секреты):
#   DEPLOY_HOST         адрес сервера (IP или имя) — тот же, что в строке known_hosts
#   DEPLOY_USER         логин SSH (на REG.RU — вида u1234567)
#   DEPLOY_PATH         корневая папка сайта на сервере, полный путь (/var/www/u1234567/data/www/konturix.ru)
#   DEPLOY_KNOWN_HOSTS  строка(и) known_hosts сервера: ключ хоста проверяется, без StrictHostKeyChecking=no
#   DEPLOY_SSH_KEY      закрытый ключ для выкладки (предпочтительно)
#   DEPLOY_PASSWORD     пароль SSH — только если хостинг не принимает ключ (через sshpass, из окружения)
#   DEPLOY_PORT         порт SSH, по умолчанию 22
#   DEPLOY_METHOD       auto (по умолчанию) | rsync | sftp — способ копирования; auto выбирает rsync, если он
#                       есть на сервере, иначе зеркалирование по SFTP через lftp
#   DIST_DIR            папка сборки, по умолчанию dist
#
# Ни один секрет не выводится: нет `set -x`, ключ и known_hosts — во временных файлах с правами 600, пароль —
# только в переменной окружения SSHPASS / LFTP_PASSWORD, не в командной строке.
set -euo pipefail

fail() {
  echo "::error::$1" >&2
  exit 1
}

DIST_DIR="${DIST_DIR:-dist}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_METHOD="${DEPLOY_METHOD:-auto}"

for name in DEPLOY_HOST DEPLOY_USER DEPLOY_PATH DEPLOY_KNOWN_HOSTS; do
  [[ -n "${!name:-}" ]] || fail "Не задан секрет ${name} (docs/DEPLOY.md, шаг 4)."
done
[[ -n "${DEPLOY_SSH_KEY:-}" || -n "${DEPLOY_PASSWORD:-}" ]] ||
  fail 'Не задан ни DEPLOY_SSH_KEY, ни DEPLOY_PASSWORD (docs/DEPLOY.md, шаг 2).'
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]] || fail 'DEPLOY_PORT — не число.'

# Защита: --delete удаляет на сервере всё, чего нет в сборке. Путь — полный и не корень системы или домашней папки.
path="${DEPLOY_PATH%/}"
[[ -n "$path" ]] || fail 'DEPLOY_PATH не может быть корнем «/».'
[[ "$path" == /* ]] || fail 'DEPLOY_PATH должен быть полным путём, начинаться с «/».'
[[ "$path" =~ ^/[^/]+/[^/]+ ]] || fail 'DEPLOY_PATH слишком короткий — это не папка сайта.'
[[ "$path" != *'..'* ]] || fail 'DEPLOY_PATH не должен содержать «..».'

# Защита от пустой выкладки: без этих файлов сборка неполная, и --delete стёр бы рабочий сайт.
for file in index.html 404.html .htaccess robots.txt sitemap.xml; do
  [[ -s "$DIST_DIR/$file" ]] || fail "В $DIST_DIR нет $file — выкладка остановлена до копирования."
done
pages=$(find "$DIST_DIR" -name index.html -type f | wc -l)
((pages >= 2)) || fail "В $DIST_DIR всего $pages страниц — выкладка остановлена."
echo "Сборка: $pages страниц, $(find "$DIST_DIR" -type f | wc -l) файлов."

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
chmod 700 "$workdir"
known_hosts="$workdir/known_hosts"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$known_hosts"
chmod 600 "$known_hosts"

ssh_options=(-p "$DEPLOY_PORT" -o "UserKnownHostsFile=$known_hosts" -o StrictHostKeyChecking=yes
  -o ConnectTimeout=30 -o ServerAliveInterval=15)
pass=()
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  key="$workdir/key"
  printf '%s\n' "$DEPLOY_SSH_KEY" >"$key"
  chmod 600 "$key"
  ssh_options+=(-i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no)
  echo 'Вход: SSH-ключ.'
else
  command -v sshpass >/dev/null || fail 'Для входа по паролю нужен sshpass.'
  export SSHPASS="$DEPLOY_PASSWORD"
  pass=(sshpass -e)
  # Без ключа ssh сам пробует пароль и keyboard-interactive. Списка методов через запятую нет намеренно:
  # printf %q для rsync -e экранировал бы запятую, и ssh получил бы неверное имя метода.
  ssh_options+=(-o PubkeyAuthentication=no)
  echo 'Вход: пароль (ключ не задан).'
fi
# shellcheck disable=SC2153 # DEPLOY_HOST проверен выше через ${!name}
target="$DEPLOY_USER@$DEPLOY_HOST"

# Проверка входа и папки сайта; заодно — есть ли rsync на сервере.
remote_rsync=$("${pass[@]}" ssh "${ssh_options[@]}" "$target" \
  "test -d '$path' || { echo 'no-dir'; exit 0; }; command -v rsync >/dev/null && echo rsync || echo none") ||
  fail 'Не удалось войти по SSH: проверьте адрес, логин, ключ (или пароль) и строку known_hosts.'
[[ "$remote_rsync" != 'no-dir' ]] || fail 'На сервере нет папки DEPLOY_PATH — проверьте путь (docs/DEPLOY.md, шаг 1).'

method="$DEPLOY_METHOD"
if [[ "$method" == auto ]]; then
  if [[ "$remote_rsync" == rsync ]]; then method=rsync; else method=sftp; fi
fi
echo "Способ копирования: $method."

if [[ "$method" == rsync ]]; then
  # Права для хостинга: папки 755, файлы 644; владелец и группа — пользователя на сервере.
  # .well-known/ на сервере не удаляется: туда хостинг кладёт файлы для выпуска SSL-сертификата.
  # Пароль (если нет ключа) — sshpass внутри команды ssh, которую запускает rsync: обёртка вокруг всего rsync
  # пароль до ssh не доносит.
  rsync --recursive --links --times --perms --compress --delete --delay-updates \
    --chmod=D755,F644 --filter='P .well-known/' --stats \
    -e "${pass[*]} ssh $(printf '%q ' "${ssh_options[@]}")" \
    "$DIST_DIR/" "$target:$path/"
elif [[ "$method" == sftp ]]; then
  command -v lftp >/dev/null || fail 'Для зеркалирования по SFTP нужен lftp.'
  ssh_command="ssh -a -x $(printf '%q ' "${ssh_options[@]}")"
  [[ ${#pass[@]} -eq 0 ]] || export LFTP_PASSWORD="$DEPLOY_PASSWORD"
  login=(-u "$DEPLOY_USER,")
  [[ ${#pass[@]} -eq 0 ]] || login=(--env-password -u "$DEPLOY_USER")
  lftp -c "set sftp:connect-program \"$ssh_command\"; set net:max-retries 2; set net:timeout 30;
    open ${login[*]} sftp://$DEPLOY_HOST;
    mirror --reverse --delete --verbose=1 --exclude-glob .well-known/ --exclude-glob .well-known/* \
      $(printf '%q' "$DIST_DIR/") $(printf '%q' "$path/")"
else
  fail "Неизвестный DEPLOY_METHOD: $method (auto, rsync или sftp)."
fi

echo "Готово: сайт выложен в папку сайта на $DEPLOY_HOST."
