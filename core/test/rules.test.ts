import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consecutiveAppearances,
  isHighRisk,
  isR2Blocked,
  mainBlockAllowance,
  r1Candidates,
  r3Candidates,
  r4Candidates,
  selectBlocks,
} from '../src/rules.ts';
import { planOf, pool, project } from './helpers.ts';

const DATE = '2026-10-23';

function ids(projects: { id: string }[]): string[] {
  return projects.map((project) => project.id);
}

test('R1 selects active mains with deadline in 0..30 days, deadline ascending', () => {
  const p = pool([
    project({ id: 'soon', deadline: '2026-10-25' }),
    project({ id: 'later', deadline: '2026-11-10' }),
    project({ id: 'boundary', deadline: '2026-11-22' }),
    project({ id: 'too-far', deadline: '2026-11-23' }),
    project({ id: 'overdue', deadline: '2026-10-22' }),
    project({ id: 'paused', status: 'paused', deadline: '2026-10-24' }),
    project({ id: 'side', kind: 'side', deadline: '2026-10-24' }),
    project({ id: 'none', deadline: null }),
  ]);
  assert.deepEqual(ids(r1Candidates(p, DATE)), ['soon', 'later', 'boundary']);
});

test('R1 equal deadlines keep pool.json order', () => {
  const p = pool([
    project({ id: 'first', deadline: '2026-10-25' }),
    project({ id: 'second', deadline: '2026-10-25' }),
  ]);
  assert.deepEqual(ids(r1Candidates(p, DATE)), ['first', 'second']);
});

test('R1a: a deadline within 7 days allows two main blocks', () => {
  const p = pool([
    project({ id: 'microwave', deadline: '2026-10-26' }),
    project({ id: 'netsec', last_touched: '2026-10-01' }),
  ]);
  const selection = selectBlocks(p, DATE);
  assert.deepEqual(
    selection.blocks
      .filter((candidate) => candidate.kind === 'main')
      .map((candidate) => candidate.project_id),
    ['microwave', 'microwave'],
  );
  assert.deepEqual(selection.forced, []);
});

test('R1a: 7 days doubles, 8 days does not', () => {
  const seven = pool([
    project({ id: 'seven', deadline: '2026-10-30' }),
    project({ id: 'other', last_touched: '2026-10-01' }),
  ]);
  assert.deepEqual(
    selectBlocks(seven, DATE).blocks.map((candidate) => candidate.project_id),
    ['seven', 'seven'],
  );

  const eight = pool([
    project({ id: 'eight', deadline: '2026-10-31' }),
    project({ id: 'other', last_touched: '2026-10-01' }),
  ]);
  assert.deepEqual(
    selectBlocks(eight, DATE).blocks.map((candidate) => candidate.project_id),
    ['eight', 'other'],
  );

  assert.equal(isHighRisk(project({ id: 'x', deadline: '2026-10-30' }), DATE), true);
  assert.equal(isHighRisk(project({ id: 'x', deadline: '2026-10-31' }), DATE), false);
  assert.equal(
    mainBlockAllowance(project({ id: 'x', deadline: '2026-10-26' }), DATE),
    2,
  );
  assert.equal(
    mainBlockAllowance(project({ id: 'x', deadline: '2026-11-10' }), DATE),
    1,
  );
});

test('R2 counts only two immediately preceding calendar days', () => {
  const history = [planOf('2026-10-21', ['a']), planOf('2026-10-22', ['a'])];
  assert.equal(consecutiveAppearances('a', DATE, history), 2);
  assert.equal(consecutiveAppearances('b', DATE, history), 0);
  assert.equal(consecutiveAppearances('a', DATE, [planOf('2026-10-22', ['a'])]), 1);
  assert.equal(consecutiveAppearances('a', DATE, [planOf('2026-10-21', ['a'])]), 0);
  assert.equal(isR2Blocked('a', DATE, history), true);
  assert.equal(isR2Blocked('a', DATE, [planOf('2026-10-22', ['a'])]), false);
});

test('R2: day three switches to a different main', () => {
  const p = pool([
    project({ id: 'a', deadline: '2026-10-26' }),
    project({ id: 'b' }),
  ]);
  const history = [planOf('2026-10-21', ['a']), planOf('2026-10-22', ['a'])];
  const selection = selectBlocks(p, DATE, { history });
  assert.deepEqual(
    selection.blocks.map((candidate) => candidate.project_id),
    ['b'],
  );
  assert.deepEqual(selection.forced, []);
});

test('R2: only one preceding day is not a streak', () => {
  const p = pool([project({ id: 'a', deadline: '2026-10-26' })]);
  const selection = selectBlocks(p, DATE, {
    history: [planOf('2026-10-22', ['a'])],
  });
  assert.deepEqual(
    selection.blocks.map((candidate) => candidate.project_id),
    ['a', 'a'],
  );
});

test('R2: high-risk project is forced only when no alternative exists', () => {
  const only = pool([project({ id: 'a', deadline: '2026-10-26' })]);
  const history = [planOf('2026-10-21', ['a']), planOf('2026-10-22', ['a'])];
  const forcedSelection = selectBlocks(only, DATE, { history });
  assert.deepEqual(
    forcedSelection.blocks.map((candidate) => candidate.project_id),
    ['a', 'a'],
  );
  assert.deepEqual(forcedSelection.forced, ['a']);

  const withAlternative = pool([
    project({ id: 'a', deadline: '2026-10-26' }),
    project({ id: 'b', last_touched: '2026-10-01' }),
  ]);
  const normalSelection = selectBlocks(withAlternative, DATE, { history });
  assert.deepEqual(
    normalSelection.blocks.map((candidate) => candidate.project_id),
    ['b'],
  );
  assert.deepEqual(normalSelection.forced, []);
});

test('R2: non-R1a project is never forced after a streak', () => {
  const p = pool([project({ id: 'a', deadline: null })]);
  const history = [planOf('2026-10-21', ['a']), planOf('2026-10-22', ['a'])];
  const selection = selectBlocks(p, DATE, { history });
  assert.deepEqual(selection.blocks, []);
  assert.deepEqual(selection.forced, []);
});

test('R3 picks least recently touched, null first, pool order on ties', () => {
  const p = pool([
    project({ id: 'recent', last_touched: '2026-10-20' }),
    project({ id: 'old', last_touched: '2026-10-01' }),
    project({ id: 'never', last_touched: null }),
    project({ id: 'done', status: 'done', last_touched: null }),
    project({ id: 'paused', status: 'paused', last_touched: null }),
  ]);
  assert.deepEqual(ids(r3Candidates(p, DATE)), ['never', 'old', 'recent']);
  assert.deepEqual(
    selectBlocks(p, DATE).blocks.map((candidate) => candidate.project_id),
    ['never', 'old'],
  );

  const tie = pool([
    project({ id: 'x', last_touched: null }),
    project({ id: 'y', last_touched: null }),
  ]);
  assert.deepEqual(ids(r3Candidates(tie, DATE)), ['x', 'y']);
});

test('R3 only considers mains left over after R1', () => {
  const p = pool([
    project({ id: 'soon', deadline: '2026-11-10' }),
    project({ id: 'old', last_touched: '2026-10-01' }),
  ]);
  assert.deepEqual(ids(r3Candidates(p, DATE)), ['old']);
  assert.deepEqual(
    selectBlocks(p, DATE).blocks.map((candidate) => candidate.project_id),
    ['soon', 'old'],
  );
});

test('R4 prefers started sides touched most recently, then oldest sides', () => {
  const p = pool([
    project({
      id: 'website',
      kind: 'side',
      progress: 0.75,
      last_touched: '2026-10-17',
    }),
    project({
      id: 'htb',
      kind: 'side',
      progress: 0.35,
      last_touched: '2026-10-21',
    }),
    project({
      id: 'fresh',
      kind: 'side',
      progress: 0,
      last_touched: '2026-10-22',
    }),
    project({
      id: 'paused-side',
      kind: 'side',
      status: 'paused',
      progress: 0.5,
      last_touched: '2026-10-22',
    }),
    project({
      id: 'shelved-side',
      kind: 'side',
      status: 'shelved',
      progress: 0.5,
      last_touched: '2026-10-22',
    }),
  ]);
  assert.deepEqual(ids(r4Candidates(p)), ['htb', 'website', 'fresh']);
  assert.deepEqual(
    selectBlocks(p, DATE).blocks.map((candidate) => candidate.project_id),
    ['htb'],
  );
});

test('R4 falls back to oldest side, null last_touched first', () => {
  const p = pool([
    project({
      id: 'older',
      kind: 'side',
      progress: 0,
      last_touched: '2026-10-01',
    }),
    project({ id: 'never', kind: 'side', progress: null, last_touched: null }),
  ]);
  assert.deepEqual(ids(r4Candidates(p)), ['never', 'older']);
  assert.deepEqual(
    selectBlocks(p, DATE).blocks.map((candidate) => candidate.project_id),
    ['never'],
  );
});

test('R4 leaves the side slot empty when no active side exists', () => {
  const p = pool([project({ id: 'main', last_touched: '2026-10-01' })]);
  const selection = selectBlocks(p, DATE);
  assert.equal(selection.blocks.some((candidate) => candidate.kind === 'side'), false);
});

test('R2 rotates sides too', () => {
  const p = pool([
    project({
      id: 'htb',
      kind: 'side',
      progress: 0.4,
      last_touched: '2026-10-21',
    }),
    project({
      id: 'website',
      kind: 'side',
      progress: 0.7,
      last_touched: '2026-10-17',
    }),
  ]);
  const history = [planOf('2026-10-21', ['htb']), planOf('2026-10-22', ['htb'])];
  const selection = selectBlocks(p, DATE, { history });
  assert.deepEqual(
    selection.blocks.map((candidate) => candidate.project_id),
    ['website'],
  );
});

test('R5 exception day emits no blocks', () => {
  const p = pool([
    project({ id: 'microwave', deadline: '2026-10-26' }),
    project({ id: 'htb', kind: 'side', progress: 0.4 }),
  ]);
  const selection = selectBlocks(p, DATE, { dayType: 'exception' });
  assert.deepEqual(selection.blocks, []);
  assert.deepEqual(selection.forced, []);
});

test('R6 empty pool and side-only pool produce 0 or 1 blocks without error', () => {
  assert.deepEqual(selectBlocks(pool([]), DATE).blocks, []);

  const sideOnly = pool([
    project({ id: 'htb', kind: 'side', progress: 0.4 }),
  ]);
  const selection = selectBlocks(sideOnly, DATE);
  assert.equal(selection.blocks.length, 1);
  assert.equal(selection.blocks[0].kind, 'side');
});

test('R6 never exceeds three blocks', () => {
  const p = pool([
    project({ id: 'microwave', deadline: '2026-10-26' }),
    project({ id: 'htb', kind: 'side', progress: 0.4 }),
  ]);
  assert.equal(selectBlocks(p, DATE).blocks.length, 3);
});
