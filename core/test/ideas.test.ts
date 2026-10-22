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
import {
  addIdea,
  discardIdea,
  dueIdeas,
  filterIdeas,
  markIdeaWake,
  promoteIdea,
  resolveWakeAt,
} from '../src/ideas.ts';
import { buildPlan } from '../src/plan.ts';
import { renderMorning } from '../src/render.ts';
import type { Idea, IdeaBook, Pool, Project } from '../src/types.ts';
import { project } from './helpers.ts';

function idea(overrides: Partial<Idea> & { id: string }): Idea {
  return {
    text: `text-${overrides.id}`,
    captured_at: '2026-10-01',
    state: 'graveyard',
    occurrences: 1,
    wake_at: null,
    reason: null,
    ...overrides,
  };
}

function book(ideas: Idea[]): IdeaBook {
  return { version: 1, ideas };
}

function poolOf(projects: Project[]): Pool {
  return { version: 1, projects };
}

test('R8: --same increments occurrences and never rewrites text or captured_at', () => {
  let current = book([]);
  const first = addIdea(current, '想试试 nvim', '2026-10-22');
  current = first.book;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const again = addIdea(current, '换一种说法', '2026-10-23', {
      sameId: first.idea.id,
    });
    assert.equal(again.added, false);
    current = again.book;
  }

  assert.equal(current.ideas.length, 1);
  assert.equal(current.ideas[0].id, 'idea-20261022-1');
  assert.equal(current.ideas[0].occurrences, 3);
  assert.equal(current.ideas[0].text, '想试试 nvim');
  assert.equal(current.ideas[0].captured_at, '2026-10-22');
});

test('idea add without --same always creates a new idea with occurrences 1', () => {
  let current = book([]);
  current = addIdea(current, '重复出现', '2026-10-22').book;
  current = addIdea(current, '重复出现', '2026-10-22').book;

  assert.deepEqual(
    current.ideas.map((entry) => entry.id),
    ['idea-20261022-1', 'idea-20261022-2'],
  );
  assert.deepEqual(
    current.ideas.map((entry) => entry.occurrences),
    [1, 1],
  );
});

test('R10: due is state=wake with wake_at <= today, boundary included', () => {
  const current = book([
    idea({ id: 'past', state: 'wake', wake_at: '2026-10-15' }),
    idea({ id: 'today', state: 'wake', wake_at: '2026-10-22' }),
    idea({ id: 'future', state: 'wake', wake_at: '2026-10-23' }),
    idea({ id: 'graveyard', state: 'graveyard', wake_at: '2026-10-01' }),
    idea({ id: 'nowake', state: 'wake', wake_at: null }),
  ]);

  assert.deepEqual(
    dueIdeas(current, '2026-10-22').map((entry) => entry.id),
    ['past', 'today'],
  );
  assert.deepEqual(
    filterIdeas(current, { due: true, today: '2026-10-22' }).map(
      (entry) => entry.id,
    ),
    ['past', 'today'],
  );
  assert.deepEqual(
    filterIdeas(current, { state: 'graveyard' }).map((entry) => entry.id),
    ['graveyard'],
  );
});

test('resolveWakeAt turns 7/30 into day offsets and keeps absolute dates', () => {
  assert.equal(resolveWakeAt('7', '2026-10-22'), '2026-10-29');
  assert.equal(resolveWakeAt('30', '2026-10-22'), '2026-11-21');
  assert.equal(resolveWakeAt('2026-11-01', '2026-10-22'), '2026-11-01');
  assert.throws(() => resolveWakeAt('soon', '2026-10-22'), /无效的 --wake/);
});

test('R9: main and side both cap at two active projects', () => {
  const current = book([
    idea({ id: 'idea-20261022-1', occurrences: 3 }),
  ]);

  const fullMain = poolOf([
    project({ id: 'm1' }),
    project({ id: 'm2' }),
    project({ id: 's1', kind: 'side', status: 'paused' }),
  ]);
  const main = promoteIdea(current, fullMain, 'idea-20261022-1', {
    kind: 'main',
    today: '2026-10-22',
  });
  assert.equal(main.ok, false);
  if (!main.ok && main.reason === 'quota') {
    assert.equal(main.kind, 'main');
    assert.equal(main.active, 2);
    assert.equal(main.limit, 2);
  } else {
    assert.fail('expected a quota failure');
  }

  const room = poolOf([project({ id: 'm1' })]);
  assert.equal(
    promoteIdea(current, room, 'idea-20261022-1', {
      kind: 'main',
      today: '2026-10-22',
    }).ok,
    true,
  );

  const fullSide = poolOf([
    project({ id: 's1', kind: 'side' }),
    project({ id: 's2', kind: 'side' }),
  ]);
  const side = promoteIdea(current, fullSide, 'idea-20261022-1', {
    kind: 'side',
    today: '2026-10-22',
  });
  assert.equal(side.ok, false);
});

test('R11: illegal state transitions throw, legal ones update in place', () => {
  const promoted = book([idea({ id: 'p', state: 'promoted' })]);
  assert.throws(
    () => markIdeaWake(promoted, 'p', '2026-11-01'),
    /非法状态迁移/,
  );
  assert.throws(
    () => discardIdea(promoted, 'p', '不做了'),
    /非法状态迁移/,
  );

  const discarded = book([
    idea({ id: 'd', state: 'discarded', reason: '过时' }),
  ]);
  assert.throws(
    () => markIdeaWake(discarded, 'd', '2026-11-01'),
    /非法状态迁移/,
  );

  let current = book([idea({ id: 'g' })]);
  current = markIdeaWake(current, 'g', '2026-10-29').book;
  assert.equal(current.ideas[0].state, 'wake');
  assert.equal(current.ideas[0].wake_at, '2026-10-29');
  current = discardIdea(current, 'g', '过时了').book;
  assert.equal(current.ideas[0].state, 'discarded');
  assert.equal(current.ideas[0].reason, '过时了');
});

function morningPool(): Pool {
  return poolOf([
    project({
      id: 'microwave',
      title: '微波技术',
      deadline: '2026-10-26',
      note: '复习',
    }),
    project({
      id: 'htb-box',
      title: 'HTB 靶机',
      kind: 'side',
      progress: 0.4,
      last_touched: '2026-10-21',
      note: '打靶',
    }),
  ]);
}

test('renderMorning appends one due line at the end, at most three items', () => {
  const p = morningPool();
  const plan = buildPlan(p, '2026-10-23');
  const due = [
    idea({ id: 'a', text: '想试试 nvim', state: 'wake', wake_at: '2026-10-16' }),
    idea({ id: 'b', text: '第二条', state: 'wake', wake_at: '2026-10-22' }),
    idea({ id: 'c', text: '第三条', state: 'wake', wake_at: '2026-10-23' }),
    idea({ id: 'd', text: '第四条不显示', state: 'wake', wake_at: '2026-10-20' }),
  ];

  const text = renderMorning(plan, p, { due, today: '2026-10-23' });
  const lines = text.split('\n');
  assert.equal(
    lines[lines.length - 1],
    '到期唤醒：想试试 nvim（7 天前），第二条（1 天前），第三条（今天）',
  );
  assert.equal(text.includes('第四条不显示'), false);
  assert.ok(lines.length <= 10);
});

test('renderMorning without due items stays byte-identical to v0.02', () => {
  const p = morningPool();
  const plan = buildPlan(p, '2026-10-23');
  const base = renderMorning(plan, p);
  assert.equal(renderMorning(plan, p, { due: [], today: '2026-10-23' }), base);
  assert.equal(base.includes('到期唤醒'), false);
});

const CLI = resolve(import.meta.dirname, '..', 'src', 'cli.ts');

type RunResult = { status: number | null; stdout: string; stderr: string };

function makeDataDir(
  t: { after(fn: () => void): void },
  projects: Project[] = [],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'tamer-ideas-'));
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

function readIdeasFile(dataDir: string): IdeaBook {
  return JSON.parse(readFileSync(join(dataDir, 'ideas.json'), 'utf8'));
}

function readPoolFile(dataDir: string): Pool {
  return JSON.parse(readFileSync(join(dataDir, 'pool.json'), 'utf8'));
}

function addCaptured(dir: string, text: string): string {
  const first = run(dir, ['idea', 'add', text, '--date', '2026-10-22']);
  assert.equal(first.status, 0);
  const match = /idea-\d{8}-\d+/.exec(first.stdout);
  assert.notEqual(match, null);
  return (match as RegExpExecArray)[0];
}

function addThreeTimes(dir: string, text: string): string {
  const id = addCaptured(dir, text);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(
      run(dir, [
        'idea',
        'add',
        text,
        '--same',
        id,
        '--date',
        '2026-10-22',
      ]).status,
      0,
    );
  }
  return id;
}

function seedProjects(): Project[] {
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
      id: 'htb-box',
      title: 'HTB 靶机',
      kind: 'side',
      progress: 0.4,
      last_touched: '2026-10-21',
      note: '打靶',
    }),
  ];
}

test('CLI: --same three times then promote writes the project into pool.json', (t) => {
  const dir = makeDataDir(t);
  const id = addThreeTimes(dir, '想试试 nvim');

  const current = readIdeasFile(dir);
  assert.equal(current.ideas.length, 1);
  assert.equal(current.ideas[0].occurrences, 3);
  assert.equal(current.ideas[0].id, id);

  const promoted = run(dir, [
    'idea',
    'promote',
    id,
    '--date',
    '2026-10-22',
  ]);
  assert.equal(promoted.status, 0);

  const pool = readPoolFile(dir);
  assert.equal(pool.projects.length, 1);
  assert.deepEqual(
    {
      id: pool.projects[0].id,
      title: pool.projects[0].title,
      kind: pool.projects[0].kind,
      status: pool.projects[0].status,
    },
    {
      id,
      title: '想试试 nvim',
      kind: 'side',
      status: 'active',
    },
  );
  assert.equal(readIdeasFile(dir).ideas[0].state, 'promoted');
});

test('CLI: promoting after two captures exits 3 with 还差 1 次', (t) => {
  const dir = makeDataDir(t);
  const id = addCaptured(dir, '想试试 nvim');
  assert.equal(
    run(dir, ['idea', 'add', '想试试 nvim', '--same', id, '--date', '2026-10-22'])
      .status,
    0,
  );

  const promoted = run(dir, [
    'idea',
    'promote',
    id,
    '--date',
    '2026-10-22',
  ]);
  assert.equal(promoted.status, 3);
  assert.match(promoted.stderr, /还差 1 次才能升级/);
  assert.equal(readPoolFile(dir).projects.length, 0);
  assert.equal(readIdeasFile(dir).ideas[0].state, 'graveyard');
});

test('CLI: a full main quota exits 4 and leaves the idea untouched', (t) => {
  const dir = makeDataDir(t, [
    project({ id: 'main-a' }),
    project({ id: 'main-b' }),
  ]);
  const id = addThreeTimes(dir, '想试试 nvim');

  const promoted = run(dir, [
    'idea',
    'promote',
    id,
    '--kind',
    'main',
    '--date',
    '2026-10-22',
  ]);
  assert.equal(promoted.status, 4);
  assert.match(promoted.stderr, /名额已满/);
  assert.match(promoted.stderr, /discard/);
  assert.equal(readPoolFile(dir).projects.length, 2);
  assert.equal(readIdeasFile(dir).ideas[0].state, 'graveyard');
});

test('CLI: --wake 7 resolves against --date and enters state wake', (t) => {
  const dir = makeDataDir(t);
  const added = run(dir, [
    'idea',
    'add',
    '想试试 nvim',
    '--date',
    '2026-10-22',
    '--wake',
    '7',
  ]);
  assert.equal(added.status, 0);

  const current = readIdeasFile(dir).ideas[0];
  assert.equal(current.state, 'wake');
  assert.equal(current.wake_at, '2026-10-29');
});

test('CLI: idea list --due returns only due wake ideas', (t) => {
  const dir = makeDataDir(t);

  for (const [text, wake] of [
    ['已到期', '2026-10-10'],
    ['今天到期', '2026-10-20'],
    ['还没到', '2026-10-25'],
  ] as const) {
    assert.equal(
      run(dir, [
        'idea',
        'add',
        text,
        '--date',
        '2026-10-10',
        '--wake',
        wake,
      ]).status,
      0,
    );
  }
  assert.equal(
    run(dir, ['idea', 'add', '坟墓里的', '--date', '2026-10-10']).status,
    0,
  );

  const due = run(dir, ['idea', 'list', '--due', '--date', '2026-10-20']);
  assert.equal(due.status, 0);
  assert.match(due.stdout, /已到期/);
  assert.match(due.stdout, /今天到期/);
  assert.doesNotMatch(due.stdout, /还没到/);
  assert.doesNotMatch(due.stdout, /坟墓里的/);

  const waking = run(dir, [
    'idea',
    'list',
    '--state',
    'wake',
    '--date',
    '2026-10-20',
  ]);
  assert.match(waking.stdout, /还没到/);
  assert.doesNotMatch(waking.stdout, /坟墓里的/);

  const graveyard = run(dir, ['idea', 'list', '--state', 'graveyard']);
  assert.match(graveyard.stdout, /坟墓里的/);
  assert.doesNotMatch(graveyard.stdout, /已到期/);
});

test('CLI: a future wake leaves the morning message byte-identical', (t) => {
  const dir = makeDataDir(t, seedProjects());
  const created = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(created.status, 0);

  assert.equal(
    run(dir, [
      'idea',
      'add',
      '想试试 nvim',
      '--date',
      '2026-10-22',
      '--wake',
      '7',
    ]).status,
    0,
  );

  const rendered = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-23',
  ]);
  assert.equal(rendered.stdout, created.stdout);
  assert.doesNotMatch(rendered.stdout, /到期唤醒/);
});

test('CLI: a due idea appends 到期唤醒 to the morning message', (t) => {
  const dir = makeDataDir(t, seedProjects());
  assert.equal(
    run(dir, [
      'idea',
      'add',
      '想试试 nvim',
      '--date',
      '2026-10-10',
      '--wake',
      '2026-10-15',
    ]).status,
    0,
  );

  const created = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(created.status, 0);
  assert.ok(
    created.stdout.endsWith('到期唤醒：想试试 nvim（8 天前）\n'),
    created.stdout,
  );
  assert.ok(created.stdout.split('\n').length <= 10);

  const rendered = run(dir, [
    'plan',
    'render',
    '--morning',
    '--date',
    '2026-10-23',
  ]);
  assert.equal(rendered.stdout, created.stdout);
});

test('CLI: illegal idea transitions exit 1 and leave the book unchanged', (t) => {
  const dir = makeDataDir(t);
  const id = addThreeTimes(dir, '想试试 nvim');
  assert.equal(
    run(dir, ['idea', 'promote', id, '--date', '2026-10-22']).status,
    0,
  );

  const discarded = run(dir, [
    'idea',
    'discard',
    id,
    '--reason',
    '不做了',
  ]);
  assert.equal(discarded.status, 1);
  assert.match(discarded.stderr, /非法状态迁移/);
  assert.equal(readIdeasFile(dir).ideas[0].state, 'promoted');

  const woken = run(dir, ['idea', 'wake', id, '--at', '2026-11-01']);
  assert.equal(woken.status, 1);
  assert.match(woken.stderr, /非法状态迁移/);

  const other = addCaptured(dir, '另一个想法');
  assert.equal(
    run(dir, ['idea', 'discard', other, '--reason', '过时']).status,
    0,
  );
  const revived = run(dir, ['idea', 'wake', other, '--at', '2026-11-01']);
  assert.equal(revived.status, 1);
  assert.match(revived.stderr, /非法状态迁移/);
});
