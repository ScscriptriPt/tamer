import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HistoryPlan } from './rules.ts';
import type { IdeaBook, Plan, Pool } from './types.ts';
import { addDays, isDateString } from './dates.ts';

const PLAN_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function defaultDataDir(): string {
  return resolve(import.meta.dirname, '..', '..', 'data');
}

export function poolFile(dataDir: string): string {
  return join(dataDir, 'pool.json');
}

export function ideasFile(dataDir: string): string {
  return join(dataDir, 'ideas.json');
}

export function plansDir(dataDir: string): string {
  return join(dataDir, 'plans');
}

export function planFile(dataDir: string, date: string): string {
  if (!isDateString(date)) throw new Error(`无效日期：${date}`);
  return join(plansDir(dataDir), `${date}.json`);
}

function readJsonFile<T>(file: string): T {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`无法读取文件：${file}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`无法解析 JSON：${file}`);
  }
}

/**
 * Deterministic on-disk format: UTF-8, 2-space indent, LF, trailing newline,
 * no BOM. Object key order is the insertion order used by the builders.
 */
export function writeJsonFile(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(file, text, 'utf8');
}

export function readPool(dataDir: string): Pool {
  const data = readJsonFile<Pool>(poolFile(dataDir));
  if (
    data === null ||
    typeof data !== 'object' ||
    !Array.isArray(data.projects)
  ) {
    throw new Error(`pool.json 结构无效：${poolFile(dataDir)}`);
  }
  return data;
}

export function writePool(dataDir: string, pool: Pool): void {
  writeJsonFile(poolFile(dataDir), pool);
}

export function readPlan(dataDir: string, date: string): Plan | null {
  const file = planFile(dataDir, date);
  if (!existsSync(file)) return null;
  return readJsonFile<Plan>(file);
}

export function writePlan(dataDir: string, plan: Plan): void {
  writeJsonFile(planFile(dataDir, plan.date), plan);
}

export function listPlanDates(dataDir: string): string[] {
  const dir = plansDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && PLAN_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort();
}

/**
 * Loads exactly the two calendar days before `date` from data/plans/*.json.
 * R2 must consult these files, not in-memory state.
 */
export function readHistory(
  dataDir: string,
  date: string,
  days = 2,
): HistoryPlan[] {
  const history: HistoryPlan[] = [];
  for (let offset = 1; offset <= days; offset += 1) {
    const expectedDate = addDays(date, -offset);
    const plan = readPlan(dataDir, expectedDate);
    if (plan !== null) {
      history.push({ date: expectedDate, blocks: plan.blocks });
    }
  }
  return history;
}

export function readIdeas(dataDir: string): IdeaBook {
  const data = readJsonFile<IdeaBook>(ideasFile(dataDir));
  if (
    data === null ||
    typeof data !== 'object' ||
    !Array.isArray(data.ideas)
  ) {
    throw new Error(`ideas.json 结构无效：${ideasFile(dataDir)}`);
  }
  return data;
}

export function writeIdeas(dataDir: string, book: IdeaBook): void {
  writeJsonFile(ideasFile(dataDir), book);
}

/**
 * Morning rendering must keep working in data dirs that predate ideas.json,
 * so a missing file reads as an empty book. Malformed JSON still throws.
 */
export function readIdeasIfPresent(dataDir: string): IdeaBook {
  if (!existsSync(ideasFile(dataDir))) return { version: 1, ideas: [] };
  return readIdeas(dataDir);
}
