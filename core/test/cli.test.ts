import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { project } from './helpers.ts';

const CLI = resolve(import.meta.dirname, '..', 'src', 'cli.ts');

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function makeDataDir(
  t: { after(fn: () => void): void },
  projects: ReturnType<typeof project>[],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'tamer-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'plans'), { recursive: true });
  writeFileSync(
    join(dir, 'pool.json'),
    `${JSON.stringify({ version: 1, projects }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'ideas.json'),
    `${JSON.stringify({ version: 1, ideas: [] }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

function seedProjects() {
  return [
    project({
      id: 'microwave',
      title: '微波技术',
      deadline: '2026-10-26',
      note: '复习',
    }),
    project({
      id: 'netsec',
      title: '通信网与网络安全',
      last_touched: '2026-10-20',
      note: '读一章',
    }),
    project({
      id: 'ml',
      title: '机器学习',
      last_touched: '2026-10-19',
      note: '跑模型',
    }),
    project({
      id: 'htb-box',
      title: 'HTB 靶机',
      kind: 'side',
      progress: 0.4,
      last_touched: '2026-10-21',
      note: '打靶',
    }),
    project({
      id: 'notion-migrate',
      title: 'Notion→Obsidian 迁移',
      kind: 'side',
      status: 'shelved',
      wake_at: '2026-10-27',
      note: '迁移',
    }),
  ];
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

function readPlanFile(dataDir: string, date: string) {
  return JSON.parse(
    readFileSync(join(dataDir, 'plans', `${date}.json`), 'utf8'),
  );
}

test('CLI plan new emits the morning message and writes the plan', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const created = run(dir, [
    'plan',
    'new',
    '--date',
    '2026-10-23',
    '--now',
    '08:00',
  ]);
  assert.equal(created.status, 0);
  assert.match(created.stdout, /^早。今天三块：\n/);
  assert.match(created.stdout, /主线一 —— 《微波技术》/);
  assert.match(created.stdout, /主线二 —— 《微波技术》/);
  assert.match(created.stdout, /支线 —— 《HTB 靶机》/);
  assert.match(created.stdout, /搁置中：Notion→Obsidian 迁移（10-27 唤醒）/);
  assert.match(created.stdout, /今天不要做：换笔记软件 \/ 开新项目/);

  const plan = readPlanFile(dir, '2026-10-23');
  assert.deepEqual(
    plan.blocks.map((block: { project_id: string }) => block.project_id),
    ['microwave', 'microwave', 'htb-box'],
  );
  assert.equal(plan.result, null);

  const rendered = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-23',
    '--now',
    '08:00',
  ]);
  assert.equal(rendered.status, 0);
  assert.equal(rendered.stdout, created.stdout);
});

test('CLI plan new may regenerate a plan without a result', (t) => {
  const dir = makeDataDir(t, seedProjects());
  assert.equal(run(dir, ['plan', 'new', '--date', '2026-10-23']).status, 0);
  assert.equal(run(dir, ['plan', 'new', '--date', '2026-10-23']).status, 0);
});

test('CLI plan show prints the plan JSON', (t) => {
  const dir = makeDataDir(t, seedProjects());
  run(dir, ['plan', 'new', '--date', '2026-10-23']);
  const shown = run(dir, ['plan', 'show', '--date', '2026-10-23']);
  assert.equal(shown.status, 0);
  assert.deepEqual(JSON.parse(shown.stdout), readPlanFile(dir, '2026-10-23'));
});

test('CLI evening render asks exactly one question', (t) => {
  const dir = makeDataDir(t, seedProjects());
  run(dir, ['plan', 'new', '--date', '2026-10-23']);

  const step1 = run(dir, [
    'plan',
    'render',
    '--evening',
    '--step',
    '1',
    '--date',
    '2026-10-23',
  ]);
  assert.equal(step1.status, 0);
  assert.equal(step1.stdout, '今天三块里，哪块真做了？\n');

  const step2 = run(dir, [
    'plan',
    'render',
    '--evening',
    '--step',
    '2',
    '--date',
    '2026-10-23',
  ]);
  assert.equal(step2.status, 0);
  assert.equal(
    step2.stdout,
    '没做的那块断在哪，下一块的第一个动作是什么？\n',
  );
});

test('CLI plan new refuses to overwrite a plan with a result (exit 2)', (t) => {
  const dir = makeDataDir(t, seedProjects());
  run(dir, ['plan', 'new', '--date', '2026-10-23']);

  const review = run(dir, [
    'plan',
    'review',
    '--date',
    '2026-10-23',
    '--block',
    '1',
    '--done',
    '--note',
    '做完了',
    '--at',
    '2026-10-23T21:30:00+08:00',
  ]);
  assert.equal(review.status, 0);

  const reviewed = readPlanFile(dir, '2026-10-23');
  assert.equal(reviewed.result.reviewed_at, '2026-10-23T21:30:00+08:00');
  assert.deepEqual(reviewed.result.blocks[0], {
    project_id: 'microwave',
    done: true,
    note: '做完了',
  });
  assert.equal(reviewed.result.blocks[1].done, false);

  const refused = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /拒绝覆盖/);

  const unchanged = readPlanFile(dir, '2026-10-23');
  assert.deepEqual(unchanged.result, reviewed.result);
});

test('CLI exception day has no blocks and empty renders', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const created = run(dir, [
    'plan',
    'new',
    '--date',
    '2026-10-24',
    '--day-type',
    'exception',
  ]);
  assert.equal(created.status, 0);
  assert.equal(created.stdout, '');

  const plan = readPlanFile(dir, '2026-10-24');
  assert.equal(plan.day_type, 'exception');
  assert.deepEqual(plan.blocks, []);

  const morning = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-24',
  ]);
  assert.equal(morning.status, 0);
  assert.equal(morning.stdout, '');

  const review = run(dir, [
    'plan',
    'review',
    '--date',
    '2026-10-24',
    '--block',
    '1',
    '--done',
  ]);
  assert.equal(review.status, 1);
});

test('CLI idea add is deterministic and repeats increment occurrences', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const first = run(dir, [
    'idea',
    'add',
    '想试试 nvim',
    '--date',
    '2026-10-22',
  ]);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /idea-20261022-1/);

  let book = JSON.parse(
    readFileSync(join(dir, 'ideas.json'), 'utf8'),
  );
  assert.equal(book.ideas.length, 1);
  assert.equal(book.ideas[0].state, 'graveyard');
  assert.equal(book.ideas[0].occurrences, 1);
  assert.equal(book.ideas[0].captured_at, '2026-10-22');

  const second = run(dir, [
    'idea',
    'add',
    '想试试 nvim',
    '--same',
    'idea-20261022-1',
    '--date',
    '2026-10-22',
  ]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /第 2 次/);

  book = JSON.parse(readFileSync(join(dir, 'ideas.json'), 'utf8'));
  assert.equal(book.ideas.length, 1);
  assert.equal(book.ideas[0].occurrences, 2);

  const listed = run(dir, ['idea', 'list']);
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /\[graveyard\] 想试试 nvim/);
});

test('CLI R2 reads consecutive days from plan files', (t) => {
  const dir = makeDataDir(t, seedProjects());

  for (const date of ['2026-10-22', '2026-10-23', '2026-10-24']) {
    const result = run(dir, ['plan', 'new', '--date', date]);
    assert.equal(result.status, 0);
  }

  const day22 = readPlanFile(dir, '2026-10-22');
  const day23 = readPlanFile(dir, '2026-10-23');
  const day24 = readPlanFile(dir, '2026-10-24');

  assert.deepEqual(
    day22.blocks.map((block: { project_id: string }) => block.project_id),
    ['microwave', 'microwave', 'htb-box'],
  );
  assert.deepEqual(
    day23.blocks.map((block: { project_id: string }) => block.project_id),
    ['microwave', 'microwave', 'htb-box'],
  );
  assert.deepEqual(
    day24.blocks.map((block: { project_id: string }) => block.project_id),
    ['ml', 'netsec'],
  );
});

test('CLI plan new applies per-block action and done-when, whole copy as fallback', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const created = run(dir, [
    'plan',
    'new',
    '--date',
    '2026-10-23',
    '--now',
    '08:00',
    '--action',
    '整体动作',
    '--action',
    'microwave#2=第二块动作',
    '--done-when',
    'microwave#2=第二块标准',
  ]);
  assert.equal(created.status, 0);
  assert.match(created.stdout, /主线一 —— 《微波技术》下一步：整体动作/);
  assert.match(created.stdout, /主线二 —— 《微波技术》下一步：第二块动作/);

  const plan = readPlanFile(dir, '2026-10-23');
  assert.equal(plan.blocks[0].action, '整体动作');
  assert.equal(plan.blocks[1].action, '第二块动作');
  assert.equal(plan.blocks[1].done_when, '第二块标准');
});

test('CLI plan new lets per-block copy win over the whole --action', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const created = run(dir, [
    'plan',
    'new',
    '--date',
    '2026-10-23',
    '--action',
    '整体动作',
    '--action',
    'microwave#1=第一块专用',
  ]);
  assert.equal(created.status, 0);
  const plan = readPlanFile(dir, '2026-10-23');
  assert.equal(plan.blocks[0].action, '第一块专用');
  assert.equal(plan.blocks[1].action, '接着上一块往下做，收手前留一句断点');
});

test('CLI plan new renders the repeated project with two distinct lines', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const created = run(dir, [
    'plan',
    'new',
    '--date',
    '2026-10-23',
    '--now',
    '08:00',
  ]);
  assert.equal(created.status, 0);
  const lines = created.stdout
    .split('\n')
    .filter((line) => line.startsWith('**'));
  assert.equal(lines.length, 3);
  assert.notEqual(lines[0], lines[1]);
});

test('CLI --now marks elapsed blocks, all-elapsed, and rejects bad times', (t) => {
  const dir = makeDataDir(t, seedProjects());
  run(dir, ['plan', 'new', '--date', '2026-10-23', '--now', '08:00']);

  const partial = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-23',
    '--now',
    '10:30',
  ]);
  assert.equal(partial.status, 0);
  assert.match(partial.stdout, /^现在 10:30，前 1 块已过。\n\n/);
  assert.doesNotMatch(partial.stdout, /09:00–10:30/);
  assert.match(partial.stdout, /14:00–15:00/);

  const all = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-23',
    '--now',
    '15:00',
  ]);
  assert.equal(all.status, 0);
  assert.equal(all.stdout, '现在 15:00，今天三块都过了。\n');

  const invalid = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-23',
    '--now',
    '9:00',
  ]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /无效的时间/);
});

test('CLI rejects an impossible date with exit 1', (t) => {
  const dir = makeDataDir(t, seedProjects());
  const result = run(dir, ['plan', 'new', '--date', '2026-02-30']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /无效日期/);
});
