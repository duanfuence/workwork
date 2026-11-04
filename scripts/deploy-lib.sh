# shellcheck shell=bash
# Общая часть выкладки (deploy.sh) и восстановления (restore.sh): проверки, вход по SSH, резервная копия,
# копирование файлов. Решения — docs/DECISIONS.md, D-034 и D-035; инструкция — docs/DEPLOY.md.
#
# Переменные окружения (в GitHub — секреты SSH_*, см. deploy.yml и restore.yml):
#   DEPLOY_HOST         адрес сервера (IP или имя) — тот же, что в строке known_hosts
#   DEPLOY_USER         логин SSH
#   DEPLOY_PATH         папка сайта на сервере — должна совпадать с SITE_DIR ниже символ в символ
#   DEPLOY_KNOWN_HOSTS  строка(и) known_hosts сервера: ключ хоста проверяется всегда
#   DEPLOY_SSH_KEY      закрытый ключ (предпочтительно)
#   DEPLOY_PASSWORD     пароль SSH — только если хостинг не принимает ключ (через sshpass, из окружения)
#   DEPLOY_PORT         порт SSH, по умолчанию 22
#   DEPLOY_METHOD       auto (по умолчанию) | rsync | sftp — способ копирования
#
# Ни один секрет не выводится: нет `set -x`, ключ и known_hosts — во временных файлах с правами 600, пароль —
# только в переменной окружения SSHPASS / LFTP_PASSWORD. Адрес сервера в сообщения не подставляется.

# Единственная папка, в которую разрешено выкладывать и из которой что-либо удаляется. Значение секрета
# SSH_TARGET сравнивается с ней строкой целиком, без нормализации: другой путь, «..», «//», «/» на конце,
# пробел или перевод строки — отказ до подключения к серверу.
readonly SITE_DIR=/var/www/u3703509/data/www/konturix.ru
# Резервные копии — в домашней папке пользователя хостинга, вне папок сайтов: по HTTP не отдаются.
readonly BACKUP_DIR=/var/www/u3703509/data/konturix-backups
readonly BACKUP_KEEP=5
# Имя копии: konturix-ГГГГММДД-ЧЧММСС-метка.tar.gz (время UTC — по имени копии сортируются по времени).
# shellcheck disable=SC2034 # используется в restore.sh
readonly BACKUP_NAME_RE='^konturix-[0-9]{8}-[0-9]{6}-[a-z0-9]{1,40}\.tar\.gz$'

fail() {
  echo "::error::$1" >&2
  exit 1
}

# Наличие настроек и точный путь к папке сайта. Ничего не подключает и не запускает на сервере.
check_settings() {
  local name
  for name in DEPLOY_HOST DEPLOY_USER DEPLOY_PATH DEPLOY_KNOWN_HOSTS; do
    [[ -n "${!name:-}" ]] || fail "Не задан секрет ${name} (docs/DEPLOY.md, шаг 4)."
  done
  [[ "$DEPLOY_PATH" == "$SITE_DIR" ]] ||
    fail "Папка сайта (секрет SSH_TARGET) должна быть ровно ${SITE_DIR} — другой путь не принимается. Остановлено до подключения к серверу (docs/DEPLOY.md, шаг 4)."
  [[ -n "${DEPLOY_SSH_KEY:-}" || -n "${DEPLOY_PASSWORD:-}" ]] ||
    fail 'Не задан ни DEPLOY_SSH_KEY, ни DEPLOY_PASSWORD (docs/DEPLOY.md, шаг 2).'
  DEPLOY_PORT="${DEPLOY_PORT:-22}"
  [[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]] || fail 'DEPLOY_PORT — не число.'
  DEPLOY_METHOD="${DEPLOY_METHOD:-auto}"
  [[ "$DEPLOY_METHOD" =~ ^(auto|rsync|sftp)$ ]] || fail "Неизвестный DEPLOY_METHOD: $DEPLOY_METHOD (auto, rsync или sftp)."
}

# Временная папка, known_hosts, ключ или пароль. Задаёт workdir, ssh_options, pass, target.
setup_ssh() {
  workdir=$(mktemp -d)
  # shellcheck disable=SC2064 # путь подставляется сейчас: так trap удалит именно эту папку
  trap "rm -rf '$workdir'" EXIT
  chmod 700 "$workdir"
  local known_hosts="$workdir/known_hosts"
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$known_hosts"
  chmod 600 "$known_hosts"

  ssh_options=(-p "$DEPLOY_PORT" -o "UserKnownHostsFile=$known_hosts" -o StrictHostKeyChecking=yes
    -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
  pass=()
  if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
    local key="$workdir/key"
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
  # shellcheck disable=SC2153 # DEPLOY_HOST проверен в check_settings через ${!name}
  target="$DEPLOY_USER@$DEPLOY_HOST"
}

# Сценарий на сервере (POSIX sh). Передаётся через stdin в «sh -s»; аргументы — константы выше и проверенные
# имена копий, без пробелов и спецсимволов. Пишет только в BACKUP_DIR; папку сайта только читает.
read -r -d '' REMOTE_SCRIPT <<'SH' || true
set -eu
site=$1 backups=$2 keep=$3 op=$4
shift 4
parent=${site%/*}
base=${site##*/}
name_ok() { printf '%s\n' "$1" | grep -Eq '^konturix-[0-9]{8}-[0-9]{6}-[a-z0-9]{1,40}\.tar\.gz$'; }
names() {
  [ -d "$backups" ] || return 0
  ls -1 "$backups" | grep -E '^konturix-[0-9]{8}-[0-9]{6}-[a-z0-9]{1,40}\.tar\.gz$' | sort -r
}
case $op in
preflight)
  if [ -L "$site" ]; then echo symlink; exit 0; fi
  if [ ! -d "$site" ]; then echo no-dir; exit 0; fi
  if command -v rsync >/dev/null 2>&1; then echo rsync; else echo none; fi
  ;;
backup)
  name=$1
  name_ok "$name" || { echo 'неверное имя копии' >&2; exit 2; }
  umask 077
  mkdir -p "$backups"
  chmod 700 "$backups"
  tmp="$backups/.partial-$name"
  trap 'rm -f "$tmp"' EXIT
  tar -czf "$tmp" -C "$parent" "$base"
  tar -tzf "$tmp" >/dev/null
  mv "$tmp" "$backups/$name"
  trap - EXIT
  names | tail -n +"$((keep + 1))" | while read -r old; do rm -f "$backups/$old"; done
  wc -c <"$backups/$name"
  ;;
list)
  names | while read -r f; do printf '%s %s\n' "$f" "$(wc -c <"$backups/$f")"; done
  ;;
cat)
  name=$1
  name_ok "$name" || { echo 'неверное имя копии' >&2; exit 2; }
  cat "$backups/$name"
  ;;
*)
  echo "неизвестная операция: $op" >&2
  exit 2
  ;;
esac
SH

remote() {
  "${pass[@]}" ssh "${ssh_options[@]}" "$target" sh -s -- "$SITE_DIR" "$BACKUP_DIR" "$BACKUP_KEEP" "$@" \
    <<<"$REMOTE_SCRIPT"
}

# Вход, папка сайта и способ копирования. Только чтение. Задаёт method.
preflight() {
  local answer
  answer=$(remote preflight) ||
    fail 'Не удалось войти по SSH: проверьте адрес, логин, ключ (или пароль) и строку known_hosts.'
  case "$answer" in
    no-dir) fail 'На сервере нет папки сайта — проверьте путь в SSH_TARGET (docs/DEPLOY.md, шаг 1).' ;;
    symlink) fail 'Папка сайта на сервере — символическая ссылка; выкладка в неё не выполняется.' ;;
    rsync | none) ;;
    *) fail 'Сервер ответил неожиданно на проверку папки сайта.' ;;
  esac
  method="$DEPLOY_METHOD"
  if [[ "$method" == auto ]]; then
    if [[ "$answer" == rsync ]]; then method=rsync; else method=sftp; fi
  fi
  [[ "$method" != rsync || "$answer" == rsync ]] || fail 'На сервере нет rsync — используйте DEPLOY_METHOD=sftp.'
  echo "Способ копирования: $method."
}

# Резервная копия папки сайта — до любого изменения на сервере. Ошибка — немедленная остановка.
make_backup() {
  local label=$1 name size
  [[ "$label" =~ ^[a-z0-9]{1,40}$ ]] || fail 'Неверная метка резервной копии.'
  name="konturix-$(date -u +%Y%m%d-%H%M%S)-$label.tar.gz"
  size=$(remote backup "$name") ||
    fail 'Не удалось создать резервную копию папки сайта — остановлено, файлы сайта не изменялись (docs/DEPLOY.md, «Если что-то не так»).'
  [[ "$size" =~ ^[0-9]+$ ]] || fail 'Сервер не подтвердил резервную копию — остановлено, файлы сайта не изменялись.'
  echo "Резервная копия: $name ($size байт) в ~/${BACKUP_DIR##*/}/, хранятся последние $BACKUP_KEEP."
}

# Копирование папки $1 в папку сайта так, чтобы при обрыве связи сайт оставался рабочим:
# - rsync: новые файлы докачиваются во временную папку .~tmp~ и встают на место все вместе в конце
#   (--delay-updates), лишние удаляются только после этого (--delete-delay). Обрыв до конца — на сайте
#   прежняя версия целиком;
# - SFTP (lftp): три прохода. 1) новые и изменённые файлы, кроме страниц и .htaccess; 2) страницы — к этому
#   моменту всё, на что они ссылаются, уже на сервере; 3) удаление лишнего. Каждый файл пишется во временный
#   .in.* и переименовывается, поэтому недокачанных файлов на месте настоящих не бывает. Обрыв на любом
#   проходе — каждая страница целая, старая или новая, и всё, на что она ссылается, на месте.
# .well-known/ на сервере не трогается: там файлы для выпуска SSL-сертификата.
transfer() {
  local src=$1
  if [[ "$method" == rsync ]]; then
    # Пароль (если нет ключа) — sshpass внутри команды ssh, которую запускает rsync.
    rsync --recursive --links --times --perms --compress --delete-delay --delay-updates \
      --chmod=D755,F644 --filter='P .well-known/' --stats \
      -e "${pass[*]} ssh $(printf '%q ' "${ssh_options[@]}")" \
      "$src/" "$target:$SITE_DIR/" ||
      fail 'Копирование rsync прервано. Прежние файлы сайта не тронуты; запустите выкладку ещё раз (docs/DEPLOY.md, «Если что-то не так»).'
  else
    command -v lftp >/dev/null || fail 'Для копирования по SFTP нужен lftp.'
    sftp_mirror "$src" --exclude-glob '*.html' --exclude-glob .htaccess ||
      fail 'Копирование по SFTP прервано на 1-м проходе (файлы, кроме страниц). Сайт работает в прежнем виде; запустите выкладку ещё раз.'
    sftp_mirror "$src" ||
      fail 'Копирование по SFTP прервано на 2-м проходе (страницы). Часть страниц новая, часть прежняя, все рабочие; запустите выкладку ещё раз.'
    sftp_mirror "$src" --delete ||
      fail 'Копирование по SFTP прервано на 3-м проходе (удаление лишнего). Новая версия на месте; запустите выкладку ещё раз.'
  fi
}

sftp_mirror() {
  local src=$1
  shift
  local ssh_command login
  ssh_command="ssh -a -x $(printf '%q ' "${ssh_options[@]}")"
  login="-u $DEPLOY_USER,"
  if [[ ${#pass[@]} -gt 0 ]]; then
    export LFTP_PASSWORD="$DEPLOY_PASSWORD"
    login="--env-password -u $DEPLOY_USER"
  fi
  lftp -c "set sftp:connect-program \"$ssh_command\"; set net:max-retries 2; set net:timeout 30; set net:reconnect-interval-base 5;
    set xfer:use-temp-file yes; set xfer:temp-file-name .in.*;
    open $login sftp://$DEPLOY_HOST;
    mirror --reverse $* --verbose=1 --exclude-glob .well-known/ --exclude-glob .well-known/* \
      $(printf '%q' "$src/") $(printf '%q' "$SITE_DIR/")"
}
