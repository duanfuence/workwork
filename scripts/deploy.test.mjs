// Проверки scripts/deploy.sh и scripts/restore.sh без настоящего сервера: ssh, rsync, lftp подменены
// заглушками, которые записывают каждый вызов. Так видно, что именно скрипт успевает сделать до остановки.
// Работа с настоящим SSH-сервером, обрывом связи и восстановлением — scripts/deploy-e2e.sh (D-035).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SITE_DIR = '/var/www/u3703509/data/www/konturix.ru';
const KEY = 'ТЕСТОВЫЙ-ЗАКРЫТЫЙ-КЛЮЧ-НЕ-ДОЛЖЕН-ПОПАСТЬ-В-ЖУРНАЛ';
const scripts = join(import.meta.dirname);

let root = '';
let stubs = '';
let dist = '';

// Заглушка ssh: операция сценария на сервере — пятый аргумент после «sh -s --».
const SSH_STUB = `#!/usr/bin/env bash
cat >/dev/null
args=("$@")
op=''
for ((i = 1; i < \${#args[@]}; i++)); do
  if [[ "\${args[i]}" == -- && "\${args[i-1]}" == -s ]]; then op="\${args[i+4]}"; arg="\${args[i+5]:-}"; fi
done
echo "ssh $op $arg" >>"$STUB_LOG"
[[ ",\${STUB_FAIL:-}," == *",$op,"* ]] && exit 1
case "$op" in
  preflight) echo "\${STUB_PREFLIGHT:-rsync}" ;;
  backup) echo 4242 ;;
  list) [[ -n "\${STUB_LIST:-}" ]] && printf '%s\\n' "$STUB_LIST" ;;
  cat) cat "$STUB_ARCHIVE" ;;
esac
exit 0
`;
const TOOL_STUB = (name) => `#!/usr/bin/env bash
all="$*"
echo "${name} \${all//$'\\n'/ }" >>"$STUB_LOG"
[[ ",\${STUB_FAIL:-}," == *",${name},"* ]] && exit 1
exit 0
`;

function write(path, content, mode = 0o644) {
  writeFileSync(path, content);
  chmodSync(path, mode);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'deploy-test-'));
  stubs = join(root, 'bin');
  mkdirSync(stubs);
  write(join(stubs, 'ssh'), SSH_STUB, 0o755);
  for (const tool of ['rsync', 'lftp', 'sshpass']) write(join(stubs, tool), TOOL_STUB(tool), 0o755);
  dist = join(root, 'dist');
  mkdirSync(join(dist, 'kalkulyatory'), { recursive: true });
  for (const file of ['index.html', '404.html', '.htaccess', 'robots.txt', 'sitemap.xml']) {
    write(join(dist, file), `${file}\n`);
  }
  write(join(dist, 'kalkulyatory', 'index.html'), 'page\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(script, env = {}) {
  const log = join(root, `log-${Math.random().toString(36).slice(2)}`);
  writeFileSync(log, '');
  const result = spawnSync('bash', [join(scripts, script)], {
    encoding: 'utf8',
    env: {
      PATH: `${stubs}:${process.env.PATH}`,
      HOME: root,
      STUB_LOG: log,
      DIST_DIR: dist,
      DEPLOY_HOST: '192.0.2.10',
      DEPLOY_USER: 'u3703509',
      DEPLOY_PATH: SITE_DIR,
      DEPLOY_KNOWN_HOSTS: '192.0.2.10 ssh-ed25519 AAAAtest',
      DEPLOY_SSH_KEY: KEY,
      ...env,
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return { status: result.status, output: result.stdout + result.stderr, calls };
}

// Опасные и похожие на правильный пути: каждый — отказ до любого обращения к серверу.
const DANGEROUS_PATHS = [
  '/',
  '//',
  '/var',
  '/var/www',
  '/var/www/u3703509',
  '/var/www/u3703509/data',
  '/var/www/u3703509/data/',
  '/var/www/u3703509/data/www',
  '/var/www/u3703509/data/www/',
  '/var/www/u3703509/data/www/other.ru',
  '/var/www/u1234567/data/www/konturix.ru',
  `${SITE_DIR}/`,
  `${SITE_DIR}//`,
  `${SITE_DIR}/..`,
  `${SITE_DIR}/../other.ru`,
  `${SITE_DIR}/sub`,
  `${SITE_DIR}.bak`,
  `/var/www/u3703509/data/www/./konturix.ru`,
  `/var/www/u3703509/data/www//konturix.ru`,
  `//var/www/u3703509/data/www/konturix.ru`,
  'var/www/u3703509/data/www/konturix.ru',
  `${SITE_DIR} `,
  ` ${SITE_DIR}`,
  `${SITE_DIR}\n/`,
  `${SITE_DIR};rm -rf ~`,
  `${SITE_DIR}*`,
  '/VAR/WWW/U3703509/DATA/WWW/KONTURIX.RU',
  '~/www/konturix.ru',
  '$HOME/www/konturix.ru',
];

describe('путь к папке сайта (SSH_TARGET)', () => {
  for (const script of ['deploy.sh', 'restore.sh']) {
    it.each(DANGEROUS_PATHS.map((path) => [JSON.stringify(path), path]))(
      `${script}: %s — отказ до подключения к серверу`,
      (_label, path) => {
        const { status, output, calls } = run(script, { DEPLOY_PATH: path });
        expect(status).toBe(1);
        expect(output).toContain(`должна быть ровно ${SITE_DIR}`);
        expect(calls).toEqual([]);
      },
    );
  }

  it('пустой путь — отказ до подключения к серверу', () => {
    const { status, output, calls } = run('deploy.sh', { DEPLOY_PATH: '' });
    expect(status).toBe(1);
    expect(output).toContain('Не задан секрет DEPLOY_PATH');
    expect(calls).toEqual([]);
  });

  it('разрешённый путь — проверка, резервная копия, затем копирование', () => {
    const { status, calls, output } = run('deploy.sh');
    expect(status, output).toBe(0);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe('ssh preflight');
    expect(calls[1]).toMatch(/^ssh backup konturix-\d{8}-\d{6}-manual\.tar\.gz$/);
    expect(calls[2]).toMatch(/^rsync .*--delete-delay --delay-updates/);
    expect(calls[2]).toContain(`:${SITE_DIR}/`);
    expect(calls[2]).not.toMatch(/--delete(?!-delay)/);
  });
});

describe('выкладка', () => {
  it('метка резервной копии — коммит', () => {
    const { calls } = run('deploy.sh', { GITHUB_SHA: 'a'.repeat(40) });
    expect(calls[1]).toMatch(/-aaaaaaa\.tar\.gz$/);
  });

  it('резервная копия не создалась — остановка без копирования', () => {
    const { status, output, calls } = run('deploy.sh', { STUB_FAIL: 'backup' });
    expect(status).toBe(1);
    expect(output).toContain('Не удалось создать резервную копию');
    expect(calls.map((c) => c.split(' ')[0] + ' ' + c.split(' ')[1])).toEqual([
      'ssh preflight',
      'ssh backup',
    ]);
  });

  it('нет папки сайта на сервере — остановка до резервной копии', () => {
    const { status, output, calls } = run('deploy.sh', { STUB_PREFLIGHT: 'no-dir' });
    expect(status).toBe(1);
    expect(output).toContain('нет папки сайта');
    expect(calls).toEqual(['ssh preflight']);
  });

  it('папка сайта — символическая ссылка — остановка', () => {
    const { status, calls } = run('deploy.sh', { STUB_PREFLIGHT: 'symlink' });
    expect(status).toBe(1);
    expect(calls).toEqual(['ssh preflight']);
  });

  it('неполная сборка — остановка до подключения к серверу', () => {
    const { status, calls } = run('deploy.sh', { DIST_DIR: join(root, 'нет-такой-папки') });
    expect(status).toBe(1);
    expect(calls).toEqual([]);
  });

  it('без rsync на сервере — три прохода SFTP после резервной копии, удаление только в последнем', () => {
    const { status, calls, output } = run('deploy.sh', { STUB_PREFLIGHT: 'none' });
    expect(status, output).toBe(0);
    expect(output).toContain('Способ копирования: sftp');
    expect(calls[1]).toMatch(/^ssh backup /);
    const passes = calls.slice(2);
    expect(passes).toHaveLength(3);
    for (const pass of passes) {
      expect(pass).toMatch(/^lftp /);
      expect(pass).toContain('set xfer:use-temp-file yes');
    }
    expect(passes[0]).toContain('--exclude-glob *.html');
    expect(passes[0]).not.toContain('--delete');
    expect(passes[1]).not.toContain('--exclude-glob *.html');
    expect(passes[1]).not.toContain('--delete');
    expect(passes[2]).toContain('--delete');
  });

  it('обрыв rsync — ошибка с подсказкой запустить ещё раз', () => {
    const { status, output } = run('deploy.sh', { STUB_FAIL: 'rsync' });
    expect(status).toBe(1);
    expect(output).toContain('Прежние файлы сайта не тронуты');
  });

  it('DEPLOY_METHOD=rsync без rsync на сервере — остановка до резервной копии', () => {
    const { status, calls } = run('deploy.sh', { STUB_PREFLIGHT: 'none', DEPLOY_METHOD: 'rsync' });
    expect(status).toBe(1);
    expect(calls).toEqual(['ssh preflight']);
  });

  it('ключ и адрес сервера не выводятся', () => {
    const { output } = run('deploy.sh');
    expect(output).not.toContain(KEY);
    expect(output).not.toContain('192.0.2.10');
  });
});

describe('восстановление', () => {
  const NAME_OLD = 'konturix-20261101-100000-abc1234.tar.gz';
  const NAME_NEW = 'konturix-20261102-100000-def5678.tar.gz';
  const LIST = `${NAME_NEW} 100\n${NAME_OLD} 90`;

  function archive(name, build) {
    const dir = mkdtempSync(join(root, 'archive-'));
    build(dir);
    const file = join(root, name);
    // Как на сервере: tar -C <родитель> <папки> — записи без «./» в начале.
    const tar = spawnSync('tar', ['-czf', file, '-C', dir, ...readdirSync(dir)], {
      encoding: 'utf8',
    });
    expect(tar.status, tar.stderr).toBe(0);
    return file;
  }
  // Обычная копия: папка konturix.ru с главной страницей.
  function goodArchive() {
    return archive('good.tar.gz', (dir) => {
      mkdirSync(join(dir, 'konturix.ru', 'kalkulyatory'), { recursive: true });
      writeFileSync(join(dir, 'konturix.ru', 'index.html'), 'old\n');
    });
  }

  it.each([
    'konturix-1.tar.gz',
    '../konturix-20261101-100000-abc1234.tar.gz',
    'konturix-20261101-100000-abc1234.tar.gz;rm -rf ~',
    'konturix-20261101-100000-ABC.tar.gz',
    'latest ',
    '',
  ])('недопустимое имя копии %j — отказ до подключения', (name) => {
    const { status, calls } = run('restore.sh', { RESTORE_BACKUP: name || 'x' });
    expect(status).toBe(1);
    expect(calls).toEqual([]);
  });

  it('list — только список, ничего не меняется', () => {
    const { status, output, calls } = run('restore.sh', {
      RESTORE_BACKUP: 'list',
      STUB_LIST: LIST,
    });
    expect(status).toBe(0);
    expect(output).toContain(NAME_NEW);
    expect(calls).toEqual(['ssh preflight', 'ssh list']);
  });

  it('latest — последняя копия; копия текущего состояния до копирования', () => {
    const { status, calls, output } = run('restore.sh', {
      RESTORE_BACKUP: 'latest',
      STUB_LIST: LIST,
      STUB_ARCHIVE: goodArchive(),
    });
    expect(status, output).toBe(0);
    expect(calls[2]).toBe(`ssh cat ${NAME_NEW}`);
    expect(calls[3]).toMatch(/^ssh backup konturix-\d{8}-\d{6}-restore\.tar\.gz$/);
    expect(calls[4]).toMatch(/^rsync .*--delete-delay --delay-updates/);
  });

  it('копия по имени; копии с таким именем нет — отказ', () => {
    const ok = run('restore.sh', {
      RESTORE_BACKUP: NAME_OLD,
      STUB_LIST: LIST,
      STUB_ARCHIVE: goodArchive(),
    });
    expect(ok.status, ok.output).toBe(0);
    expect(ok.calls[2]).toBe(`ssh cat ${NAME_OLD}`);
    const missing = run('restore.sh', {
      RESTORE_BACKUP: 'konturix-20250101-000000-abc.tar.gz',
      STUB_LIST: LIST,
    });
    expect(missing.status).toBe(1);
    expect(missing.calls).toEqual(['ssh preflight', 'ssh list']);
  });

  it.each([
    [
      'файл вне папки сайта',
      (dir) => {
        mkdirSync(join(dir, 'konturix.ru'));
        writeFileSync(join(dir, 'evil.txt'), 'x');
      },
    ],
    [
      'символическая ссылка',
      (dir) => {
        mkdirSync(join(dir, 'konturix.ru'));
        spawnSync('ln', ['-s', '/etc/passwd', join(dir, 'konturix.ru', 'link')]);
      },
    ],
    ['пустой архив без папки сайта', (dir) => writeFileSync(join(dir, 'other'), 'x')],
  ])('опасная копия (%s) — отказ до резервной копии и копирования', (_label, build) => {
    const { status, calls } = run('restore.sh', {
      RESTORE_BACKUP: 'latest',
      STUB_LIST: LIST,
      STUB_ARCHIVE: archive('bad.tar.gz', build),
    });
    expect(status).toBe(1);
    expect(
      calls.some(
        (c) => c.startsWith('ssh backup') || c.startsWith('rsync') || c.startsWith('lftp'),
      ),
    ).toBe(false);
  });

  it('путь с «..» в копии — отказ', () => {
    const dir = mkdtempSync(join(root, 'dots-'));
    mkdirSync(join(dir, 'konturix.ru'));
    writeFileSync(join(dir, 'evil'), 'x');
    const file = join(root, 'dots.tar.gz');
    // Запись «konturix.ru/../evil»: путь в архиве задаётся через --transform.
    const tar = spawnSync(
      'tar',
      ['-czf', file, '-C', dir, '--transform', 's,^evil$,konturix.ru/../evil,', 'evil'],
      {
        encoding: 'utf8',
      },
    );
    expect(tar.status, tar.stderr).toBe(0);
    const { status, calls } = run('restore.sh', {
      RESTORE_BACKUP: 'latest',
      STUB_LIST: LIST,
      STUB_ARCHIVE: file,
    });
    expect(status).toBe(1);
    expect(calls.some((c) => c.startsWith('ssh backup'))).toBe(false);
  });

  it('нет резервных копий — отказ', () => {
    const { status, calls } = run('restore.sh', { RESTORE_BACKUP: 'latest' });
    expect(status).toBe(1);
    expect(calls).toEqual(['ssh preflight', 'ssh list']);
  });

  it('копия текущего состояния не создалась — восстановление остановлено', () => {
    const { status, calls } = run('restore.sh', {
      RESTORE_BACKUP: 'latest',
      STUB_LIST: LIST,
      STUB_ARCHIVE: goodArchive(),
      STUB_FAIL: 'backup',
    });
    expect(status).toBe(1);
    expect(calls.some((c) => c.startsWith('rsync'))).toBe(false);
  });
});

describe('проверка ответа сайта (check-site.sh)', () => {
  let server;
  let url = '';
  let response = { status: 200, body: 'новая\n' };

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(response.status, { 'Content-Type': 'text/html' });
      res.end(response.body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // Асинхронно: сервер работает в этом же процессе.
  function check(expected, siteUrl = url) {
    return new Promise((resolve) => {
      const child = spawn('bash', [join(scripts, 'check-site.sh'), expected], {
        env: { PATH: process.env.PATH, SITE_URL: siteUrl, CHECK_ATTEMPTS: '2', CHECK_DELAY: '0' },
      });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      child.on('close', (status) => resolve({ status, output }));
    });
  }
  const expectedFile = () => {
    const file = join(root, 'expected-index.html');
    writeFileSync(file, 'новая\n');
    return file;
  };

  it('200 и та же главная страница — успех', async () => {
    response = { status: 200, body: 'новая\n' };
    const { status, output } = await check(expectedFile());
    expect(status, output).toBe(0);
    expect(output).toContain('отдаётся ожидаемая версия');
  });

  it('200, но другая страница (заглушка, старая версия) — ошибка', async () => {
    response = { status: 200, body: '<h1>Сайт скоро откроется</h1>' };
    const { status, output } = await check(expectedFile());
    expect(status).toBe(1);
    expect(output).toContain('отдаёт не ту главную страницу');
  });

  it('500 — ошибка с кодом ответа', async () => {
    response = { status: 500, body: 'новая\n' };
    const { status, output } = await check(expectedFile());
    expect(status).toBe(1);
    expect(output).toContain('ответила 500');
  });

  it('сервер недоступен — ошибка, а не обрыв шага', async () => {
    const { status, output } = await check(expectedFile(), 'http://127.0.0.1:1');
    expect(status).toBe(1);
    expect(output).toContain('ответила 000');
  });

  it('нет файла для сравнения — предупреждение, без ошибки', async () => {
    const { status, output } = await check(join(root, 'нет-файла.html'));
    expect(status).toBe(0);
    expect(output).toContain('::warning::');
  });
});
