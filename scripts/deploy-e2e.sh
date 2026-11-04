#!/usr/bin/env bash
# Проверка выкладки и восстановления на настоящем SSH-сервере (D-035): rsync и SFTP, резервные копии и их
# ротация, сбой резервной копии, обрыв связи посреди копирования, восстановление, вход по паролю.
#
# Сервер поднимается локально и повторяет хостинг: пользователь u3703509, домашняя папка
# /var/www/u3703509/data, папка сайта /var/www/u3703509/data/www/konturix.ru, свой sshd на 127.0.0.1:2222.
# Обрыв связи — через «медленный» адрес e2e-slow: соединение идёт через прокси с ограничением скорости,
# который убивается посреди копирования, а новые подключения запрещаются.
#
# Меняет систему (создаёт пользователя и папки, файл в /etc/ssh/ssh_config.d), поэтому запускается только
# во временной среде (контейнер, раннер GitHub) от root и только с DEPLOY_E2E=1:
#   SITE_URL=https://example.com npm run build && sudo DEPLOY_E2E=1 bash scripts/deploy-e2e.sh
# (сборка с адресом: без него нет sitemap.xml, и выкладка верно откажется).
# Нужны: sshd, rsync, lftp, sshpass, python3, tar.
# Условия обрыва — строки для eval (SC2016), «A && B || die» — намеренно (SC2015).
# shellcheck disable=SC2015,SC2016
set -euo pipefail

[[ "${DEPLOY_E2E:-}" == 1 ]] || {
  echo 'Запуск только во временной среде: DEPLOY_E2E=1 (см. заголовок файла).' >&2
  exit 2
}
[[ $EUID -eq 0 ]] || {
  echo 'Нужен root.' >&2
  exit 2
}

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIST="${DIST_DIR:-$here/../dist}"
[[ -s "$DIST/index.html" && -s "$DIST/.htaccess" && -s "$DIST/sitemap.xml" ]] || {
  echo "Нет полной сборки в $DIST — сначала SITE_URL=https://example.com npm run build." >&2
  exit 2
}

USER_NAME=u3703509
HOME_DIR=/var/www/u3703509/data
SITE=$HOME_DIR/www/konturix.ru
BACKUPS=$HOME_DIR/konturix-backups
PORT=2222
PASSWORD='e2e pass$(not-run);"x'
SSH_CONF=/etc/ssh/ssh_config.d/zz-deploy-e2e.conf

work=$(mktemp -d)
sshd_pid=''
cleanup() {
  [[ -n "$sshd_pid" ]] && kill "$sshd_pid" 2>/dev/null || true
  pkill -f deploy-e2e-throttle 2>/dev/null || true
  rm -f "$SSH_CONF"
  rm -rf "$work"
}
trap cleanup EXIT

passed=0
ok() {
  passed=$((passed + 1))
  echo "  ✓ $1"
}
die() {
  echo "  ✗ $1" >&2
  [[ -f "$work/out" ]] && sed 's/^/    | /' "$work/out" >&2
  exit 1
}

# --- Сервер ---------------------------------------------------------------------------------------------
mkdir -p /var/www
id "$USER_NAME" >/dev/null 2>&1 || useradd -m -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
printf '%s:%s\n' "$USER_NAME" "$PASSWORD" | chpasswd
# Чистое начальное состояние тестового сервера (копии от прошлого запуска не нужны).
rm -rf "$BACKUPS"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$HOME_DIR/www" "$SITE"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$HOME_DIR/.ssh"
ssh-keygen -q -t ed25519 -N '' -f "$work/client" -C deploy-e2e
install -o "$USER_NAME" -g "$USER_NAME" -m 600 "$work/client.pub" "$HOME_DIR/.ssh/authorized_keys"
ssh-keygen -q -t ed25519 -N '' -f "$work/hostkey"
mkdir -p /run/sshd
cat >"$work/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $work/hostkey
PidFile $work/sshd.pid
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM no
AllowUsers $USER_NAME
Subsystem sftp internal-sftp
EOF
/usr/sbin/sshd -f "$work/sshd_config" -D -e 2>"$work/sshd.log" &
sshd_pid=$!
for _ in $(seq 50); do
  (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && break
  sleep 0.1
done
hostkey=$(cut -d' ' -f1,2 "$work/hostkey.pub")
KNOWN_HOSTS="[127.0.0.1]:$PORT $hostkey
[e2e-slow]:$PORT $hostkey"

# «Медленный» адрес: соединение через прокси с ограничением скорости отправки; файл block запрещает новые
# подключения, pkill -f deploy-e2e-throttle обрывает текущие.
cat >"$work/deploy-e2e-throttle.py" <<'PY'
import os, socket, sys, threading, time
if os.path.exists(os.environ['E2E_BLOCK']):
    sys.exit(1)
rate = int(os.environ.get('E2E_RATE', '60000'))
s = socket.create_connection((sys.argv[1], int(sys.argv[2])))
def down():
    while True:
        d = s.recv(65536)
        if not d:
            os._exit(0)
        sys.stdout.buffer.write(d); sys.stdout.buffer.flush()
threading.Thread(target=down, daemon=True).start()
while True:
    d = os.read(0, 2048)
    if not d:
        s.shutdown(socket.SHUT_WR); break
    s.sendall(d)
    time.sleep(len(d) / rate)
threading.Event().wait()
PY
cat >"$SSH_CONF" <<EOF
Host e2e-slow
  HostName 127.0.0.1
  ProxyCommand python3 $work/deploy-e2e-throttle.py 127.0.0.1 %p
EOF

# --- Версии сайта ---------------------------------------------------------------------------------------
# NEW — настоящая сборка и «тяжёлый» файл, чтобы копирование шло достаточно долго для обрыва.
# OLD — прежняя версия: те же страницы с другим содержимым и другими файлами в _astro, страница и файл,
# которых в новой версии нет.
NEW=$work/new
OLD=$work/old
cp -a "$DIST" "$NEW"
head -c 700000 /dev/urandom >"$NEW/_astro/zz-filler.bin"
mkdir -p "$OLD/_astro" "$OLD/old-only"
while IFS= read -r page; do
  mkdir -p "$OLD/$(dirname "$page")"
  printf '<!doctype html><link rel="stylesheet" href="/_astro/old-style.css"><p>Прежняя версия: %s</p>\n' \
    "$page" >"$OLD/$page"
done < <(cd "$NEW" && find . -name '*.html' | sed 's#^\./##')
echo 'body{color:#000}' >"$OLD/_astro/old-style.css"
printf '<!doctype html><link rel="stylesheet" href="/_astro/old-style.css"><p>Только в прежней</p>\n' \
  >"$OLD/old-only/index.html"
echo 'прежний файл' >"$OLD/stale.txt"
cp "$NEW/.htaccess" "$OLD/.htaccess"
echo '# прежний' >>"$OLD/.htaccess"

# Проверка целостности папки сайта: каждый файл — целиком прежний или целиком новый (не обрезан и не чужой),
# у каждой страницы на месте всё, на что она ссылается в /_astro/ и /fonts/, ни одна страница, которая есть
# в обеих версиях, не пропала, .well-known не тронута.
cat >"$work/consistent.py" <<'PY'
import os, re, sys
old, new, site = sys.argv[1:4]
problems, leftovers = [], []
def rel_files(root):
    out = set()
    for d, dirs, files in os.walk(root):
        r = os.path.relpath(d, root)
        if r.split(os.sep)[0] == '.well-known':
            continue
        if '.~tmp~' in r.split(os.sep):
            continue
        for f in files:
            out.add(os.path.normpath(os.path.join(r, f)))
    return out
def read(p):
    with open(p, 'rb') as fh:
        return fh.read()
for f in sorted(rel_files(site)):
    if os.path.basename(f).startswith('.in.'):
        leftovers.append(f); continue
    data = read(os.path.join(site, f))
    if not any(os.path.exists(os.path.join(v, f)) and read(os.path.join(v, f)) == data for v in (old, new)):
        problems.append('файл не совпадает ни с одной версией: ' + f)
    if f.endswith('.html'):
        for ref in re.findall(rb'(?:href|src)="(/(?:_astro|fonts)/[^"#?]+)"', data):
            if not os.path.isfile(os.path.join(site, ref.decode().lstrip('/'))):
                problems.append('%s ссылается на отсутствующий %s' % (f, ref.decode()))
for f in sorted(rel_files(old) & rel_files(new)):
    if f.endswith('.html') and not os.path.isfile(os.path.join(site, f)):
        problems.append('пропала страница ' + f)
if read(os.path.join(site, '.well-known/acme-challenge/token')) != b'acme\n':
    problems.append('.well-known изменена')
for d, dirs, files in os.walk(site):
    if os.path.basename(d) == '.~tmp~':
        leftovers.append(os.path.relpath(d, site))
print('остатки прерванного копирования: %d' % len(leftovers))
for p in problems:
    print('ПРОБЛЕМА: ' + p)
sys.exit(1 if problems else 0)
PY

set_site() { # $1 — содержимое папки сайта; .well-known всегда на месте
  find "$SITE" -mindepth 1 -delete
  cp -a "$1/." "$SITE/"
  mkdir -p "$SITE/.well-known/acme-challenge"
  echo acme >"$SITE/.well-known/acme-challenge/token"
  chown -R "$USER_NAME:$USER_NAME" "$SITE"
}
site_is() { # папка сайта (без .well-known) совпадает с $1 и без остатков копирования
  diff -r --exclude=.well-known "$1" "$SITE" >/dev/null &&
    [[ -z "$(find "$SITE" -name '.~tmp~' -o -name '.in.*')" ]] &&
    [[ "$(cat "$SITE/.well-known/acme-challenge/token")" == acme ]]
}
files_are() { # файлы в папке сайта (без .well-known и .~tmp~) — ровно файлы $1, байт в байт; папки не важны
  local list
  list=$(cd "$SITE" && find . -path ./.well-known -prune -o -name '.~tmp~' -prune -o -type f -print | sort)
  [[ "$list" == "$(cd "$1" && find . -type f | sort)" ]] || return 1
  while IFS= read -r f; do cmp -s "$1/$f" "$SITE/$f" || return 1; done <<<"$list"
}
backups() { find "$BACKUPS" -maxdepth 1 -name 'konturix-*.tar.gz' 2>/dev/null | sort; }
newest_backup() { backups | tail -n 1; }
backup_has() { # копия $1 содержит ровно версию $2
  rm -rf "$work/x" && mkdir "$work/x" && tar -xzf "$1" -C "$work/x" &&
    diff -r --exclude=.well-known "$2" "$work/x/konturix.ru" >/dev/null
}
run() { # $1 — скрипт; остальное — VAR=значение. Вывод — в $work/out, код — в $status
  local script=$1
  shift
  set +e
  env DEPLOY_HOST=127.0.0.1 DEPLOY_PORT=$PORT DEPLOY_USER=$USER_NAME DEPLOY_PATH=$SITE \
    DEPLOY_KNOWN_HOSTS="$KNOWN_HOSTS" DEPLOY_SSH_KEY="$(cat "$work/client")" DIST_DIR="$NEW" \
    E2E_BLOCK="$work/block" E2E_RATE=60000 "$@" bash "$here/$script" >"$work/out" 2>&1
  status=$?
  set -e
  ! grep -qF -- "$(sed -n 2p "$work/client")" "$work/out" || die 'закрытый ключ попал в вывод'
  ! grep -qF -- "$PASSWORD" "$work/out" || die 'пароль попал в вывод'
}
# Выкладка через «медленный» адрес в фоне; обрыв, как только выполнится условие $1 (команда bash).
interrupt_when() {
  local condition=$1
  shift
  rm -f "$work/block"
  (
    run deploy.sh DEPLOY_HOST=e2e-slow "$@"
    exit "$status"
  ) &
  local pid=$!
  for _ in $(seq 600); do
    if eval "$condition"; then
      touch "$work/block"
      pkill -f deploy-e2e-throttle || true
      if wait "$pid"; then status=0; else status=$?; fi
      return 0
    fi
    sleep 0.05
  done
  wait "$pid" || true
  die "условие обрыва не наступило: $condition"
}
interrupted_status() { grep -q '::error::Копирование' "$work/out"; }

echo "Сервер: $USER_NAME@127.0.0.1:$PORT, папка сайта $SITE"

# --- 1. Путь к папке сайта -------------------------------------------------------------------------------
echo '1. Путь к папке сайта'
set_site "$OLD"
echo 'не трогать' >"$HOME_DIR/marker.txt"
for bad in "$HOME_DIR" "$HOME_DIR/www" "$SITE/" "$SITE/.." /var/www/u3703509; do
  run deploy.sh DEPLOY_PATH="$bad"
  ((status == 1)) && grep -q 'должна быть ровно' "$work/out" || die "путь $bad не отклонён"
done
[[ "$(cat "$HOME_DIR/marker.txt")" == 'не трогать' ]] && site_is "$OLD" && [[ -z "$(backups)" ]] ||
  die 'при неверном пути что-то изменилось на сервере'
ok 'домашняя папка, www, путь со слэшем и «..» отклонены, на сервере ничего не изменилось'

# --- 2. Выкладка rsync -------------------------------------------------------------------------------------
echo '2. Выкладка rsync'
run deploy.sh GITHUB_SHA=1111111111111111111111111111111111111111
((status == 0)) || die 'выкладка rsync не прошла'
grep -q 'Способ копирования: rsync' "$work/out" || die 'выбран не rsync'
site_is "$NEW" || die 'после rsync папка сайта не совпадает со сборкой'
ok 'папка сайта = сборка, .well-known на месте, лишнее удалено'
[[ "$(backups | wc -l)" == 1 ]] && backup_has "$(newest_backup)" "$OLD" || die 'нет копии прежней версии'
[[ "$(newest_backup)" == *-1111111.tar.gz ]] || die 'метка копии — не коммит'
ok 'перед выкладкой сохранена копия прежней версии (метка — коммит)'
[[ "$(stat -c %a "$BACKUPS")" == 700 && "$(stat -c %a "$(newest_backup)")" == 600 ]] ||
  die 'права на копии не 700/600'
[[ "$BACKUPS" != "$SITE"* ]] || die 'копии внутри папки сайта'
ok 'копии вне папки сайта, права 700 на папку и 600 на файлы'
[[ "$(find "$SITE" -type d ! -perm 755 | wc -l)" == 0 && "$(find "$SITE" -path "$SITE/.well-known" -prune -o -type f ! -perm 644 -print | wc -l)" == 0 ]] ||
  die 'права в папке сайта не 755/644'
ok 'права в папке сайта 755/644'
! grep -q '127.0.0.1' "$work/out" || die 'адрес сервера в выводе'
ok 'ключ, пароль и адрес сервера в вывод не попали'

# --- 3. Сбой резервной копии -----------------------------------------------------------------------------
echo '3. Сбой резервной копии'
set_site "$OLD"
before=$(backups)
mv "$BACKUPS" "$work/backups-saved"
install -o "$USER_NAME" -m 644 /dev/null "$BACKUPS" # на месте папки копий — файл: mkdir не сработает
run deploy.sh
((status == 1)) && grep -q 'Не удалось создать резервную копию' "$work/out" || die 'выкладка не остановилась'
site_is "$OLD" || die 'при сбое копии папка сайта изменилась'
rm -f "$BACKUPS"
mv "$work/backups-saved" "$BACKUPS"
ok 'папку копий не создать — остановка, сайт не изменён'
install -o root -m 000 /dev/null "$SITE/root-only.txt" # файл, который пользователь не может прочитать
run deploy.sh
((status == 1)) && grep -q 'Не удалось создать резервную копию' "$work/out" || die 'выкладка не остановилась'
rm -f "$SITE/root-only.txt"
site_is "$OLD" || die 'при сбое копии папка сайта изменилась'
[[ "$(backups)" == "$before" && -z "$(find "$BACKUPS" -name '.partial-*')" ]] || die 'остался неполный архив'
ok 'ошибка tar (нечитаемый файл) — остановка, сайт не изменён, неполный архив удалён'
# Копии с именами на эту и следующую секунду уже есть (две операции в одну секунду): не перезаписываются.
now=$(date -u +%s)
taken=()
for d in 0 1; do
  taken+=("$BACKUPS/konturix-$(date -u -d "@$((now + d))" +%Y%m%d-%H%M%S)-manual.tar.gz")
  echo "занято $d" >"${taken[-1]}"
done
n=$(backups | wc -l)
run deploy.sh
((status == 0)) && [[ "$(backups | wc -l)" == $((n + 1)) ]] || die 'при занятом имени копии выкладка не прошла'
[[ "$(cat "${taken[0]}")" == 'занято 0' && "$(cat "${taken[1]}")" == 'занято 1' ]] || die 'копия с тем же именем перезаписана'
rm -f "${taken[@]}"
ok 'имя копии занято (та же секунда) — новое имя, прежняя копия не перезаписана'

# --- 4. Обрыв rsync ---------------------------------------------------------------------------------------
echo '4. Обрыв связи во время rsync'
set_site "$OLD"
interrupt_when '[[ -n "$(find "$SITE" -path "*/.~tmp~/*" -type f 2>/dev/null | head -1)" ]]'
((status == 1)) && interrupted_status || die 'обрыв rsync не дал ошибку'
python3 "$work/consistent.py" "$OLD" "$NEW" "$SITE" >"$work/check" || die "после обрыва: $(cat "$work/check")"
files_are "$OLD" || die 'после обрыва rsync сайт — не прежняя версия'
ok 'после обрыва на сайте прежняя версия целиком (новые файлы — только во временной .~tmp~, новые папки пустые)'
rm -f "$work/block"
run deploy.sh
((status == 0)) && site_is "$NEW" || die 'повторная выкладка после обрыва не прошла'
ok 'повторный запуск: новая версия, временные файлы убраны'

# --- 5. Выкладка по SFTP -----------------------------------------------------------------------------------
echo '5. Выкладка по SFTP (lftp)'
set_site "$OLD"
n=$(backups | wc -l)
run deploy.sh DEPLOY_METHOD=sftp
((status == 0)) || die 'выкладка SFTP не прошла'
site_is "$NEW" || die 'после SFTP папка сайта не совпадает со сборкой'
[[ "$(backups | wc -l)" -gt "$n" || "$n" == 5 ]] && backup_has "$(newest_backup)" "$OLD" || die 'нет копии перед SFTP'
ok 'папка сайта = сборка, временные .in.* убраны, перед копированием сохранена копия'

# --- 6. Обрыв SFTP на проходах 1–3 (3-й обычно успевает закончиться) -------------------------------------------------------------------------
echo '6. Обрыв связи во время SFTP'
# shellcheck disable=SC2034 # читается в условии обрыва через eval
new_index_sum=$(sha256sum <"$NEW/index.html")
for phase in 1 2 3; do
  set_site "$OLD"
  case $phase in
    # 1-й проход: появился первый временный файл .in.*.
    1) condition='[[ -n "$(find "$SITE" -name ".in.*" 2>/dev/null | head -1)" ]]' ;;
    # 2-й проход: главная страница уже новая (страницы копируются после всех остальных файлов).
    2) condition='[[ -f "$SITE/index.html" && "$(sha256sum <"$SITE/index.html")" == "$new_index_sum" ]]' ;;
    # 3-й проход только удаляет: обрыв, как только началось удаление лишнего.
    3) condition='[[ ! -f "$SITE/stale.txt" || ! -d "$SITE/old-only" ]]' ;;
  esac
  interrupt_when "$condition" DEPLOY_METHOD=sftp
  python3 "$work/consistent.py" "$OLD" "$NEW" "$SITE" >"$work/check" ||
    die "обрыв на проходе $phase: $(cat "$work/check")"
  if ((status == 0)); then
    ok "проход $phase: копирование успело закончиться до обрыва, сайт целый"
  else
    interrupted_status || die "обрыв на проходе $phase: нет понятной ошибки"
    ok "обрыв на проходе $phase: ошибка, все страницы целые и со всеми своими файлами ($(head -1 "$work/check"))"
  fi
  rm -f "$work/block"
  run deploy.sh DEPLOY_METHOD=sftp
  ((status == 0)) && site_is "$NEW" || die "повторный запуск после обрыва на проходе $phase не прошёл"
done
ok 'после каждого обрыва повторный запуск даёт новую версию без остатков'

# --- 7. Ротация копий ------------------------------------------------------------------------------------
echo '7. Хранятся последние 5 копий'
for _ in 1 2 3 4 5 6; do
  run deploy.sh
  ((status == 0)) || die 'выкладка для ротации не прошла'
  sleep 1 # имя копии — до секунды
done
[[ "$(backups | wc -l)" == 5 ]] || die "копий $(backups | wc -l), а не 5"
ok 'после 6 выкладок подряд копий ровно 5'

# --- 8. Восстановление -------------------------------------------------------------------------------------
echo '8. Восстановление из копии'
set_site "$OLD"
run deploy.sh
((status == 0)) && site_is "$NEW" || die 'подготовка к восстановлению не прошла'
old_backup=$(basename "$(newest_backup)")
sleep 1
run restore.sh RESTORE_BACKUP=list
((status == 0)) && grep -q "$old_backup" "$work/out" || die 'list не показал копии'
site_is "$NEW" || die 'list изменил сайт'
ok 'list показывает копии и ничего не меняет'
run restore.sh RESTORE_BACKUP=latest RESTORED_INDEX="$work/restored-index.html"
((status == 0)) && site_is "$OLD" || die 'restore latest не вернул прежнюю версию'
cmp -s "$work/restored-index.html" "$OLD/index.html" || die 'RESTORED_INDEX не та страница'
backup_has "$(newest_backup)" "$NEW" && [[ "$(newest_backup)" == *-restore.tar.gz ]] ||
  die 'перед восстановлением не сохранена копия текущего состояния'
ok 'latest (rsync): вернулась прежняя версия; перед этим сохранена копия текущей'
sleep 1
run restore.sh RESTORE_BACKUP=latest DEPLOY_METHOD=sftp
((status == 0)) && site_is "$NEW" || die 'повторный latest не вернул новую версию'
ok 'повторный latest (SFTP): восстановление отменено, снова новая версия'
sleep 1
run restore.sh RESTORE_BACKUP="$old_backup" DEPLOY_METHOD=sftp
((status == 0)) && site_is "$OLD" || die 'восстановление по имени не прошло'
ok "копия по имени ($old_backup, SFTP): прежняя версия"
run restore.sh RESTORE_BACKUP=konturix-20200101-000000-none.tar.gz
((status == 1)) && site_is "$OLD" || die 'несуществующая копия не отклонена'
ok 'несуществующая копия — отказ, сайт не изменён'

# Подложенная копия с файлом вне папки сайта — новее всех, поэтому именно её выберет latest.
mkdir -p "$work/evil/konturix.ru"
echo evil >"$work/evil/evil.txt"
tar -czf "$BACKUPS/konturix-29991231-235959-evil.tar.gz" -C "$work/evil" konturix.ru evil.txt \
  --transform 's,^evil.txt$,konturix.ru/../evil.txt,'
n=$(backups | wc -l)
run restore.sh RESTORE_BACKUP=latest
((status == 1)) && site_is "$OLD" && [[ "$(backups | wc -l)" == "$n" ]] && [[ ! -e "$HOME_DIR/www/evil.txt" ]] ||
  die 'подложенная копия с «..» не отклонена'
rm -f "$BACKUPS/konturix-29991231-235959-evil.tar.gz"
ok 'копия с путём вне папки сайта — отказ до любых изменений'

# --- 9. Вход по паролю -------------------------------------------------------------------------------------
echo '9. Вход по паролю (без ключа)'
for method in rsync sftp; do
  set_site "$OLD"
  run deploy.sh DEPLOY_SSH_KEY= DEPLOY_PASSWORD="$PASSWORD" DEPLOY_METHOD=$method
  ((status == 0)) && site_is "$NEW" || die "выкладка по паролю ($method) не прошла"
done
ok 'rsync и SFTP по паролю; пароль в вывод не попал'

[[ "$(cat "$HOME_DIR/marker.txt")" == 'не трогать' ]] || die 'изменён файл вне папки сайта'
ok 'файл в домашней папке вне папки сайта не тронут за все проверки'
echo "Все проверки пройдены: $passed."
