import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '..', 'src', 'cli.ts');

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type TestContext = { after(fn: () => void): void };

const EMPTY_POOL = '{\n  "version": 1,\n  "projects": []\n}\n';
const EMPTY_IDEAS = '{\n  "version": 1,\n  "ideas": []\n}\n';

function emptyDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'tamer-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(dataDir: string, args: string[]): RunResult {
  const result = spawnSync(
    process.execPath,
    [CLI, ...args, '--data-dir', dataDir],
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('init creates both empty books in an empty data dir', (t) => {
  const dir = emptyDir(t);

  const result = run(dir, ['init']);
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(dir, 'pool.json'), 'utf8'), EMPTY_POOL);
  assert.equal(readFileSync(join(dir, 'ideas.json'), 'utf8'), EMPTY_IDEAS);
  assert.match(result.stdout, /已初始化：/);
  assert.match(result.stdout, /pool\.json/);
  assert.match(result.stdout, /ideas\.json/);
  assert.equal(result.stderr, '');
});

test('init never overwrites existing files and still exits 0', (t) => {
  const dir = emptyDir(t);
  const seeded = `${JSON.stringify(
    {
      version: 1,
      projects: [{ id: 'microwave', title: '微波技术', status: 'active' }],
    },
    null,
    2,
  )}\n`;
  writeFileSync(join(dir, 'pool.json'), seeded, 'utf8');

  const result = run(dir, ['init']);
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(dir, 'pool.json'), 'utf8'), seeded);
  assert.equal(readFileSync(join(dir, 'ideas.json'), 'utf8'), EMPTY_IDEAS);
  assert.match(result.stderr, /已存在，跳过：.*pool\.json/);
});

test('init skips a corrupt file instead of repairing or overwriting it', (t) => {
  const dir = emptyDir(t);
  writeFileSync(join(dir, 'pool.json'), '{', 'utf8');

  const result = run(dir, ['init']);
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(dir, 'pool.json'), 'utf8'), '{');
  assert.match(result.stderr, /已存在，跳过：.*pool\.json/);
  assert.equal(readFileSync(join(dir, 'ideas.json'), 'utf8'), EMPTY_IDEAS);
});

test('idea add works in an empty data dir and counts one occurrence', (t) => {
  const dir = emptyDir(t);

  const result = run(dir, [
    'idea',
    'add',
    '想试试 nvim',
    '--date',
    '2026-10-22',
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /idea-20261022-1/);

  const book = readJson(join(dir, 'ideas.json'));
  assert.equal(book.version, 1);
  assert.equal(book.ideas.length, 1);
  assert.equal(book.ideas[0].text, '想试试 nvim');
  assert.equal(book.ideas[0].captured_at, '2026-10-22');
  assert.equal(book.ideas[0].occurrences, 1);
});

test('plan new in an empty data dir fails with the init hint and writes nothing', (t) => {
  const dir = emptyDir(t);

  const result = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    '没有项目池。先跑：node core/src/cli.ts init\n',
  );
  assert.equal(existsSync(join(dir, 'pool.json')), false);
  assert.equal(existsSync(join(dir, 'plans')), false);
});

test('init then plan new produces a plan with zero or one block', (t) => {
  const dir = emptyDir(t);
  assert.equal(run(dir, ['init']).status, 0);

  const created = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(created.status, 0);

  const plan = readJson(join(dir, 'plans', '2026-10-23.json'));
  assert.equal(plan.day_type, 'normal');
  assert.ok(Array.isArray(plan.blocks));
  assert.ok(plan.blocks.length <= 1);
  assert.equal(created.stdout, '');
});

test('corrupt ideas.json makes idea add fail and leaves the file untouched', (t) => {
  const dir = emptyDir(t);
  writeFileSync(join(dir, 'ideas.json'), '{', 'utf8');

  const result = run(dir, ['idea', 'add', '想试试 nvim', '--date', '2026-10-22']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /无法解析 JSON/);
  assert.equal(readFileSync(join(dir, 'ideas.json'), 'utf8'), '{');
});

test('corrupt pool.json makes plan new fail and leaves the file untouched', (t) => {
  const dir = emptyDir(t);
  writeFileSync(join(dir, 'pool.json'), '{', 'utf8');

  const result = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /无法解析 JSON/);
  assert.equal(readFileSync(join(dir, 'pool.json'), 'utf8'), '{');
  assert.equal(existsSync(join(dir, 'plans')), false);
});

test('idea promote starts from an empty pool when pool.json is missing', (t) => {
  const dir = emptyDir(t);
  writeFileSync(
    join(dir, 'ideas.json'),
    `${JSON.stringify(
      {
        version: 1,
        ideas: [
          {
            id: 'idea-20261022-1',
            text: '想试试 nvim',
            captured_at: '2026-10-22',
            state: 'graveyard',
            occurrences: 3,
            wake_at: null,
            reason: null,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const result = run(dir, [
    'idea',
    'promote',
    'idea-20261022-1',
    '--next',
    '装好 nvim',
    '--kind',
    'main',
    '--date',
    '2026-10-22',
  ]);
  assert.equal(result.status, 0);

  const pool = readJson(join(dir, 'pool.json'));
  assert.equal(pool.projects.length, 1);
  assert.equal(pool.projects[0].id, 'idea-20261022-1');
  assert.equal(pool.projects[0].kind, 'main');
  assert.equal(pool.projects[0].next_action, '装好 nvim');
  assert.equal(readJson(join(dir, 'ideas.json')).ideas[0].state, 'promoted');
});

test('idea wake/discard read a missing ideas.json as empty, not as a read error', (t) => {
  const dir = emptyDir(t);

  const wake = run(dir, ['idea', 'wake', 'idea-x', '--at', '2026-10-30']);
  assert.equal(wake.status, 1);
  assert.match(wake.stderr, /没有找到想法/);
  assert.equal(existsSync(join(dir, 'ideas.json')), false);

  const discard = run(dir, ['idea', 'discard', 'idea-x', '--reason', '不想了']);
  assert.equal(discard.status, 1);
  assert.match(discard.stderr, /没有找到想法/);
  assert.equal(existsSync(join(dir, 'ideas.json')), false);
});

test('plan review/breakpoint never fabricate a missing plan', (t) => {
  const dir = emptyDir(t);

  const review = run(dir, [
    'plan',
    'review',
    '--date',
    '2026-10-23',
    '--block',
    '1',
    '--done',
  ]);
  assert.equal(review.status, 1);
  assert.match(review.stderr, /没有找到计划/);

  const breakpoint = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-23',
    '--block',
    '1',
    '--did',
    '看了一章',
    '--next',
    '做习题',
  ]);
  assert.equal(breakpoint.status, 1);
  assert.match(breakpoint.stderr, /没有找到计划/);

  assert.equal(existsSync(join(dir, 'plans')), false);
});
