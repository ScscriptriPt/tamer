import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  daysBetween,
  formatShortDate,
  fromDayNumber,
  isDateString,
  parseDate,
  toDayNumber,
  todayLocal,
} from '../src/dates.ts';

test('parseDate accepts valid calendar dates', () => {
  assert.deepEqual(parseDate('2026-10-23'), {
    year: 2026,
    month: 10,
    day: 23,
  });
  assert.deepEqual(parseDate('2024-02-29'), {
    year: 2024,
    month: 2,
    day: 29,
  });
});

test('parseDate rejects malformed and impossible dates', () => {
  const bad = [
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-1-1',
    '23-10-2026',
    '',
    '2026-10-23T00:00:00',
  ];
  for (const value of bad) {
    assert.throws(() => parseDate(value), /无效日期/);
  }
});

test('isDateString only accepts YYYY-MM-DD', () => {
  assert.equal(isDateString('2026-10-23'), true);
  assert.equal(isDateString('2026-02-30'), false);
  assert.equal(isDateString(null), false);
  assert.equal(isDateString(20261023), false);
});

test('day numbers round-trip', () => {
  for (const date of ['1970-01-01', '2024-02-29', '2026-10-23', '2030-12-31']) {
    assert.equal(fromDayNumber(toDayNumber(date)), date);
  }
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-10-23', -2), '2026-10-21');
});

test('daysBetween is signed and calendar based', () => {
  assert.equal(daysBetween('2026-10-23', '2026-10-26'), 3);
  assert.equal(daysBetween('2026-10-26', '2026-10-23'), -3);
  assert.equal(daysBetween('2026-10-23', '2026-10-23'), 0);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('formatShortDate is MM-DD', () => {
  assert.equal(formatShortDate('2026-10-07'), '10-07');
  assert.equal(formatShortDate('2026-11-30'), '11-30');
});

test('todayLocal formats local getters without locale', () => {
  const fixed = new Date(2026, 9, 5, 12, 0, 0);
  assert.equal(todayLocal(fixed), '2026-10-05');
  assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});
