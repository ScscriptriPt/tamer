import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/plan.ts';
import { renderEvening, renderMorning } from '../src/render.ts';
import { pool, project } from './helpers.ts';

const DATE = '2026-10-23';

function morningPool() {
  return pool([
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
    project({
      id: 'notion-migrate',
      title: 'Notion→Obsidian 迁移',
      kind: 'side',
      status: 'shelved',
      wake_at: '2026-10-27',
      note: '迁移',
    }),
  ]);
}

const EXPECTED = [
  '早。今天三块：',
  '',
  '**09:00–10:30** 主线一 —— 《微波技术》下一步：复习',
  '**10:45–11:45** 主线二 —— 《微波技术》下一步：接着上一块往下做，收手前留一句断点',
  '**14:00–15:00** 支线 —— 《HTB 靶机》下一步：打靶',
  '',
  '搁置中：Notion→Obsidian 迁移（10-27 唤醒）',
  '今天不要做：换笔记软件 / 开新项目',
].join('\n');

test('renderMorning matches the v0.01 format byte for byte', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE);
  assert.equal(renderMorning(plan, p), EXPECTED);
  assert.equal(renderMorning(plan, p, { now: undefined }), EXPECTED);
});

test('renderMorning before the first block keeps the old title unchanged', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE);
  assert.equal(renderMorning(plan, p, { now: '08:00' }), EXPECTED);
});

test('renderMorning marks a block ending exactly at now as elapsed', () => {
  const p = morningPool();
  const text = renderMorning(buildPlan(p, DATE), p, { now: '10:30' });
  assert.equal(
    text,
    [
      '现在 10:30，前 1 块已过。',
      '',
      '**10:45–11:45** 主线二 —— 《微波技术》下一步：接着上一块往下做，收手前留一句断点',
      '**14:00–15:00** 支线 —— 《HTB 靶机》下一步：打靶',
      '',
      '搁置中：Notion→Obsidian 迁移（10-27 唤醒）',
      '今天不要做：换笔记软件 / 开新项目',
    ].join('\n'),
  );
  assert.equal(text.includes('09:00–10:30'), false);
});

test('renderMorning with every block elapsed prints exactly one line', () => {
  const p = morningPool();
  const text = renderMorning(buildPlan(p, DATE), p, { now: '15:00' });
  assert.equal(text, '现在 15:00，今天三块都过了。');
  assert.equal(text.split('\n').length, 1);
});

test('renderMorning rejects a malformed now', () => {
  const p = morningPool();
  assert.throws(
    () => renderMorning(buildPlan(p, DATE), p, { now: '9:00' }),
    /无效的时间/,
  );
});

test('renderMorning is deterministic and has no CR or trailing newline', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE);
  const first = renderMorning(plan, p);
  const second = renderMorning(plan, p);
  assert.equal(first, second);
  assert.equal(first.includes('\r'), false);
  assert.equal(first.endsWith('\n'), false);
});

test('renderMorning stays within 10 lines', () => {
  const p = morningPool();
  const text = renderMorning(buildPlan(p, DATE), p);
  assert.ok(text.split('\n').length <= 10);
});

test('renderMorning gives a repeated project two different block lines', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE);
  assert.equal(plan.blocks.length, 3);
  assert.equal(plan.blocks[0].project_id, plan.blocks[1].project_id);
  assert.notEqual(plan.blocks[0].action, plan.blocks[1].action);

  const lines = renderMorning(plan, p)
    .split('\n')
    .filter((line) => line.startsWith('**'));
  assert.equal(lines.length, 3);
  assert.notEqual(lines[0], lines[1]);
  assert.match(lines[1], /接着上一块往下做，收手前留一句断点/);
});

test('renderMorning title counts the actual blocks, and zero blocks render empty', () => {
  const three = morningPool();
  assert.match(renderMorning(buildPlan(three, DATE), three), /^早。今天三块：\n/);

  const two = pool([
    project({ id: 'a', last_touched: '2026-10-01' }),
    project({ id: 'b', last_touched: '2026-10-02' }),
  ]);
  assert.match(renderMorning(buildPlan(two, DATE), two), /^早。今天两块：\n/);

  const one = pool([project({ id: 'only', last_touched: '2026-10-01' })]);
  assert.match(renderMorning(buildPlan(one, DATE), one), /^早。今天一块：\n/);

  const zero = pool([]);
  assert.equal(renderMorning(buildPlan(zero, DATE), zero), '');
});

test('renderMorning returns an empty string on exception days', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE, { dayType: 'exception' });
  assert.equal(renderMorning(plan, p), '');
});

test('renderMorning handles a day with zero blocks without inventing copy', () => {
  const p = pool([]);
  const plan = buildPlan(p, DATE);
  assert.equal(plan.blocks.length, 0);
  assert.equal(renderMorning(plan, p), '');
});

test('renderMorning falls back to project_id when pool has no title', () => {
  const p = pool([]);
  const plan = buildPlan(p, DATE);
  plan.blocks = [
    {
      start: '09:00',
      end: '10:30',
      kind: 'main',
      project_id: 'ghost',
      action: '做点事',
      done_when: '做完',
      breakpoint: null,
    },
  ];
  assert.match(renderMorning(plan, p), /《ghost》下一步：做点事/);
});

test('renderMorning collapses newlines in caller copy to keep one line per block', () => {
  const p = pool([project({ id: 'a', note: '第一行\n第二行' })]);
  const plan = buildPlan(p, DATE);
  const text = renderMorning(plan, p);
  assert.match(text, /下一步：第一行 第二行/);
  assert.equal(text.includes('\n第二行'), false);
});

test('renderEvening prints exactly one question per step', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE);
  assert.equal(renderEvening(plan, 1), '今天三块里，哪块真做了？');
  assert.equal(
    renderEvening(plan, 2),
    '没做的那块断在哪，下一块的第一个动作是什么？',
  );
});

test('renderEvening is empty on exception days and rejects other steps', () => {
  const p = morningPool();
  const plan = buildPlan(p, DATE, { dayType: 'exception' });
  assert.equal(renderEvening(plan, 1), '');
  assert.equal(renderEvening(plan, 2), '');

  const normal = buildPlan(p, DATE);
  assert.throws(() => renderEvening(normal, 3 as 1 | 2), /无效的 step/);
});
