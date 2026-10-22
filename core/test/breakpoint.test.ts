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
  REPEAT_ACTION,
  applyBreakpoint,
  buildPlan,
} from '../src/plan.ts';
import { r7Actions } from '../src/rules.ts';
import type { Breakpoint, Plan } from '../src/types.ts';
import { planOf, pool, project } from './helpers.ts';

const DATE = '2026-10-23';
const AT = '2026-10-22T21:40:00+08:00';

function bp(next: string, stuck: string | null = null): Breakpoint {
  return { at: AT, did: `做过：${next}`, stuck, next };
}

function withBreakpoint(
  plan: Plan,
  blockIndex: number,
  breakpoint: Breakpoint,
): Plan {
  const blocks = plan.blocks.map((candidate, index) =>
    index === blockIndex ? { ...candidate, breakpoint } : candidate,
  );
  return { ...plan, blocks };
}

function microwavePool() {
  return pool([
    project({
      id: 'microwave',
      title: '微波技术',
      deadline: '2026-10-26',
      note: '复习',
      next_action: '翻目录',
    }),
    project({
      id: 'htb-box',
      title: 'HTB 靶机',
      kind: 'side',
      progress: 0.4,
      last_touched: '2026-10-01',
      note: '打靶',
    }),
  ]);
}

test('R7: yesterday breakpoint becomes the first block action', () => {
  const p = microwavePool();
  const history = [
    withBreakpoint(
      planOf('2026-10-22', ['microwave']),
      0,
      bp('从边界条件那节重读'),
    ),
  ];

  const plan = buildPlan(p, DATE, { history });
  assert.equal(plan.blocks[0].project_id, 'microwave');
  assert.equal(plan.blocks[0].action, '从边界条件那节重读');
  // done_when deliberately keeps the old fallback chain.
  assert.equal(plan.blocks[0].done_when, '翻目录');
  // A project's second block on the same day still repeats instead.
  assert.equal(plan.blocks[1].project_id, 'microwave');
  assert.equal(plan.blocks[1].action, REPEAT_ACTION);
  assert.equal(r7Actions(p, DATE, history).get('microwave'), '从边界条件那节重读');
});

test('R7 priority: block override > breakpoint > next_action', () => {
  const p = microwavePool();
  const history = [
    withBreakpoint(
      planOf('2026-10-22', ['microwave']),
      0,
      bp('断点动作'),
    ),
  ];

  const overridden = buildPlan(p, DATE, {
    history,
    blockActions: { 'microwave#1': '显式覆盖' },
  });
  assert.equal(overridden.blocks[0].action, '显式覆盖');

  const firstBlockOverride = buildPlan(p, DATE, {
    history,
    actionOverride: '整体覆盖',
  });
  assert.equal(firstBlockOverride.blocks[0].action, '整体覆盖');

  const inherited = buildPlan(p, DATE, { history });
  assert.equal(inherited.blocks[0].action, '断点动作');

  const fallback = buildPlan(p, DATE);
  assert.equal(fallback.blocks[0].action, '翻目录');
});

test('R7 inherits from date-2 but ignores date-3', () => {
  const p = microwavePool();

  const twoDaysAgo = [
    withBreakpoint(
      planOf('2026-10-21', ['microwave']),
      0,
      bp('两天前的断点'),
    ),
  ];
  assert.equal(
    buildPlan(p, DATE, { history: twoDaysAgo }).blocks[0].action,
    '两天前的断点',
  );

  const threeDaysAgo = [
    withBreakpoint(
      planOf('2026-10-20', ['microwave']),
      0,
      bp('三天前的断点'),
    ),
  ];
  const stale = buildPlan(p, DATE, { history: threeDaysAgo });
  assert.equal(stale.blocks[0].action, '翻目录');
  assert.equal(r7Actions(p, DATE, threeDaysAgo).has('microwave'), false);
});

test('R7 takes the newest breakpoint: date first, then higher block number', () => {
  const p = microwavePool();
  const olderDay = withBreakpoint(
    planOf('2026-10-21', ['microwave']),
    0,
    bp('D-2 的旧断点'),
  );
  const newerDay = withBreakpoint(
    withBreakpoint(
      planOf('2026-10-22', ['microwave', 'microwave']),
      0,
      bp('D-1 第一块'),
    ),
    1,
    bp('D-1 第二块'),
  );

  const plan = buildPlan(p, DATE, { history: [newerDay, olderDay] });
  assert.equal(plan.blocks[0].action, 'D-1 第二块');
});

test('R7 without a breakpoint keeps next_action and note fallbacks', () => {
  const p = pool([
    project({
      id: 'a',
      deadline: '2026-10-26',
      note: '描述 A',
      next_action: '下一步动作',
    }),
    project({
      id: 'b',
      kind: 'side',
      last_touched: '2026-10-01',
      note: '只有描述',
    }),
  ]);

  const plan = buildPlan(p, DATE, {
    history: [planOf('2026-10-22', ['a'])],
  });
  assert.equal(plan.blocks[0].action, '下一步动作');
  assert.equal(plan.blocks[1].action, REPEAT_ACTION);
  assert.equal(plan.blocks[2].action, '只有描述');
});

test('applyBreakpoint stores the last breakpoint, replaces it, and keeps result', () => {
  const plan = planOf('2026-10-23', ['a', 'b']);
  plan.result = {
    reviewed_at: '2026-10-23T21:30:00+08:00',
    blocks: [
      { project_id: 'a', done: true, note: null },
      { project_id: 'b', done: false, note: '没做完' },
    ],
  };

  const first = applyBreakpoint(plan, {
    block: 1,
    did: '看完了第一章',
    stuck: '边界条件',
    next: '重读边界条件',
    at: AT,
  });
  assert.notEqual(first, null);
  assert.deepEqual((first as Plan).blocks[0].breakpoint, {
    at: AT,
    did: '看完了第一章',
    stuck: '边界条件',
    next: '重读边界条件',
  });
  assert.equal((first as Plan).blocks[1].breakpoint, null);
  assert.deepEqual((first as Plan).result, plan.result);

  const second = applyBreakpoint(first as Plan, {
    block: 1,
    did: '修正：只看了一半',
    next: '先做题 3-2',
    at: '2026-10-23T22:10:00+08:00',
  });
  assert.deepEqual((second as Plan).blocks[0].breakpoint, {
    at: '2026-10-23T22:10:00+08:00',
    did: '修正：只看了一半',
    stuck: null,
    next: '先做题 3-2',
  });

  assert.throws(
    () =>
      applyBreakpoint(plan, {
        block: 3,
        did: 'x',
        next: 'y',
        at: AT,
      }),
    /块号超出范围/,
  );
  assert.equal(
    applyBreakpoint(planOf('2026-10-24', [], 'exception'), {
      block: 1,
      did: 'x',
      next: 'y',
      at: AT,
    }),
    null,
  );
});

const CLI = resolve(import.meta.dirname, '..', 'src', 'cli.ts');

type RunResult = { status: number | null; stdout: string; stderr: string };

function makeDataDir(
  t: { after(fn: () => void): void },
  projects: ReturnType<typeof project>[],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'tamer-breakpoint-'));
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
      id: 'htb-box',
      title: 'HTB 靶机',
      kind: 'side',
      progress: 0.4,
      last_touched: '2026-10-21',
      note: '打靶',
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

test('CLI plan breakpoint writes a breakpoint that plan show reads back', (t) => {
  const dir = makeDataDir(t, seedProjects());
  assert.equal(run(dir, ['plan', 'new', '--date', '2026-10-23']).status, 0);

  const written = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-23',
    '--block',
    '2',
    '--did',
    '看完了第一章，导波没看懂',
    '--stuck',
    '导波方程的边界条件',
    '--next',
    '从边界条件那节重读',
    '--at',
    AT,
  ]);
  assert.equal(written.status, 0);
  assert.match(written.stdout, /已记录断点：第 2 块/);

  const shown = run(dir, ['plan', 'show', '--date', '2026-10-23']);
  assert.equal(shown.status, 0);
  const plan = JSON.parse(shown.stdout);
  assert.deepEqual(plan.blocks[1].breakpoint, {
    at: AT,
    did: '看完了第一章，导波没看懂',
    stuck: '导波方程的边界条件',
    next: '从边界条件那节重读',
  });
  assert.equal(plan.blocks[0].breakpoint, null);

  const second = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-23',
    '--block',
    '2',
    '--did',
    '修正：只看到 3.1',
    '--next',
    '先做课后题 3-2',
    '--at',
    '2026-10-23T22:10:00+08:00',
  ]);
  assert.equal(second.status, 0);
  assert.deepEqual(readPlanFile(dir, '2026-10-23').blocks[1].breakpoint, {
    at: '2026-10-23T22:10:00+08:00',
    did: '修正：只看到 3.1',
    stuck: null,
    next: '先做课后题 3-2',
  });
});

test('CLI plan breakpoint exits 1 for a missing plan, bad block, or exception day', (t) => {
  const dir = makeDataDir(t, seedProjects());

  const missing = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-23',
    '--block',
    '1',
    '--did',
    'x',
    '--next',
    'y',
  ]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /没有找到计划/);

  assert.equal(run(dir, ['plan', 'new', '--date', '2026-10-23']).status, 0);
  const outOfRange = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-23',
    '--block',
    '4',
    '--did',
    'x',
    '--next',
    'y',
  ]);
  assert.equal(outOfRange.status, 1);
  assert.match(outOfRange.stderr, /块号超出范围/);

  assert.equal(
    run(dir, [
      'plan',
      'new',
      '--date',
      '2026-10-24',
      '--day-type',
      'exception',
    ]).status,
    0,
  );
  const exceptionDay = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-24',
    '--block',
    '1',
    '--did',
    'x',
    '--next',
    'y',
  ]);
  assert.equal(exceptionDay.status, 1);
  assert.match(exceptionDay.stderr, /例外日没有块/);
});

test('CLI breakpoint flows into the next day first block', (t) => {
  const dir = makeDataDir(t, seedProjects());
  assert.equal(run(dir, ['plan', 'new', '--date', '2026-10-22']).status, 0);

  const written = run(dir, [
    'plan',
    'breakpoint',
    '--date',
    '2026-10-22',
    '--block',
    '1',
    '--did',
    '把第一章看完了',
    '--stuck',
    '导波方程的边界条件',
    '--next',
    '从边界条件那节重读，先做课后题 3-2',
    '--at',
    '2026-10-22T21:40:00+08:00',
  ]);
  assert.equal(written.status, 0);

  const nextDay = run(dir, ['plan', 'new', '--date', '2026-10-23']);
  assert.equal(nextDay.status, 0);
  assert.match(
    nextDay.stdout,
    /主线一 —— 《微波技术》下一步：从边界条件那节重读，先做课后题 3-2/,
  );

  const plan = readPlanFile(dir, '2026-10-23');
  assert.equal(plan.blocks[0].action, '从边界条件那节重读，先做课后题 3-2');
  assert.equal(plan.blocks[1].action, REPEAT_ACTION);
});
