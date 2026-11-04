// Сценарий на сервере (REMOTE_SCRIPT из scripts/deploy-lib.sh) — тот же POSIX sh, что выполняется на хостинге,
// но на временных папках и с подменённой командой sha256sum: нет команды, ошибка, пустой или неверный результат,
// ошибка только на файлах сайта. Защита копий и статуса verified не должна отключаться молча (D-035).
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const TOKEN = 'abcdef0123456789';
let root = '';
let script = '';
let site = '';
let backups = '';
const paths = {};

// Подмены sha256sum. Каждая папка идёт в PATH первой.
const FAKES = {
  // Завершается ошибкой.
  failing: '#!/bin/sh\ncat >/dev/null\nexit 1\n',
  // Ничего не выводит, но «успешно».
  empty: '#!/bin/sh\ncat >/dev/null\nexit 0\n',
  // Выводит не хеш.
  garbage: '#!/bin/sh\ncat >/dev/null\necho "zzzz  -"\n',
  // Хеш правильного вида, но неверный (одни нули) — самопроверка на «abc» это ловит.
  wrong: `#!/bin/sh\ncat >/dev/null\necho "${'0'.repeat(64)}  -"\n`,
  // Самопроверку проходит, а на файлах сайта падает — ошибка во время вычисления отпечатка.
  'files-fail': `#!/bin/sh\nin=$(cat)\nif [ "$in" = abc ]; then echo "${ABC}  -"; else exit 1; fi\n`,
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'deploy-remote-'));
  script = spawnSync('bash', ['-c', 'source scripts/deploy-lib.sh; printf "%s" "$REMOTE_SCRIPT"'], {
    encoding: 'utf8',
  }).stdout;
  expect(script).toContain('sha_works');
  // PATH без sha256sum: только команды, нужные сценарию.
  const nosha = join(root, 'nosha');
  mkdirSync(nosha);
  for (const tool of [
    'sh',
    'ls',
    'grep',
    'sort',
    'tail',
    'head',
    'find',
    'cut',
    'mkdir',
    'chmod',
  ].concat(['mv', 'rm', 'tar', 'gzip', 'wc', 'cat'])) {
    const real = spawnSync('bash', ['-c', `command -v ${tool}`], {
      encoding: 'utf8',
    }).stdout.trim();
    symlinkSync(real, join(nosha, tool));
  }
  paths.missing = nosha;
  paths.real = process.env.PATH;
  for (const [name, body] of Object.entries(FAKES)) {
    const dir = join(root, `fake-${name}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'sha256sum'), body);
    chmodSync(join(dir, 'sha256sum'), 0o755);
    paths[name] = `${dir}:${process.env.PATH}`;
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  const dir = mkdtempSync(join(root, 'case-'));
  site = join(dir, 'www', 'konturix.ru');
  backups = join(dir, 'konturix-backups');
  mkdirSync(join(site, '_astro'), { recursive: true });
  writeFileSync(join(site, 'index.html'), 'главная v1\n');
  writeFileSync(join(site, '_astro', 'app.css'), 'body{}\n');
});

function remote(path, ...args) {
  const r = spawnSync('sh', ['-s', '--', site, backups, '5', ...args], {
    input: script,
    encoding: 'utf8',
    env: { PATH: paths[path] },
  });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}
const archives = () =>
  existsSync(backups) ? readdirSync(backups).filter((f) => /^konturix-.*\.tar\.gz$/.test(f)) : [];
const state = () => readFileSync(join(backups, '.site-state'), 'utf8').trim().split(' ');
const name = (n) => `konturix-20261101-1000${String(n).padStart(2, '0')}-test.tar.gz`;

const BROKEN = ['missing', 'failing', 'empty', 'garbage', 'wrong'];

describe('sha256sum на сервере', () => {
  it('настоящая sha256sum — проверка перед копией проходит', () => {
    expect(remote('real', 'preflight').out).toMatch(/^(rsync|none)$/);
  });

  it.each(BROKEN)('%s: проверка перед копией — no-sha256sum', (kind) => {
    expect(remote(kind, 'preflight')).toMatchObject({ status: 0, out: 'no-sha256sum' });
  });

  it.each([...BROKEN, 'files-fail'])(
    '%s: резервная копия — код 6, архива и отпечатка нет',
    (kind) => {
      const r = remote(kind, 'backup', name(1));
      expect(r.status).toBe(6);
      expect(r.err).toMatch(/sha256sum/);
      expect(archives()).toEqual([]);
      expect(
        readdirSync(backups).filter((f) => f.endsWith('.sum') || f.startsWith('.fp-')),
      ).toEqual([]);
    },
  );

  it('ошибка на файлах сайта (самопроверка прошла) — понятное сообщение', () => {
    expect(remote('files-fail', 'backup', name(1)).err).toContain('не смогла вычислить хеш файла');
  });

  it.each([...BROKEN, 'files-fail'])('%s: finish — код 6, статус остаётся copying', (kind) => {
    expect(remote('real', 'begin', TOKEN).status).toBe(0);
    const r = remote(kind, 'finish', TOKEN, 'keep-all');
    expect(r.status).toBe(6);
    expect(state()[0]).toBe('copying');
  });

  it.each([...BROKEN, 'files-fail'])('%s: verify — код 6, статус остаётся copied', (kind) => {
    remote('real', 'begin', TOKEN);
    expect(remote('real', 'finish', TOKEN, 'keep-all').status).toBe(0);
    const r = remote(kind, 'verify', TOKEN);
    expect(r.status).toBe(6);
    expect(state()[0]).toBe('copied');
  });

  it('verify без отпечатка в статусе (старый формат «-») — отказ', () => {
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, '.site-state'), `copied ${TOKEN} -\n`);
    expect(remote('real', 'verify', TOKEN).status).toBe(5);
    expect(state()[0]).toBe('copied');
  });
});

describe('отпечаток содержимого', () => {
  it('отпечаток — 64 шестнадцатеричных знака', () => {
    remote('real', 'backup', name(1));
    expect(readFileSync(join(backups, `${archives()[0]}.sum`), 'utf8').trim()).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('одинаковое содержимое — тот же отпечаток, копия не создаётся повторно', () => {
    expect(remote('real', 'backup', name(1)).out).toMatch(/ new no$/);
    const again = remote('real', 'backup', name(2));
    expect(again.out).toMatch(/ reused no$/);
    expect(archives()).toHaveLength(1);
  });

  it('разное содержимое того же размера — разные отпечатки, новая копия', () => {
    remote('real', 'backup', name(1));
    writeFileSync(join(site, 'index.html'), 'главная v2\n'); // тот же размер, другие байты
    expect(remote('real', 'backup', name(2)).out).toMatch(/ new no$/);
    const [first, second] = readdirSync(backups)
      .filter((f) => f.endsWith('.sum'))
      .sort();
    expect(readFileSync(join(backups, first), 'utf8')).not.toBe(
      readFileSync(join(backups, second), 'utf8'),
    );
  });

  it('переименование файла без изменения содержимого — другой отпечаток', () => {
    remote('real', 'backup', name(1));
    spawnSync('mv', [join(site, '_astro', 'app.css'), join(site, '_astro', 'app2.css')]);
    expect(remote('real', 'backup', name(2)).out).toMatch(/ new no$/);
  });

  it('повторное вычисление: та же папка в другом каталоге копий — тот же отпечаток', () => {
    remote('real', 'backup', name(1));
    const first = readFileSync(
      join(
        backups,
        readdirSync(backups).find((f) => f.endsWith('.sum')),
      ),
      'utf8',
    );
    backups = `${backups}-2`;
    remote('real', 'backup', name(1));
    const second = readFileSync(
      join(
        backups,
        readdirSync(backups).find((f) => f.endsWith('.sum')),
      ),
      'utf8',
    );
    expect(second).toBe(first);
  });

  it('.well-known не влияет на отпечаток (её меняет хостинг)', () => {
    remote('real', 'backup', name(1));
    mkdirSync(join(site, '.well-known'));
    writeFileSync(join(site, '.well-known', 'token'), 'acme');
    expect(remote('real', 'backup', name(2)).out).toMatch(/ reused /);
  });

  it('испорченный .sum у самой новой копии — не повод считать копию той же', () => {
    remote('real', 'backup', name(1));
    writeFileSync(join(backups, `${archives()[0]}.sum`), 'испорчено\n');
    expect(remote('real', 'backup', name(2)).out).toMatch(/ new /);
  });

  it('проверенная версия: verified ставится только при том же отпечатке, копия после — проверенная', () => {
    remote('real', 'begin', TOKEN);
    remote('real', 'finish', TOKEN, 'keep-all');
    expect(remote('real', 'verify', TOKEN).status).toBe(0);
    expect(state()[0]).toBe('verified');
    const made = remote('real', 'backup', name(5)).out;
    expect(made).toMatch(/ yes$/);
    const madeName = made.split(' ')[0];
    expect(readFileSync(join(backups, `${madeName}.sum`), 'utf8').trim()).toBe(state()[2]);
    expect(existsSync(join(backups, `${madeName}.verified`))).toBe(true);
  });

  it('файлы изменились между finish и verify — verified не ставится', () => {
    remote('real', 'begin', TOKEN);
    remote('real', 'finish', TOKEN, 'keep-all');
    writeFileSync(join(site, 'index.html'), 'подменено\n');
    expect(remote('real', 'verify', TOKEN).status).toBe(5);
    expect(state()[0]).toBe('copied');
  });
});
