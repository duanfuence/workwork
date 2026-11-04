#!/usr/bin/env bash
# Проверка выкладки и восстановления на настоящем SSH-сервере (D-035): три этапа rsync и SFTP, хранение
# прежних CSS/JS, резервные копии и их ротация, сбой копии, сбой каждого этапа, аварийное завершение rsync на
# сервере во время финального переноса файлов, обрыв связи, восстановление, вход по паролю.
#
# Сервер поднимается локально и повторяет хостинг: пользователь u3703509, домашняя папка
# /var/www/u3703509/data, папка сайта /var/www/u3703509/data/www/konturix.ru, свой sshd на 127.0.0.1:
#   - порт 2222 — обычный вход;
#   - порт 2223 — тот же сервер, но команда rsync на сервере идёт через обёртку: она может завершиться
#     ошибкой на N-м запуске rsync (сбой этапа N) или замедлить переименования через strace, чтобы
#     тест успел убить процесс посреди финального переноса файлов.
# Обрыв связи — через «медленный» адрес e2e-slow: соединение идёт через прокси с ограничением скорости,
# который убивается посреди копирования, а новые подключения запрещаются.
#
# Меняет систему (создаёт пользователя и папки, файл в /etc/ssh/ssh_config.d), поэтому запускается только
# во временной среде (контейнер, раннер GitHub) от root и только с DEPLOY_E2E=1:
#   SITE_URL=https://example.com npm run build && sudo DEPLOY_E2E=1 bash scripts/deploy-e2e.sh
# (сборка с адресом: без него нет sitemap.xml, и выкладка верно откажется).
# Нужны: sshd, rsync, lftp, sshpass, strace, python3, tar.
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
for tool in sshd rsync lftp sshpass strace python3 tar; do
  command -v "$tool" >/dev/null || [[ -x /usr/sbin/$tool ]] || {
    echo "Нет $tool." >&2
    exit 2
  }
done

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
WRAP_PORT=2223
PASSWORD='e2e pass$(not-run);"x'
SSH_CONF=/etc/ssh/ssh_config.d/zz-deploy-e2e.conf

work=$(mktemp -d)
# Папка управления обёрткой rsync — доступна пользователю сервера (он пишет счётчик и журнал strace).
ctl=$(mktemp -d /tmp/deploy-e2e-ctl.XXXXXX)
chmod 777 "$ctl"
sshd_pid=''
cleanup() {
  [[ -n "$sshd_pid" ]] && kill "$sshd_pid" 2>/dev/null || true
  pkill -f deploy-e2e-throttle 2>/dev/null || true
  rm -f "$SSH_CONF"
  rm -rf "${work:?}" "${ctl:?}"
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
rm -rf "${BACKUPS:?}" "${HOME_DIR:?}/elsewhere"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$HOME_DIR/www" "$SITE"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$HOME_DIR/.ssh"
ssh-keygen -q -t ed25519 -N '' -f "$work/client" -C deploy-e2e
install -o "$USER_NAME" -g "$USER_NAME" -m 600 "$work/client.pub" "$HOME_DIR/.ssh/authorized_keys"
ssh-keygen -q -t ed25519 -N '' -f "$work/hostkey"

# Обёртка для порта 2223: режим — в $ctl/mode («fail:N» или «slow:N»), N — номер запуска rsync на сервере.
cat >"$ctl/wrap.sh" <<EOF
#!/bin/bash
ctl=$ctl
EOF
cat >>"$ctl/wrap.sh" <<'EOF'
cmd=${SSH_ORIGINAL_COMMAND:-}
if [[ "$cmd" == "rsync --server"* ]]; then
  n=$(($(cat "$ctl/count" 2>/dev/null || echo 0) + 1))
  echo "$n" >"$ctl/count"
  mode=$(cat "$ctl/mode" 2>/dev/null || true)
  [[ "$mode" != "fail:$n" ]] || exit 1
  if [[ "$mode" == "slow:$n" ]]; then
    exec strace -f -qq -o "$ctl/trace" -e trace=/^rename -e inject=/^rename:delay_enter=250000 bash -c "$cmd"
  fi
fi
[[ "$cmd" != sftp && "$cmd" != internal-sftp ]] || exec /usr/lib/openssh/sftp-server
exec bash -c "$cmd"
EOF
chmod 755 "$ctl/wrap.sh"

mkdir -p /run/sshd
cat >"$work/sshd_config" <<EOF
Port $PORT
Port $WRAP_PORT
ListenAddress 127.0.0.1
HostKey $work/hostkey
PidFile $work/sshd.pid
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM no
AllowUsers $USER_NAME
Subsystem sftp internal-sftp
Match LocalPort $WRAP_PORT
  ForceCommand $ctl/wrap.sh
EOF
/usr/sbin/sshd -f "$work/sshd_config" -D -e 2>"$work/sshd.log" &
sshd_pid=$!
for _ in $(seq 50); do
  (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && break
  sleep 0.1
done
hostkey=$(cut -d' ' -f1,2 "$work/hostkey.pub")
KNOWN_HOSTS="[127.0.0.1]:$PORT $hostkey
[127.0.0.1]:$WRAP_PORT $hostkey
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
# OLD — прежняя версия: те же страницы с другим содержимым, свой CSS (old-style.css), страница и файл,
#       которых в новых версиях нет.
# NEW — настоящая сборка и «тяжёлый» файл _astro/zz-filler.bin (копирование идёт достаточно долго).
# NEW2 — следующая версия: все страницы изменены, на главной — новый CSS v2-extra.css, без zz-filler.bin.
NEW=$work/new
NEW2=$work/new2
OLD=$work/old
cp -a "$DIST" "$NEW"
head -c 700000 /dev/urandom >"$NEW/_astro/zz-filler.bin"
cp -a "$NEW" "$NEW2"
rm -f "$NEW2/_astro/zz-filler.bin"
echo 'body{outline:0}' >"$NEW2/_astro/v2-extra.css"
while IFS= read -r page; do echo '<!-- v2 -->' >>"$NEW2/$page"; done < <(cd "$NEW2" && find . -name '*.html')
sed -i 's#</head>#<link rel="stylesheet" href="/_astro/v2-extra.css"></head>#' "$NEW2/index.html"
grep -q v2-extra.css "$NEW2/index.html" || die 'не удалось подготовить NEW2'
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

# check.py has VERSION ROOT — в ROOT ровно файлы VERSION байт в байт; лишними могут быть только файлы
#   в _astro/ из других версий (прежние CSS/JS); остатков копирования нет. .well-known не учитывается.
# check.py consistent ROOT — каждый файл в ROOT целиком совпадает с тем же файлом одной из версий (не
#   обрезан и не чужой), у каждой страницы на месте всё, на что она ссылается в /_astro/ и /fonts/, ни одна
#   страница, которая есть во всех версиях, не пропала.
cat >"$work/check.py" <<PY
import os, re, sys
VERSIONS = ['$OLD', '$NEW', '$NEW2']
PY
cat >>"$work/check.py" <<'PY'
def files(root):
    out = {}
    for d, dirs, fs in os.walk(root):
        rel = os.path.relpath(d, root)
        parts = [] if rel == '.' else rel.split(os.sep)
        if parts and parts[0] == '.well-known':
            continue
        for f in fs:
            out[os.path.normpath(os.path.join(rel, f))] = os.path.join(d, f)
    return out
def read(p):
    with open(p, 'rb') as fh:
        return fh.read()
def leftover(rel):
    return '.~tmp~' in rel.split(os.sep) or os.path.basename(rel).startswith('.in.')
def in_some_version(rel, data):
    return any(os.path.isfile(os.path.join(v, rel)) and read(os.path.join(v, rel)) == data for v in VERSIONS)
problems = []
if sys.argv[1] == 'has':
    want, have = files(sys.argv[2]), files(sys.argv[3])
    for rel, p in want.items():
        if rel not in have:
            problems.append('нет файла ' + rel)
        elif read(have[rel]) != read(p):
            problems.append('другое содержимое ' + rel)
    for rel, p in have.items():
        if rel in want:
            continue
        parts = rel.split(os.sep)
        if leftover(rel):
            problems.append('остаток копирования ' + rel)
        elif not (parts[0] == '_astro' and len(parts) == 2 and in_some_version(rel, read(p))):
            problems.append('лишний файл ' + rel)
else:
    root = sys.argv[2]
    have = files(root)
    leftovers = 0
    for rel, p in have.items():
        if leftover(rel):
            leftovers += 1
            continue
        data = read(p)
        if not in_some_version(rel, data):
            problems.append('файл не совпадает ни с одной версией: ' + rel)
        if rel.endswith('.html'):
            for ref in re.findall(rb'(?:href|src)="(/(?:_astro|fonts)/[^"#?]+)"', data):
                if not os.path.isfile(os.path.join(root, ref.decode().lstrip('/'))):
                    problems.append('%s ссылается на отсутствующий %s' % (rel, ref.decode()))
    common = set.intersection(*[set(files(v)) for v in VERSIONS])
    for rel in sorted(common):
        if rel.endswith('.html') and rel not in have:
            problems.append('пропала страница ' + rel)
    print('остатки прерванного копирования: %d' % leftovers)
for p in problems:
    print('ПРОБЛЕМА: ' + p)
sys.exit(1 if problems else 0)
PY

set_site() { # $1 — содержимое папки сайта (как будто положено вручную); .well-known всегда на месте
  find "$SITE" -mindepth 1 -delete
  cp -a "$1/." "$SITE/"
  mkdir -p "$SITE/.well-known/acme-challenge"
  echo acme >"$SITE/.well-known/acme-challenge/token"
  chown -R "$USER_NAME:$USER_NAME" "$SITE"
  rm -f "$BACKUPS/.assets-live" "$BACKUPS/.site-state"
}
token_ok() { [[ "$(cat "$SITE/.well-known/acme-challenge/token")" == acme ]]; }
site_has() { python3 "$work/check.py" has "$1" "$SITE" >"$work/check" && token_ok; }
consistent() { python3 "$work/check.py" consistent "$SITE" >"$work/check" && token_ok; }
files_are() { # файлы в папке сайта (без .well-known и .~tmp~) — ровно файлы $1, байт в байт; папки не важны
  local list
  list=$(cd "$SITE" && find . -path ./.well-known -prune -o -name '.~tmp~' -prune -o -type f -print | sort)
  [[ "$list" == "$(cd "$1" && find . -type f | sort)" ]] || return 1
  while IFS= read -r f; do cmp -s "$1/$f" "$SITE/$f" || return 1; done <<<"$list"
}
backups() { find "$BACKUPS" -maxdepth 1 -name 'konturix-*.tar.gz' 2>/dev/null | sort; }
regular() { backups | grep -v -- '-initial\.tar\.gz$' || true; }
newest_backup() { backups | grep -v -- '-29991231-' | tail -n 1; }
backup_has() { # копия $1 содержит версию $2 (лишними могут быть только прежние CSS/JS)
  rm -rf "${work:?}/x" && mkdir "$work/x" && tar -xzf "$1" -C "$work/x" &&
    python3 "$work/check.py" has "$2" "$work/x/konturix.ru" >/dev/null
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
deploy() { # выкладка версии $1 (обычный вход); остальное — VAR=значение
  local dist=$1
  shift
  run deploy.sh DIST_DIR="$dist" "$@"
}
wrap_mode() { # режим обёртки rsync на порту 2223
  echo "$1" >"$ctl/mode"
  rm -f "$ctl/count" "$ctl/trace"
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
honest_error() { # сообщение о прерванном копировании на этапе $1 — честное
  grep -q "::error::Копирование прервано на этапе $1 из 3" "$work/out" &&
    grep -q 'Сайт может быть частично обновлён' "$work/out" && grep -q 'Restore' "$work/out"
}
pages_of() { # сколько страниц сайта совпадает со страницами версии $1
  local n=0 page
  while IFS= read -r page; do cmp -s "$1/$page" "$SITE/$page" && n=$((n + 1)); done < <(cd "$1" && find . -name '*.html')
  echo "$n"
}

echo "Сервер: $USER_NAME@127.0.0.1:$PORT (обёртка rsync — порт $WRAP_PORT), папка сайта $SITE"

# --- 1. Путь к папке сайта -------------------------------------------------------------------------------
echo '1. Путь к папке сайта'
set_site "$OLD"
echo 'не трогать' >"$HOME_DIR/marker.txt"
for bad in "$HOME_DIR" "$HOME_DIR/www" "$SITE/" "$SITE/.." /var/www/u3703509; do
  run deploy.sh DEPLOY_PATH="$bad"
  ((status == 1)) && grep -q 'должна быть ровно' "$work/out" || die "путь $bad не отклонён"
done
[[ "$(cat "$HOME_DIR/marker.txt")" == 'не трогать' ]] && files_are "$OLD" && [[ -z "$(backups)" ]] ||
  die 'при неверном пути что-то изменилось на сервере'
ok 'домашняя папка, www, путь со слэшем и «..» отклонены, на сервере ничего не изменилось'

# --- 2. Выкладка rsync -------------------------------------------------------------------------------------
echo '2. Выкладка rsync (три этапа)'
deploy "$NEW" GITHUB_SHA=1111111111111111111111111111111111111111
((status == 0)) || die 'выкладка rsync не прошла'
grep -q 'Способ копирования: rsync' "$work/out" || die 'выбран не rsync'
site_has "$NEW" || die "после rsync папка сайта не совпадает со сборкой: $(cat "$work/check")"
[[ ! -e "$SITE/stale.txt" && ! -e "$SITE/old-only" ]] || die 'устаревшие файлы не удалены'
ok 'папка сайта = сборка, .well-known на месте, устаревшие страницы и файлы удалены'
[[ -f "$SITE/_astro/old-style.css" ]] || die 'прежний CSS удалён в той же выкладке'
ok 'прежний CSS (_astro/old-style.css) не удалён в той же выкладке'
first=$(newest_backup)
[[ "$(backups | wc -l)" == 1 && "$first" == *-initial.tar.gz && -e "$first.ok" ]] && backup_has "$first" "$OLD" ||
  die 'первая копия — не initial с прежней версией'
ok 'первая копия — initial (то, что было до первой выкладки), отмечена как полная'
[[ "$(stat -c %a "$BACKUPS")" == 700 && "$(stat -c %a "$first")" == 600 ]] || die 'права на копии не 700/600'
[[ "$BACKUPS" != "$SITE"* ]] || die 'копии внутри папки сайта'
ok 'копии вне папки сайта, права 700 на папку и 600 на файлы'
[[ "$(find "$SITE" -type d ! -perm 755 | wc -l)" == 0 && "$(find "$SITE" -path "$SITE/.well-known" -prune -o -type f ! -perm 644 -print | wc -l)" == 0 ]] ||
  die 'права в папке сайта не 755/644'
ok 'права в папке сайта 755/644'
! grep -q '127.0.0.1' "$work/out" || die 'адрес сервера в выводе'
ok 'ключ, пароль и адрес сервера в вывод не попали'

# --- 3. Прежние CSS/JS -------------------------------------------------------------------------------------
echo '3. Хранение прежних CSS/JS: текущая и предыдущая версии'
deploy "$NEW2"
((status == 0)) && site_has "$NEW2" || die "выкладка NEW2 не прошла: $(cat "$work/check")"
[[ -f "$SITE/_astro/zz-filler.bin" ]] || die 'CSS/JS предыдущей версии удалены сразу'
[[ ! -e "$SITE/_astro/old-style.css" ]] || die 'CSS позапрошлой версии не удалён'
ok 'NEW → NEW2: файлы NEW сохранены, файлы позапрошлой (OLD) удалены'
deploy "$NEW"
((status == 0)) && [[ -f "$SITE/_astro/v2-extra.css" ]] || die 'NEW2 → NEW: CSS NEW2 удалён сразу'
deploy "$NEW"
((status == 0)) && site_has "$NEW" && [[ ! -e "$SITE/_astro/v2-extra.css" ]] ||
  die 'NEW → NEW: CSS NEW2 не удалён через выкладку'
ok 'CSS/JS предыдущей версии хранятся ровно одну выкладку, затем удаляются'

# --- 4. Сбой резервной копии и защита каталога копий ---------------------------------------------------------
echo '4. Сбой резервной копии, ссылка вместо каталога копий, занятое имя'
set_site "$OLD"
before=$(backups)
mv "$BACKUPS" "$work/backups-saved"
install -o "$USER_NAME" -m 644 /dev/null "$BACKUPS" # на месте папки копий — файл
deploy "$NEW"
((status == 1)) && grep -q 'не папка' "$work/out" || die 'выкладка не остановилась (файл вместо папки копий)'
files_are "$OLD" || die 'папка сайта изменилась'
rm -f "$BACKUPS"
install -d -o "$USER_NAME" -m 755 "$HOME_DIR/elsewhere"
ln -s "$HOME_DIR/elsewhere" "$BACKUPS"
chown -h "$USER_NAME:$USER_NAME" "$BACKUPS"
deploy "$NEW"
((status == 1)) && grep -q 'символическая ссылка' "$work/out" || die 'ссылка на каталог копий не остановила выкладку'
files_are "$OLD" && [[ -z "$(ls -A "$HOME_DIR/elsewhere")" && "$(stat -c %a "$HOME_DIR/elsewhere")" == 755 ]] ||
  die 'при ссылке на каталог копий что-то изменилось'
run restore.sh RESTORE_BACKUP=latest
((status == 1)) && grep -q 'символическая ссылка' "$work/out" && files_are "$OLD" || die 'restore не остановился'
rm -f "$BACKUPS"
rm -rf "${HOME_DIR:?}/elsewhere"
mv "$work/backups-saved" "$BACKUPS"
ok 'каталог копий — ссылка или файл: выкладка и восстановление остановлены до любых изменений'
install -o root -m 000 /dev/null "$SITE/root-only.txt" # файл, который пользователь не может прочитать
deploy "$NEW"
((status == 1)) && grep -q 'Не удалось создать резервную копию' "$work/out" || die 'выкладка не остановилась'
rm -f "$SITE/root-only.txt"
files_are "$OLD" || die 'при сбое копии папка сайта изменилась'
[[ "$(backups)" == "$before" && -z "$(find "$BACKUPS" -name '.partial-*')" ]] || die 'остался неполный архив'
ok 'ошибка tar (нечитаемый файл) — остановка, сайт не изменён, неполный архив удалён'
now=$(date -u +%s)
taken=()
for d in 0 1; do
  taken+=("$BACKUPS/konturix-$(date -u -d "@$((now + d))" +%Y%m%d-%H%M%S)-manual.tar.gz")
  echo "занято $d" >"${taken[-1]}"
done
n=$(backups | wc -l)
deploy "$NEW"
((status == 0)) && [[ "$(backups | wc -l)" -ge "$n" ]] || die 'при занятом имени копии выкладка не прошла'
[[ "$(cat "${taken[0]}")" == 'занято 0' && "$(cat "${taken[1]}")" == 'занято 1' ]] || die 'копия с тем же именем перезаписана'
rm -f "${taken[@]}"
ok 'имя копии занято (та же секунда) — новое имя, прежняя копия не перезаписана'

# --- 5. Сбой каждого этапа rsync ---------------------------------------------------------------------------
echo '5. Сбой каждого этапа rsync (NEW → NEW2) и повторная выкладка'
for stage in 1 2 3; do
  deploy "$NEW" && ((status == 0)) || die 'подготовка не прошла'
  wrap_mode "fail:$stage"
  deploy "$NEW2" DEPLOY_PORT=$WRAP_PORT
  ((status == 1)) && honest_error "$stage" || die "сбой этапа $stage: нет честного сообщения"
  consistent || die "сбой этапа $stage: $(cat "$work/check")"
  case $stage in
    1) [[ "$(pages_of "$NEW2")" == 0 && ! -e "$SITE/_astro/v2-extra.css" ]] || die 'этап 1: что-то изменилось' ;;
    2) [[ -f "$SITE/_astro/v2-extra.css" && "$(pages_of "$NEW2")" == 0 ]] || die 'этап 2: страницы изменились до этапа 2' ;;
    3) [[ "$(pages_of "$NEW2")" == "$(cd "$NEW2" && find . -name '*.html' | wc -l)" ]] || die 'этап 3: не все страницы новые' ;;
  esac
  [[ "$(cat "$BACKUPS/.site-state")" == incomplete ]] || die "сбой этапа $stage: нет отметки о незавершённой операции"
  wrap_mode none
  deploy "$NEW2"
  ((status == 0)) && site_has "$NEW2" && [[ "$(cat "$BACKUPS/.site-state")" == complete ]] ||
    die "повторная выкладка после сбоя этапа $stage не прошла: $(cat "$work/check")"
  ok "сбой этапа $stage: честная ошибка, сайт целостен; повторная выкладка — новая версия"
done

# --- 6. Аварийное завершение rsync на сервере во время финального переноса ------------------------------------
echo '6. rsync на сервере убит посреди финального переноса файлов (этап 2)'
deploy "$NEW" && ((status == 0)) || die 'подготовка не прошла'
wrap_mode slow:2
(
  run deploy.sh DIST_DIR="$NEW2" DEPLOY_PORT=$WRAP_PORT
  exit "$status"
) &
pid=$!
killed=''
final_rename='rename[a-z0-9]*\((AT_FDCWD, )?"[^"]*\.~tmp~/'
for _ in $(seq 600); do
  if [[ -f "$ctl/trace" ]] && (($(grep -cE "$final_rename" "$ctl/trace" || true) >= 3)); then
    killed=$(grep -E "$final_rename" "$ctl/trace" | head -1 | awk '{print $1}')
    kill -9 "$killed"
    break
  fi
  sleep 0.05
done
if wait "$pid"; then status=0; else status=$?; fi
[[ -n "$killed" ]] || die 'финальный перенос не начался'
((status == 1)) && honest_error 2 || die 'нет честного сообщения после аварийного завершения'
consistent || die "после аварийного завершения: $(cat "$work/check")"
new_pages=$(pages_of "$NEW2")
old_pages=$(pages_of "$NEW")
((new_pages > 0 && old_pages > 0)) || die "ожидалось частичное обновление: новых $new_pages, прежних $old_pages"
ok "сайт частично обновлён (новых страниц: $new_pages, прежних: $old_pages), но у каждой страницы на месте её CSS/JS"
wrap_mode none
deploy "$NEW2"
((status == 0)) && site_has "$NEW2" || die "повторная выкладка не прошла: $(cat "$work/check")"
ok 'повторная выкладка после аварийного завершения: новая версия, временные файлы убраны'

# --- 7. SFTP -------------------------------------------------------------------------------------------------
echo '7. Выкладка по SFTP (lftp)'
set_site "$OLD"
deploy "$NEW" DEPLOY_METHOD=sftp
((status == 0)) && site_has "$NEW" && [[ ! -e "$SITE/stale.txt" ]] || die "выкладка SFTP не прошла: $(cat "$work/check")"
deploy "$NEW2" DEPLOY_METHOD=sftp
((status == 0)) && site_has "$NEW2" && [[ -f "$SITE/_astro/zz-filler.bin" && ! -e "$SITE/_astro/old-style.css" ]] ||
  die 'SFTP: прежние CSS/JS удалены сразу или позапрошлые не удалены'
ok 'SFTP: папка сайта = сборка, CSS/JS предыдущей версии сохранены, позапрошлой — удалены'
# shellcheck disable=SC2034 # читается в условии обрыва через eval
new_index_sum=$(sha256sum <"$NEW/index.html")
for phase in 1 2 3; do
  set_site "$OLD"
  case $phase in
    1) condition='[[ -n "$(find "$SITE" -name ".in.*" 2>/dev/null | head -1)" ]]' ;;
    2) condition='[[ -f "$SITE/index.html" && "$(sha256sum <"$SITE/index.html")" == "$new_index_sum" ]]' ;;
    3) condition='[[ ! -f "$SITE/stale.txt" || ! -d "$SITE/old-only" ]]' ;;
  esac
  interrupt_when "$condition" DEPLOY_METHOD=sftp
  consistent || die "обрыв на проходе $phase: $(cat "$work/check")"
  if ((status == 0)); then
    ok "проход $phase: копирование успело закончиться до обрыва, сайт целостен"
  else
    honest_error "$phase" || die "обрыв на проходе $phase: нет честного сообщения"
    ok "обрыв на проходе $phase: честная ошибка, у каждой страницы на месте её CSS/JS ($(head -1 "$work/check"))"
  fi
  rm -f "$work/block"
  deploy "$NEW" DEPLOY_METHOD=sftp
  ((status == 0)) && site_has "$NEW" || die "повторный запуск после обрыва на проходе $phase не прошёл"
done

# --- 8. Политика хранения копий -------------------------------------------------------------------------------
echo '8. Хранение копий: первая копия и последняя полная версия'
rm -rf "${BACKUPS:?}"
set_site "$OLD"
for _ in 1 2 3 4 5 6 7; do
  deploy "$NEW"
  ((status == 0)) || die 'выкладка для ротации не прошла'
done
initial=$(backups | grep -- '-initial\.tar\.gz$' || true)
[[ -n "$initial" && "$(regular | wc -l)" == 5 ]] && backup_has "$initial" "$OLD" ||
  die "после 7 выкладок: копий $(regular | wc -l) + первая $(basename "${initial:-нет}")"
ok 'после 7 выкладок: последние 5 копий и первая копия (до первой выкладки) с прежним сайтом'
wrap_mode fail:2
for attempt in 1 2 3 4 5 6; do
  deploy "$NEW2" DEPLOY_PORT=$WRAP_PORT
  ((status == 1)) || die "попытка $attempt не завершилась ошибкой"
  [[ $attempt != 1 ]] || good=$(newest_backup)
  rm -f "$ctl/count"
done
wrap_mode none
[[ -f "$good" && -e "$good.ok" ]] && backup_has "$good" "$NEW" && [[ -f "$initial" ]] ||
  die 'шесть неудачных попыток вытеснили последнюю полную копию или первую копию'
[[ "$(find "$BACKUPS" -maxdepth 1 -name '*.ok' ! -name "$(basename "$good").ok" -newer "$good" | wc -l)" == 0 ]] ||
  die 'копии после сбоя отмечены как полные'
ok "6 неудачных попыток: последняя полная копия ($(basename "$good")) и первая копия сохранены"
run restore.sh RESTORE_BACKUP=list
((status == 0)) && grep -q 'первая, не удаляется' "$work/out" && grep -q 'после прерванной операции' "$work/out" ||
  die 'list не показывает состояние копий'
ok 'list показывает: полная версия / после прерванной операции / первая'
deploy "$NEW2"
((status == 0)) && site_has "$NEW2" || die 'выкладка после неудачных попыток не прошла'

# --- 9. Восстановление -------------------------------------------------------------------------------------
echo '9. Восстановление'
(($(regular | wc -l) >= 5)) || die 'для проверки нужно не меньше 5 копий'
oldest=$(regular | head -1)
oldest_name=$(basename "$oldest")
rm -rf "${work:?}/x" && mkdir "$work/x" && tar -xzf "$oldest" -C "$work/x"
run restore.sh RESTORE_BACKUP="$oldest_name"
((status == 0)) || die 'восстановление самой старой копии не прошло'
[[ -f "$oldest" ]] || die 'восстанавливаемая копия удалена ротацией'
python3 "$work/check.py" has "$work/x/konturix.ru" "$SITE" >"$work/check" || die "сайт не равен копии: $(cat "$work/check")"
ok "самая старая копия ($oldest_name) восстановлена и не удалена ротацией"
s0=$(sha256sum <"$SITE/index.html")
run restore.sh RESTORE_BACKUP=latest RESTORED_INDEX="$work/restored-index.html"
((status == 0)) || die 'первый restore latest не прошёл'
s1=$(sha256sum <"$SITE/index.html")
cmp -s "$work/restored-index.html" "$SITE/index.html" || die 'RESTORED_INDEX не та страница'
run restore.sh RESTORE_BACKUP=latest
((status == 0)) && [[ "$(sha256sum <"$SITE/index.html")" == "$s0" && "$s1" != "$s0" ]] ||
  die 'два restore latest подряд не вернули исходное состояние'
[[ -f "$initial" ]] || die 'первая копия удалена'
ok 'два Restore подряд: второй отменяет первый; первая копия на месте'
run restore.sh RESTORE_BACKUP="$(basename "$initial")" DEPLOY_METHOD=sftp
((status == 0)) && site_has "$OLD" && [[ -f "$initial" ]] || die "восстановление первой копии не прошло: $(cat "$work/check")"
ok 'первая копия (SFTP): прежний сайт восстановлен, копия на месте'
run restore.sh RESTORE_BACKUP=konturix-20200101-000000-none.tar.gz
((status == 1)) && site_has "$OLD" || die 'несуществующая копия не отклонена'
ok 'несуществующая копия — отказ, сайт не изменён'
mkdir -p "$work/evil/konturix.ru"
echo evil >"$work/evil/evil.txt"
tar -czf "$BACKUPS/konturix-29991231-235959-evil.tar.gz" -C "$work/evil" konturix.ru evil.txt \
  --transform 's,^evil.txt$,konturix.ru/../evil.txt,'
n=$(backups | wc -l)
run restore.sh RESTORE_BACKUP=latest
((status == 1)) && site_has "$OLD" && [[ "$(backups | wc -l)" == "$n" ]] && [[ ! -e "$HOME_DIR/www/evil.txt" ]] ||
  die 'подложенная копия с «..» не отклонена'
rm -f "$BACKUPS/konturix-29991231-235959-evil.tar.gz"
ok 'копия с путём вне папки сайта — отказ до любых изменений'

# --- 10. Вход по паролю ------------------------------------------------------------------------------------
echo '10. Вход по паролю (без ключа)'
for method in rsync sftp; do
  set_site "$OLD"
  deploy "$NEW" DEPLOY_SSH_KEY= DEPLOY_PASSWORD="$PASSWORD" DEPLOY_METHOD=$method
  ((status == 0)) && site_has "$NEW" || die "выкладка по паролю ($method) не прошла"
done
ok 'rsync и SFTP по паролю; пароль в вывод не попал'

[[ "$(cat "$HOME_DIR/marker.txt")" == 'не трогать' ]] || die 'изменён файл вне папки сайта'
ok 'файл в домашней папке вне папки сайта не тронут за все проверки'
echo "Все проверки пройдены: $passed."
