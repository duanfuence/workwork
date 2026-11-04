# shellcheck shell=bash
# Общая часть выкладки (deploy.sh) и восстановления (restore.sh): проверки, вход по SSH, резервная копия,
# копирование файлов, статусы операции. Решения — docs/DECISIONS.md, D-034 и D-035; инструкция — docs/DEPLOY.md.
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
# служебные файлы:
#   .site-state    статус последней операции с папкой сайта: «copying <токен> -» (копирование идёт или
#                  прервано), «copied <токен> <отпечаток>» (копирование завершено, сайт ещё не проверен),
#                  «verified <токен> <отпечаток>» (сайт прошёл проверку после выкладки). Статус verified
#                  ставит только deploy.sh после успешной проверки сайта, в том же процессе (токен никуда
#                  не передаётся); восстановление его не ставит никогда;
#   ИМЯ.sum        отпечаток содержимого копии (файлы и их SHA-256, без .well-known);
#   ИМЯ.verified   в копии — проверенная версия сайта: её содержимое совпадает с прошедшим проверку;
#   .assets-live   CSS/JS работающей версии (для очистки _astro/).
# Политика хранения (D-035): последние BACKUP_KEEP копий; кроме них ротация никогда не удаляет первую копию
# (метка initial — то, что было в папке сайта до первой выкладки), самую новую проверенную копию
# (последняя хорошая версия) и копию, из которой идёт восстановление. Если содержимое папки сайта совпадает
# с самой новой копией, новая копия не создаётся.
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
# значения (имена копий и файлов _astro/, токен операции: только буквы, цифры, «.», «_», «-»). Пишет только
# в BACKUP_DIR; в папке сайта удаляет только устаревшие файлы в _astro/ (операция finish), остальное в ней
# меняют rsync и lftp. Пути в rm — через ${…:?}: пустое значение останавливает сценарий, а не превращается в «/».
read -r -d '' REMOTE_SCRIPT <<'SH' || true
set -eu
site=$1 backups=$2 keep=$3 op=$4
shift 4
parent=${site%/*}
base=${site##*/}
re='^konturix-[0-9]{8}-[0-9]{6}-[a-z0-9]{1,40}\.tar\.gz$'
name_ok() { printf '%s\n' "$1" | grep -Eq "$re"; }
token_ok() { printf '%s\n' "$1" | grep -Eq '^[a-z0-9-]{8,64}$'; }
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
# Статус последней операции: st (copying, copied, verified или пусто), stok (токен), sfp (отпечаток).
read_state() {
  st='' stok='' sfp=''
  if [ -f "$backups/.site-state" ]; then read -r st stok sfp <"$backups/.site-state" || true; fi
}
# Отпечаток содержимого папки сайта: пути файлов и их SHA-256 (без .well-known — её меняет хостинг).
# Нет sha256sum — пусто: тогда копии не объединяются и проверенными не отмечаются.
fingerprint() {
  command -v sha256sum >/dev/null 2>&1 || return 0
  (
    cd "$site"
    find . -path ./.well-known -prune -o -type f -print | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s %s\n' "$(sha256sum <"$f" | cut -d' ' -f1)" "$f"
    done | sha256sum | cut -d' ' -f1
  )
}
newest_verified() {
  for f in $(names); do
    if [ -e "$backups/$f.verified" ]; then
      echo "$f"
      return 0
    fi
  done
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
  fp=$(fingerprint)
  read_state
  # Проверенная версия: содержимое совпадает с тем, что прошло проверку (статус verified с тем же
  # отпечатком), или с содержимым копии, уже отмеченной как проверенная.
  good=no
  if [ -n "$fp" ]; then
    if [ "$st" = verified ] && [ "$sfp" = "$fp" ]; then good=yes; fi
    for f in $(names); do
      if [ -e "$backups/$f.verified" ] && [ "$(cat "$backups/$f.sum" 2>/dev/null)" = "$fp" ]; then good=yes; fi
    done
  fi
  # Содержимое не изменилось с самой новой копии — новая копия не нужна (повторы одной выкладки).
  newest=$(names | head -n 1)
  if [ -n "$fp" ] && [ -n "$newest" ] && [ "$(cat "$backups/$newest.sum" 2>/dev/null)" = "$fp" ]; then
    if [ "$good" = yes ]; then : >"$backups/$newest.verified"; fi
    printf '%s %s reused %s\n' "$newest" "$(wc -c <"$backups/$newest")" "$good"
    exit 0
  fi
  # Самая первая копия (то, что было в папке сайта до первой выкладки) — метка initial, ротация её не удаляет.
  if [ -z "$newest" ]; then name="${name%-*}-initial.tar.gz"; fi
  # Копия с таким именем уже есть (две операции в одну секунду) — не перезаписывать: код 3, имя сменит вызывающий.
  if [ -e "$backups/$name" ]; then echo 'копия с таким именем уже есть' >&2; exit 3; fi
  tmp="${backups:?}/.partial-$name"
  trap 'rm -f -- "${tmp:?}"' EXIT
  tar -czf "$tmp" -C "$parent" "$base"
  tar -tzf "$tmp" >/dev/null
  mv "$tmp" "$backups/$name"
  trap - EXIT
  if [ -n "$fp" ]; then printf '%s\n' "$fp" >"$backups/$name.sum"; fi
  if [ "$good" = yes ]; then : >"$backups/$name.verified"; fi
  # Ротация: последние $keep копий; первая (initial), самая новая проверенная и защищённые — не удаляются.
  keep_good=$(newest_verified)
  names | grep -v -- '-initial\.tar\.gz$' | tail -n +"$((keep + 1))" | while read -r old; do
    [ "$old" != "$keep_good" ] || continue
    for p in "$@"; do [ "$old" != "$p" ] || continue 2; done
    rm -f -- "${backups:?}/${old:?}" "${backups:?}/${old:?}.sum" "${backups:?}/${old:?}.verified"
  done
  printf '%s %s new %s\n' "$name" "$(wc -c <"$backups/$name")" "$good"
  ;;
list)
  # Строки: имя, размер, verified|unverified, initial (для первой копии).
  for f in $(names); do
    status=unverified
    [ ! -e "$backups/$f.verified" ] || status=verified
    flag=''
    case $f in *-initial.tar.gz) flag=' initial' ;; esac
    printf '%s %s %s%s\n' "$f" "$(wc -c <"$backups/$f")" "$status" "$flag"
  done
  ;;
cat)
  name=$1
  name_ok "$name" || { echo 'неверное имя копии' >&2; exit 2; }
  cat "$backups/$name"
  ;;
begin)
  # Перед копированием: с этого момента папка сайта может быть в промежуточном состоянии.
  token_ok "$1" || { echo 'неверный токен' >&2; exit 2; }
  umask 077
  mkdir -p "$backups"
  set_state "copying $1 -"
  ;;
finish)
  # После копирования. $1 — токен, $2 — prune или keep-all; дальше — имена файлов _astro/ новой версии.
  tok=$1 mode=$2
  shift 2
  token_ok "$tok" || { echo 'неверный токен' >&2; exit 2; }
  read_state
  [ "$st" = copying ] && [ "$stok" = "$tok" ] || { echo 'чужая или незавершённая операция' >&2; exit 5; }
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
  fp=$(fingerprint)
  set_state "copied $tok ${fp:--}"
  ;;
verify)
  # Только из deploy.sh и только после успешной проверки сайта. Статус copied этой же операции и то же
  # содержимое папки сайта, что сразу после копирования, — иначе отказ.
  tok=$1
  token_ok "$tok" || { echo 'неверный токен' >&2; exit 2; }
  read_state
  [ "$st" = copied ] && [ "$stok" = "$tok" ] && [ -n "$sfp" ] && [ "$sfp" != - ] ||
    { echo 'нет завершённого копирования этой операции' >&2; exit 5; }
  [ "$(fingerprint)" = "$sfp" ] || { echo 'файлы сайта изменились после копирования' >&2; exit 5; }
  set_state "verified $tok $sfp"
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

# Самая новая проверенная копия (последняя хорошая версия) или пусто.
last_good() {
  local name _ status
  while read -r name _ status _; do
    if [[ "$status" == verified ]]; then
      echo "$name"
      return 0
    fi
  done < <(remote list 2>/dev/null || true)
}

# Резервная копия папки сайта — до любого изменения на сервере. Ошибка — немедленная остановка.
# $1 — метка; дальше — копии, которые ротация не должна удалять. Задаёт backup_name.
make_backup() {
  local label=$1 name answer size kind good code attempt
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
  read -r backup_name size kind good <<<"$answer"
  [[ "$backup_name" =~ $BACKUP_NAME_RE && "$size" =~ ^[0-9]+$ && "$kind" =~ ^(new|reused)$ ]] ||
    fail 'Сервер не подтвердил резервную копию — остановлено, файлы сайта не изменялись.'
  local note='не проверенная версия'
  [[ "$good" != yes ]] || note='проверенная версия'
  if [[ "$kind" == reused ]]; then
    echo "Резервная копия: $backup_name — файлы сайта не изменились с неё, новая копия не нужна ($note)."
  else
    echo "Резервная копия: $backup_name ($size байт, $note) в ~/${BACKUP_DIR##*/}/."
  fi
}

# Прерванное копирование: честно — сайт может быть частично обновлён.
interrupted() {
  local good
  good=$(last_good)
  fail "Копирование прервано на этапе $1 из 3 ($2). Сайт может быть частично обновлён; эта версия не отмечена как проверенная. Запустите операцию ещё раз — обычно этого достаточно; если сайт работает неправильно, верните прежнее состояние: Actions → Restore, копия ${backup_name:-из списка}${good:+ или последняя проверенная версия — last-good ($good)} (docs/DEPLOY.md, «Если выкладка оборвалась»)."
}

# Токен операции: связывает begin, finish и verify одного запуска.
new_token() {
  local token
  token=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
  [[ "$token" =~ ^[0-9a-f]{16}$ ]] || fail 'Не удалось получить токен операции.'
  echo "$token"
}

# Копирование папки $1 в папку сайта в три этапа; $2 — токен операции. Это не атомарная публикация: файлы
# встают на место по одному, и при аварийном завершении процесса на сервере (или обрыве в момент замены
# файла) сайт может оказаться частично обновлённым. Порядок этапов уменьшает вред такого сбоя:
#   1) всё, кроме страниц и файлов управления сайтом (.htaccess, robots.txt, sitemap.xml): новые CSS/JS
#      в _astro/, шрифты, картинки. Прежние страницы их не используют — сайт работает в прежнем виде;
#   2) все файлы (страницы и файлы управления; остальное уже совпадает). Новая страница встаёт на место,
#      когда её CSS и JS уже на сервере, а прежние CSS и JS ещё не удалены;
#   3) удаление устаревшего, кроме _astro/ и .well-known/; затем finish: из _astro/ удаляется только то,
#      чего нет ни в новой, ни в предыдущей версии, и ставится статус copied (копирование завершено).
# Статус verified здесь не ставится: его ставит только deploy.sh после проверки сайта.
# rsync: на этапах 1–2 файлы докачиваются в .~tmp~ и переименовываются на место в конце этапа (--delay-updates).
# SFTP (lftp): файл пишется во временный .in.*, затем прежний файл удаляется и временный переименовывается —
# между этими двумя действиями файла нет (доли миллисекунды): это тоже не атомарная замена.
# .well-known/ на сервере не трогается: там файлы для выпуска SSL-сертификата.
transfer() {
  local src=$1 token=$2 assets=() mode=prune name
  remote begin "$token" || fail 'Не удалось записать статус операции на сервере — остановлено до копирования.'
  if [[ "$method" == rsync ]]; then
    local rsync_ssh
    # Пароль (если нет ключа) — sshpass внутри команды ssh, которую запускает rsync.
    rsync_ssh="${pass[*]} ssh $(printf '%q ' "${ssh_options[@]}")"
    # shellcheck disable=SC2054 # запятая — часть значения --chmod
    local common=(--recursive --links --times --perms --compress --chmod=D755,F644 --filter='P .well-known/'
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
  remote finish "$token" "$mode" "${assets[@]}" || interrupted 3 'очистка устаревших CSS и JS'
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
