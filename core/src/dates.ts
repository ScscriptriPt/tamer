const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MS_PER_DAY = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

/**
 * Strictly parses YYYY-MM-DD. Invalid calendar dates (e.g. 2026-02-30) throw.
 */
export function parseDate(date: string): DateParts {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new Error(`无效日期：${String(date)}（要求 YYYY-MM-DD）`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`无效日期：${date}（该日期不存在）`);
  }
  return { year, month, day };
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Strict local wall-clock time, HH:MM, 00:00–23:59. */
export function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function toDayNumber(date: string): number {
  const { year, month, day } = parseDate(date);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromDayNumber(dayNumber: number): string {
  const date = new Date(dayNumber * MS_PER_DAY);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function formatShortDate(date: string): string {
  const { month, day } = parseDate(date);
  return `${pad(month)}-${pad(day)}`;
}

/**
 * Local calendar date. Uses local getters deliberately: "today" is a local
 * concept, while every stored/rendered date is a plain YYYY-MM-DD string.
 */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local wall-clock time as HH:MM; the CLI is the only caller that reads the clock. */
export function timeLocal(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
