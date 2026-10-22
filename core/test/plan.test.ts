import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DO_NOT,
  REPEAT_ACTION,
  REPEAT_DONE_WHEN,
  applyReview,
  buildPlan,
  buildShelved,
  canOverwritePlan,
} from '../src/plan.ts';
import { planOf, pool, project } from './helpers.ts';

const DATE = '2026-10-23';

function samplePool() {
  return pool([
    project({
      id: 'microwave',
      title: '微波技术',
      deadline: '2026-10-26',
      note: '复习',
    }),
    project({ id: 'netsec', title: '通信网与网络安全', note: '读一章' }),
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
      note: '迁移笔记',
    }),
    project({
      id: 'nohw',
      title: 'noHW 重构',
      kind: 'side',
      status: 'paused',
      wake_at: '2026-10-29',
      note: '范围决策',
    }),
  ]);
}

test('buildPlan produces the v0.01 plan shape and key order', () => {
  const p = samplePool();
  const plan = buildPlan(p, DATE);

  assert.deepEqual(Object.keys(plan), [
    'date',
    'day_type',
    'blocks',
    'shelved',
    'do_not',
    'risk',
    'result',
  ]);
  assert.equal(plan.date, DATE);
  assert.equal(plan.day_type, 'normal');
  assert.equal(plan.result, null);
  assert.equal(plan.risk, null);
  assert.deepEqual(plan.do_not, DEFAULT_DO_NOT);
  assert.deepEqual(plan.shelved, [
    { project_id: 'notion-migrate', reason: '10-27 唤醒' },
  ]);

  assert.deepEqual(
    plan.blocks.map((block) => [
      block.start,
      block.end,
      block.kind,
      block.project_id,
    ]),
    [
      ['09:00', '10:30', 'main', 'microwave'],
      ['10:45', '11:45', 'main', 'microwave'],
      ['14:00', '15:00', 'side', 'htb-box'],
    ],
  );
  assert.deepEqual(Object.keys(plan.blocks[0]), [
    'start',
    'end',
    'kind',
    'project_id',
    'action',
    'done_when',
    'breakpoint',
  ]);
  assert.equal(plan.blocks[0].action, '复习');
  assert.equal(plan.blocks[0].done_when, '复习');
  assert.equal(plan.blocks[0].breakpoint, null);
});

test('buildPlan uses note as both action and done_when fallback', () => {
  const p = pool([
    project({ id: 'a', note: '动作 A' }),
    project({ id: 'b', last_touched: '2026-10-01', note: null }),
  ]);
  const plan = buildPlan(p, DATE, { actionOverride: '调用方动作' });
  assert.equal(plan.blocks[0].action, '调用方动作');
  assert.equal(plan.blocks[0].done_when, '动作 A');
  assert.equal(plan.blocks[1].action, '');
});

test('buildPlan applies per-project actions and first-block overrides', () => {
  const p = samplePool();
  const plan = buildPlan(p, DATE, {
    actionOverride: '第一块',
    actions: { microwave: '项目动作' },
    doneWhenByProject: { microwave: '项目标准' },
  });
  assert.equal(plan.blocks[0].action, '第一块');
  assert.equal(plan.blocks[0].done_when, '项目标准');
  assert.equal(plan.blocks[1].action, '项目动作');
  assert.equal(plan.blocks[1].done_when, '项目标准');
});

test('buildPlan prefers next_action over the descriptive note', () => {
  const p = pool([
    project({
      id: 'microwave',
      deadline: '2026-10-26',
      note: '本科课程，从零开始',
      next_action: '翻目录和往年卷',
    }),
    project({
      id: 'other',
      kind: 'side',
      last_touched: '2026-10-01',
      note: '描述',
    }),
  ]);
  const plan = buildPlan(p, DATE);
  assert.equal(plan.blocks[0].action, '翻目录和往年卷');
  assert.equal(plan.blocks[0].done_when, '翻目录和往年卷');
  assert.equal(plan.blocks[2].action, '描述');
});

test('buildPlan gives a repeated project a distinct second block', () => {
  const p = pool([
    project({ id: 'microwave', deadline: '2026-10-26', next_action: '翻目录' }),
    project({ id: 'htb', kind: 'side', progress: 0.4 }),
  ]);
  const plan = buildPlan(p, DATE);
  assert.equal(plan.blocks.length, 3);
  assert.equal(plan.blocks[0].project_id, 'microwave');
  assert.equal(plan.blocks[1].project_id, 'microwave');
  assert.equal(plan.blocks[0].action, '翻目录');
  assert.equal(plan.blocks[1].action, REPEAT_ACTION);
  assert.equal(plan.blocks[1].done_when, REPEAT_DONE_WHEN);
  assert.notEqual(plan.blocks[0].action, plan.blocks[1].action);
});

test('buildPlan applies per-block copy ahead of whole and project copy', () => {
  const p = pool([
    project({
      id: 'microwave',
      deadline: '2026-10-26',
      next_action: '项目动作',
    }),
  ]);
  const plan = buildPlan(p, DATE, {
    actionOverride: '整体动作',
    blockActions: { 'microwave#2': '第二块专用' },
    blockDoneWhen: { 'microwave#2': '第二块标准' },
  });
  assert.equal(plan.blocks[0].action, '整体动作');
  assert.equal(plan.blocks[0].done_when, '项目动作');
  assert.equal(plan.blocks[1].action, '第二块专用');
  assert.equal(plan.blocks[1].done_when, '第二块标准');

  const wholeOnly = buildPlan(p, DATE, {
    blockActions: { 'microwave#1': '逐块一' },
    actionOverride: '整体动作',
  });
  assert.equal(wholeOnly.blocks[0].action, '逐块一');
});

test('buildPlan accepts do_not override and existing risk text', () => {
  const p = samplePool();
  const plan = buildPlan(p, DATE, {
    doNot: ['只做一件事'],
    risk: '原有风险',
  });
  assert.deepEqual(plan.do_not, ['只做一件事']);
  assert.equal(plan.risk, '原有风险');
});

test('buildPlan appends forced: <id> to risk under the R1a/R2 exception', () => {
  const p = pool([project({ id: 'microwave', deadline: '2026-10-26' })]);
  const history = [
    planOf('2026-10-21', ['microwave']),
    planOf('2026-10-22', ['microwave']),
  ];
  const plan = buildPlan(p, DATE, { history, risk: '原有风险' });
  assert.equal(plan.blocks.length, 2);
  assert.equal(plan.risk, '原有风险；forced: microwave');
});

test('buildShelved sorts by wake_at, caps at three, and skips paused', () => {
  const p = pool([
    project({
      id: 's1',
      kind: 'side',
      status: 'shelved',
      wake_at: '2026-10-29',
    }),
    project({
      id: 's2',
      kind: 'side',
      status: 'shelved',
      wake_at: '2026-10-27',
    }),
    project({
      id: 's3',
      kind: 'side',
      status: 'shelved',
      wake_at: null,
      note: '无唤醒日期',
    }),
    project({
      id: 's4',
      kind: 'side',
      status: 'shelved',
      wake_at: '2026-10-28',
    }),
    project({
      id: 'paused',
      kind: 'side',
      status: 'paused',
      wake_at: '2026-10-26',
    }),
  ]);
  assert.deepEqual(buildShelved(p), [
    { project_id: 's2', reason: '10-27 唤醒' },
    { project_id: 's4', reason: '10-28 唤醒' },
    { project_id: 's1', reason: '10-29 唤醒' },
  ]);
});

test('buildShelved falls back to note when wake_at is null', () => {
  const p = pool([
    project({
      id: 's',
      kind: 'side',
      status: 'shelved',
      wake_at: null,
      note: '等考试结束',
    }),
  ]);
  assert.deepEqual(buildShelved(p), [
    { project_id: 's', reason: '等考试结束' },
  ]);
});

test('canOverwritePlan is false only when result exists', () => {
  assert.equal(canOverwritePlan(null), true);
  assert.equal(canOverwritePlan(planOf(DATE, ['a'])), true);
  const withResult = planOf(DATE, ['a']);
  withResult.result = { reviewed_at: '2026-10-23T21:30:00+08:00', blocks: [] };
  assert.equal(canOverwritePlan(withResult), false);
});

test('applyReview writes an aligned result and preserves earlier answers', () => {
  const p = samplePool();
  const base = buildPlan(p, DATE);

  const first = applyReview(base, {
    block: 2,
    done: true,
    note: '做完了',
    reviewedAt: '2026-10-23T21:30:00+08:00',
  });
  assert.notEqual(first, null);
  assert.equal(first?.result?.reviewed_at, '2026-10-23T21:30:00+08:00');
  assert.deepEqual(first?.result?.blocks, [
    { project_id: 'microwave', done: false, note: null },
    { project_id: 'microwave', done: true, note: '做完了' },
    { project_id: 'htb-box', done: false, note: null },
  ]);

  const second = applyReview(first as typeof base, {
    block: 3,
    done: false,
    note: '断在环境',
    reviewedAt: '2026-10-23T21:35:00+08:00',
  });
  assert.deepEqual(second?.result?.blocks, [
    { project_id: 'microwave', done: false, note: null },
    { project_id: 'microwave', done: true, note: '做完了' },
    { project_id: 'htb-box', done: false, note: '断在环境' },
  ]);
});

test('applyReview rejects out-of-range blocks', () => {
  const plan = buildPlan(samplePool(), DATE);
  assert.throws(
    () =>
      applyReview(plan, {
        block: 0,
        done: true,
        reviewedAt: '2026-10-23T21:30:00+08:00',
      }),
    /块号超出范围/,
  );
  assert.throws(
    () =>
      applyReview(plan, {
        block: 4,
        done: true,
        reviewedAt: '2026-10-23T21:30:00+08:00',
      }),
    /块号超出范围/,
  );
});

test('R5 exception buildPlan is empty and applyReview returns null', () => {
  const plan = buildPlan(samplePool(), DATE, { dayType: 'exception' });
  assert.deepEqual(plan, {
    date: DATE,
    day_type: 'exception',
    blocks: [],
    shelved: [],
    do_not: [],
    risk: null,
    result: null,
  });
  assert.equal(
    applyReview(plan, {
      block: 1,
      done: true,
      reviewedAt: '2026-10-23T21:30:00+08:00',
    }),
    null,
  );
});
