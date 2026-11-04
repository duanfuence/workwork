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
# Резервные копии — в домашней папке пользователя хостинга, вне папок сайтов: по HTTP не отдаются. Там же —
# служебные файлы выкладки: .site-state (завершена ли последняя операция) и .assets-live (CSS/JS работающей
# версии). Политика хранения (D-035): последние BACKUP_KEEP копий; кроме них ротация никогда не удаляет первую
# копию (метка initial — то, что было в папке сайта до первой выкладки), последнюю копию полной версии сайта
# (с отметкой .ok) и копию, из которой идёт восстановление.
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
# имена (копий и файлов _astro/: только буквы, цифры, «.», «_», «-»). Пишет только в BACKUP_DIR; в папке
# сайта удаляет только устаревшие файлы в _astro/ (операция finish), остальное в ней меняют rsync и lftp.
# Пути в rm — через ${…:?}: пустое значение останавливает сценарий, а не превращается в «/».
read -r -d '' REMOTE_SCRIPT <<'SH' || true
set -eu
site=$1 backups=$2 keep=$3 op=$4
shift 4
parent=${site%/*}
base=${site##*/}
re='^konturix-[0-9]{8}-[0-9]{6}-[a-z0-9]{1,40}\.tar\.gz$'
name_ok() { printf '%s\n' "$1" | grep -Eq "$re"; }
names() {
  [ -d "$backups" ] || return 0
  ls -1 "$backups" | grep -E "$re" | sort -r
}
# Каталог копий — символическая ссылка: ничего не делать (иначе chmod и копии ушли бы в чужую папку).
if [ -L "$backups" ]; then
  if [ "$op" = preflight ]; then
    echo backups-symlink
    exit 0
  fi
  echo 'каталог резервных копий — символическая ссылка' >&2
  exit 4
fi
set_state() {
  printf '%s\n' "$1" >"${backups:?}/.site-state.tmp"
  mv "${backups:?}/.site-state.tmp" "${backups:?}/.site-state"
}
case $op in
preflight)
  if [ -L "$site" ]; then echo symlink; exit 0; fi
  if [ ! -d "$site" ]; then echo no-dir; exit 0; fi
  if [ -e "$backups" ] && [ ! -d "$backups" ]; then echo backups-not-dir; exit 0; fi
  if command -v rsync >/dev/null 2>&1; then echo rsync; else echo none; fi
  ;;
backup)
  # $1 — имя копии; дальше — имена копий, которые ротация не должна удалять (восстанавливаемая копия).
  name=$1
  shift
  name_ok "$name" || { echo 'неверное имя копии' >&2; exit 2; }
  umask 077
  mkdir -p "$backups"
  chmod 700 "$backups"
  # Самая первая копия (то, что было в папке сайта до первой выкладки) — метка initial, ротация её не удаляет.
  if [ -z "$(names)" ]; then name="${name%-*}-initial.tar.gz"; fi
  # Копия с таким именем уже есть (две операции в одну секунду) — не перезаписывать: код 3, имя сменит вызывающий.
  if [ -e "$backups/$name" ]; then echo 'копия с таким именем уже есть' >&2; exit 3; fi
  tmp="${backups:?}/.partial-$name"
  trap 'rm -f -- "${tmp:?}"' EXIT
  tar -czf "$tmp" -C "$parent" "$base"
  tar -tzf "$tmp" >/dev/null
  mv "$tmp" "$backups/$name"
  trap - EXIT
  # Отметка .ok — копия полной версии: предыдущая выкладка или восстановление завершились.
  state=complete
  [ ! -f "$backups/.site-state" ] || state=$(cat "$backups/.site-state")
  if [ "$state" = complete ]; then : >"$backups/$name.ok"; fi
  # Ротация: последние $keep копий; первая (initial), последняя полная (.ok) и защищённые — не удаляются.
  newest_ok=''
  for f in $(names); do
    if [ -e "$backups/$f.ok" ]; then
      newest_ok=$f
      break
    fi
  done
  names | grep -v -- '-initial\.tar\.gz$' | tail -n +"$((keep + 1))" | while read -r old; do
    [ "$old" != "$newest_ok" ] || continue
    for p in "$@"; do [ "$old" != "$p" ] || continue 2; done
    rm -f -- "${backups:?}/${old:?}" "${backups:?}/${old:?}.ok"
  done
  printf '%s %s %s\n' "$name" "$(wc -c <"$backups/$name")" "$state"
  ;;
list)
  for f in $(names); do
    note='после прерванной операции'
    [ ! -e "$backups/$f.ok" ] || note='полная версия'
    case $f in *-initial.tar.gz) note="$note; первая, не удаляется" ;; esac
    printf '%s %s (%s)\n' "$f" "$(wc -c <"$backups/$f")" "$note"
  done
  ;;
cat)
  name=$1
  name_ok "$name" || { echo 'неверное имя копии' >&2; exit 2; }
  cat "$backups/$name"
  ;;
begin)
  # Перед копированием: с этого момента папка сайта может быть в промежуточном состоянии.
  umask 077
  mkdir -p "$backups"
  set_state incomplete
  ;;
finish)
  # После копирования. $1 — prune или keep-all; дальше — имена файлов _astro/ новой версии.
  mode=$1
  shift
  assets="$site/_astro"
  live="$backups/.assets-live"
  # Удаляются файлы _astro/, которых нет ни в новой версии, ни в версии, работавшей до этой операции
  # (.assets-live): у посетителей, открывших прежние страницы, их CSS и JS остаются доступны до следующей
  # выкладки. Без .assets-live (первая выкладка) не удаляется ничего.
  if [ "$mode" = prune ] && [ -f "$live" ] && [ -d "$assets" ] && [ ! -L "$assets" ]; then
    for f in "$assets"/* "$assets"/.[!.]*; do
      [ -f "$f" ] && [ ! -L "$f" ] || continue
      n=${f##*/}
      for k in "$@"; do [ "$n" != "$k" ] || continue 2; done
      if grep -qxF -- "$n" "$live"; then continue; fi
      rm -f -- "${assets:?}/${n:?}"
    done
    rm -rf -- "${assets:?}/.~tmp~"
  fi
  if [ "$mode" = prune ]; then
    printf '%s\n' "$@" >"$live.tmp"
    mv "$live.tmp" "$live"
  fi
  set_state complete
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

# Вход, папка сайта, каталог копий и способ копирования. Только чтение. Задаёт method.
preflight() {
  local answer
  answer=$(remote preflight) ||
    fail 'Не удалось войти по SSH: проверьте адрес, логин, ключ (или пароль) и строку known_hosts.'
  case "$answer" in
    no-dir) fail 'На сервере нет папки сайта — проверьте путь в SSH_TARGET (docs/DEPLOY.md, шаг 1).' ;;
    symlink) fail 'Папка сайта на сервере — символическая ссылка; выкладка в неё не выполняется.' ;;
    backups-symlink)
      fail "Папка ${BACKUP_DIR} на сервере — символическая ссылка. Остановлено до любых изменений: замените её обычной папкой (docs/DEPLOY.md, «Если что-то не так»)."
      ;;
    backups-not-dir) fail "${BACKUP_DIR} на сервере — не папка. Остановлено до любых изменений." ;;
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
# $1 — метка; дальше — копии, которые ротация не должна удалять. Задаёт backup_name.
make_backup() {
  local label=$1 name answer size state code attempt
  shift
  [[ "$label" =~ ^[a-z0-9]{1,40}$ ]] || fail 'Неверная метка резервной копии.'
  for attempt in 1 2 3; do
    name="konturix-$(date -u +%Y%m%d-%H%M%S)-$label.tar.gz"
    code=0
    answer=$(remote backup "$name" "$@") || code=$?
    # 3 — имя занято копией, созданной в ту же секунду: новое имя через секунду; прежняя копия не трогается.
    [[ $code -eq 3 && $attempt -lt 3 ]] || break
    sleep 1
  done
  [[ $code -eq 0 ]] ||
    fail 'Не удалось создать резервную копию папки сайта — остановлено, файлы сайта не изменялись (docs/DEPLOY.md, «Если что-то не так»).'
  read -r backup_name size state <<<"$answer"
  [[ "$backup_name" =~ $BACKUP_NAME_RE && "$size" =~ ^[0-9]+$ ]] ||
    fail 'Сервер не подтвердил резервную копию — остановлено, файлы сайта не изменялись.'
  local note='полная версия'
  [[ "$state" == complete ]] || note='состояние после прерванной операции'
  echo "Резервная копия: $backup_name ($size байт, $note) в ~/${BACKUP_DIR##*/}/."
}

# Прерванное копирование: честно — сайт может быть частично обновлён.
interrupted() {
  fail "Копирование прервано на этапе $1 из 3 ($2). Сайт может быть частично обновлён. Запустите операцию ещё раз — обычно этого достаточно; если сайт работает неправильно, верните прежнее состояние: Actions → Restore, копия ${backup_name:-из списка} (docs/DEPLOY.md, «Если выкладка оборвалась»)."
}

# Копирование папки $1 в папку сайта в три этапа. Это не атомарная публикация: файлы встают на место по
# одному, и при аварийном завершении процесса на сервере (или обрыве в момент замены файла) сайт может
# оказаться частично обновлённым. Порядок этапов уменьшает вред такого сбоя:
#   1) всё, кроме страниц и файлов управления сайтом (.htaccess, robots.txt, sitemap.xml): новые CSS/JS
#      в _astro/, шрифты, картинки. Прежние страницы их не используют — сайт работает в прежнем виде;
#   2) все файлы (страницы и файлы управления; остальное уже совпадает). Новая страница встаёт на место,
#      когда её CSS и JS уже на сервере, а прежние CSS и JS ещё не удалены;
#   3) удаление устаревшего, кроме _astro/ и .well-known/; затем finish: из _astro/ удаляется только то,
#      чего нет ни в новой, ни в предыдущей версии, и ставится отметка «операция завершена».
# rsync: на этапах 1–2 файлы докачиваются в .~tmp~ и переименовываются на место в конце этапа (--delay-updates).
# SFTP (lftp): файл пишется во временный .in.*, затем прежний файл удаляется и временный переименовывается —
# между этими двумя действиями файла нет (доли миллисекунды): это тоже не атомарная замена.
# .well-known/ на сервере не трогается: там файлы для выпуска SSL-сертификата.
transfer() {
  local src=$1 assets=() mode=prune name
  remote begin || fail 'Не удалось записать служебную отметку на сервере — остановлено до копирования.'
  if [[ "$method" == rsync ]]; then
    local rsync_ssh common
    # Пароль (если нет ключа) — sshpass внутри команды ssh, которую запускает rsync.
    rsync_ssh="${pass[*]} ssh $(printf '%q ' "${ssh_options[@]}")"
    # shellcheck disable=SC2054 # запятая — часть значения --chmod
    common=(--recursive --links --times --perms --compress --chmod=D755,F644 --filter='P .well-known/'
      -e "$rsync_ssh")
    # Этап 1. Исключения: *.html — по имени на любой глубине, /… — только в корне; без удаления.
    rsync "${common[@]}" --delay-updates --exclude='*.html' --exclude=/.htaccess --exclude=/robots.txt \
      --exclude=/sitemap.xml "$src/" "$target:$SITE_DIR/" ||
      interrupted 1 'CSS, JS, шрифты, картинки'
    # Этап 2. Без исключений: всё, что не скопировано на этапе 1, копируется здесь. Без удаления.
    rsync "${common[@]}" --delay-updates --stats "$src/" "$target:$SITE_DIR/" ||
      interrupted 2 'страницы и файлы управления сайтом'
    # Этап 3. Только удаление: --existing --ignore-existing ничего не копируют; _astro/ защищена.
    rsync "${common[@]}" --delete --existing --ignore-existing --filter='P /_astro/***' \
      "$src/" "$target:$SITE_DIR/" ||
      interrupted 3 'удаление устаревших файлов'
  else
    command -v lftp >/dev/null || fail 'Для копирования по SFTP нужен lftp.'
    sftp_mirror "$src" --exclude-glob '*.html' --exclude-glob .htaccess --exclude-glob robots.txt \
      --exclude-glob sitemap.xml || interrupted 1 'CSS, JS, шрифты, картинки'
    sftp_mirror "$src" || interrupted 2 'страницы и файлы управления сайтом'
    sftp_mirror "$src" --delete --exclude-glob _astro/ || interrupted 3 'удаление устаревших файлов'
  fi
  # Файлы _astro/ новой версии — для очистки устаревших. Необычное имя — очистку пропустить (ничего не удалять).
  if [[ -d "$src/_astro" ]]; then
    while IFS= read -r -d '' name; do
      name="${name##*/}"
      if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then assets+=("$name"); else mode=keep-all; fi
    done < <(find "$src/_astro" -maxdepth 1 -type f -print0)
  fi
  [[ "$mode" == prune ]] || assets=()
  remote finish "$mode" "${assets[@]}" || interrupted 3 'очистка устаревших CSS и JS'
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
