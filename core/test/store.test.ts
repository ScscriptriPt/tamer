import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listPlanDates,
  planFile,
  poolFile,
  readHistory,
  readIdeas,
  readPlan,
  readPool,
  readPoolIfPresent,
  writeIdeas,
  writePlan,
  writePool,
} from '../src/store.ts';
import { planOf, pool, project } from './helpers.ts';

function makeTempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'tamer-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('writePool/readPool round-trip with deterministic UTF-8 formatting', (t) => {
  const dir = makeTempDir(t);
  const p = pool([
    project({ id: 'a', title: '项目 A', deadline: '2026-10-26' }),
  ]);
  writePool(dir, p);

  const text = readFileSync(poolFile(dir), 'utf8');
  assert.equal(text.charCodeAt(0), '{'.charCodeAt(0));
  assert.equal(text.startsWith('{\n  "version": 1,\n  "projects": ['), true);
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.includes('\r'), false);
  assert.equal(text.includes('\ufeff'), false);
  assert.deepEqual(readPool(dir), p);
});

test('writePlan/readPlan/listPlanDates use data/plans/YYYY-MM-DD.json', (t) => {
  const dir = makeTempDir(t);
  const plan = planOf('2026-10-23', ['a', 'b']);
  writePlan(dir, plan);
  writePlan(dir, planOf('2026-10-22', ['a']));

  assert.deepEqual(readPlan(dir, '2026-10-23'), plan);
  assert.equal(readPlan(dir, '2026-10-24'), null);
  assert.deepEqual(listPlanDates(dir), ['2026-10-22', '2026-10-23']);

  const text = readFileSync(planFile(dir, '2026-10-23'), 'utf8');
  assert.match(text, /^\{\n  "date": "2026-10-23",\n  "day_type": "normal",/);
  assert.equal(text.endsWith('\n'), true);
});

test('readHistory loads only the two calendar days before the plan date', (t) => {
  const dir = makeTempDir(t);
  writePlan(dir, planOf('2026-10-20', ['too-old']));
  writePlan(dir, planOf('2026-10-21', ['b']));
  writePlan(dir, planOf('2026-10-22', ['a']));
  writePlan(dir, planOf('2026-10-23', ['current']));

  const history = readHistory(dir, '2026-10-23', 2);
  assert.deepEqual(
    history.map((entry) => entry.date),
    ['2026-10-22', '2026-10-21'],
  );
  assert.deepEqual(
    history.map((entry) => entry.blocks.map((block) => block.project_id)),
    [['a'], ['b']],
  );
});

test('readHistory skips missing days', (t) => {
  const dir = makeTempDir(t);
  writePlan(dir, planOf('2026-10-21', ['a']));
  const history = readHistory(dir, '2026-10-23', 2);
  assert.deepEqual(
    history.map((entry) => entry.date),
    ['2026-10-21'],
  );
});

test('ideas round-trip', (t) => {
  const dir = makeTempDir(t);
  const book = {
    version: 1,
    ideas: [
      {
        id: 'idea-20261022-1',
        text: '想试试 nvim',
        captured_at: '2026-10-22',
        state: 'graveyard',
        occurrences: 1,
        wake_at: null,
        reason: null,
      },
    ],
  };
  writeIdeas(dir, book);
  assert.deepEqual(readIdeas(dir), book);
});

test('readPool rejects malformed JSON with the file path', (t) => {
  const dir = makeTempDir(t);
  writeFileSync(poolFile(dir), '{oops', 'utf8');
  assert.throws(() => readPool(dir), /无法解析 JSON/);
});

test('readPoolIfPresent reads a missing pool as empty', (t) => {
  const dir = makeTempDir(t);
  assert.deepEqual(readPoolIfPresent(dir), { version: 1, projects: [] });
});

test('readPoolIfPresent still rejects malformed JSON', (t) => {
  const dir = makeTempDir(t);
  writeFileSync(poolFile(dir), '{oops', 'utf8');
  assert.throws(() => readPoolIfPresent(dir), /无法解析 JSON/);
  assert.equal(readFileSync(poolFile(dir), 'utf8'), '{oops');
});
