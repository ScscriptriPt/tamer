import type { BlockKind, DayType, Plan, Project, Pool } from './types.ts';
import { addDays, daysBetween } from './dates.ts';

export const DEADLINE_WINDOW_DAYS = 30;
export const HIGH_RISK_WINDOW_DAYS = 7;
export const MAX_BLOCKS = 3;
export const MAX_MAIN_BLOCKS = 2;

export type HistoryPlan = Pick<Plan, 'date' | 'blocks'>;

/**
 * R7: the action each project inherits from its newest breakpoint inside the
 * `date-1` / `date-2` window. Pure: history comes from store.readHistory, so
 * this function never touches the disk or the clock.
 *
 * "Newest" compares the plan date first, then the block number on the same
 * date (the later block is closer to the breakpoint being written).
 */
export function r7Actions(
  pool: Pool,
  date: string,
  history: HistoryPlan[],
): Map<string, string> {
  const dayOffset = new Map<string, number>([
    [addDays(date, -1), 1],
    [addDays(date, -2), 2],
  ]);
  type Best = { day: number; block: number; next: string };
  const best = new Map<string, Best>();

  for (const entry of history) {
    const day = dayOffset.get(entry.date);
    if (day === undefined) continue;
    entry.blocks.forEach((block, index) => {
      const breakpoint = block.breakpoint;
      if (!breakpoint || breakpoint.next.trim() === '') return;
      const candidate: Best = { day, block: index + 1, next: breakpoint.next };
      const current = best.get(block.project_id);
      if (
        current === undefined ||
        candidate.day < current.day ||
        (candidate.day === current.day && candidate.block > current.block)
      ) {
        best.set(block.project_id, candidate);
      }
    });
  }

  const actions = new Map<string, string>();
  for (const project of pool.projects) {
    const found = best.get(project.id);
    if (found !== undefined) actions.set(project.id, found.next);
  }
  return actions;
}

export type BlockSlot = {
  start: string;
  end: string;
  kind: BlockKind;
  project_id: string;
};

export type Selection = {
  blocks: BlockSlot[];
  /** project ids that R2 had to let through because there was no alternative */
  forced: string[];
};

export type SelectOptions = {
  dayType?: DayType;
  history?: HistoryPlan[];
};

const MAIN_SLOTS = [
  { start: '09:00', end: '10:30' },
  { start: '10:45', end: '11:45' },
];

const SIDE_SLOT = { start: '14:00', end: '15:00' };

function poolOrder(pool: Pool): Map<string, number> {
  const order = new Map<string, number>();
  pool.projects.forEach((project, index) => {
    if (!order.has(project.id)) order.set(project.id, index);
  });
  return order;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isActiveMain(project: Project): boolean {
  return project.kind === 'main' && project.status === 'active';
}

/** Days from `date` to the project's deadline. null when there is no deadline. */
export function deadlineDays(project: Project, date: string): number | null {
  if (project.deadline === null) return null;
  return daysBetween(date, project.deadline);
}

/** R1: active main projects whose deadline is today .. today+30 inclusive. */
export function r1Candidates(pool: Pool, date: string): Project[] {
  const order = poolOrder(pool);
  return pool.projects
    .filter((project) => {
      if (!isActiveMain(project)) return false;
      const days = deadlineDays(project, date);
      return days !== null && days >= 0 && days <= DEADLINE_WINDOW_DAYS;
    })
    .sort((a, b) => {
      const byDeadline = compareStrings(a.deadline as string, b.deadline as string);
      if (byDeadline !== 0) return byDeadline;
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });
}

/** R1a: a main project with a deadline within 7 days may occupy two main blocks. */
export function isHighRisk(project: Project, date: string): boolean {
  const days = deadlineDays(project, date);
  return days !== null && days >= 0 && days <= HIGH_RISK_WINDOW_DAYS;
}

export function mainBlockAllowance(project: Project, date: string): number {
  return isHighRisk(project, date) ? MAX_MAIN_BLOCKS : 1;
}

/**
 * R2: counts how many of the immediately preceding calendar days contain the
 * project. Stops at the first missing/non-matching day. Max returned is 2.
 */
export function consecutiveAppearances(
  projectId: string,
  date: string,
  history: HistoryPlan[],
): number {
  let count = 0;
  for (let offset = 1; offset <= 2; offset += 1) {
    const expectedDate = addDays(date, -offset);
    const plan = history.find((candidate) => candidate.date === expectedDate);
    if (plan === undefined) break;
    if (!plan.blocks.some((block) => block.project_id === projectId)) break;
    count += 1;
  }
  return count;
}

export function isR2Blocked(
  projectId: string,
  date: string,
  history: HistoryPlan[],
): boolean {
  return consecutiveAppearances(projectId, date, history) >= 2;
}

function compareLastTouchedAsc(
  a: Project,
  b: Project,
  order: Map<string, number>,
): number {
  const aNull = a.last_touched === null;
  const bNull = b.last_touched === null;
  if (aNull !== bNull) return aNull ? -1 : 1;
  if (!aNull) {
    const byDate = compareStrings(a.last_touched as string, b.last_touched as string);
    if (byDate !== 0) return byDate;
  }
  return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
}

function compareLastTouchedDesc(
  a: Project,
  b: Project,
  order: Map<string, number>,
): number {
  const aNull = a.last_touched === null;
  const bNull = b.last_touched === null;
  if (aNull !== bNull) return aNull ? 1 : -1;
  if (!aNull) {
    const byDate = compareStrings(b.last_touched as string, a.last_touched as string);
    if (byDate !== 0) return byDate;
  }
  return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
}

/**
 * R3: remaining active main projects, least recently touched first; null
 * last_touched counts as the oldest, ties follow pool.json order.
 */
export function r3Candidates(
  pool: Pool,
  date: string,
  exclude: ReadonlySet<string> = new Set(),
): Project[] {
  const order = poolOrder(pool);
  const r1Ids = new Set(r1Candidates(pool, date).map((project) => project.id));
  return pool.projects
    .filter(
      (project) =>
        isActiveMain(project) &&
        !r1Ids.has(project.id) &&
        !exclude.has(project.id),
    )
    .sort((a, b) => compareLastTouchedAsc(a, b, order));
}

/**
 * R4 ordering. First tier: active sides with 0 < progress < 1, most recently
 * touched first. Second tier: the rest, least recently touched first.
 * This function only orders candidates; R2 filtering happens in selectBlocks.
 */
export function r4Candidates(pool: Pool): Project[] {
  const order = poolOrder(pool);
  const sides = pool.projects.filter(
    (project) => project.kind === 'side' && project.status === 'active',
  );
  const started = sides
    .filter(
      (project) =>
        project.progress != null && project.progress > 0 && project.progress < 1,
    )
    .sort((a, b) => compareLastTouchedDesc(a, b, order));
  const startedIds = new Set(started.map((project) => project.id));
  const rest = sides
    .filter((project) => !startedIds.has(project.id))
    .sort((a, b) => compareLastTouchedAsc(a, b, order));
  return [...started, ...rest];
}

function makeMainSlot(project: Project, slotIndex: number): BlockSlot {
  const slot = MAIN_SLOTS[slotIndex];
  return {
    start: slot.start,
    end: slot.end,
    kind: 'main',
    project_id: project.id,
  };
}

function pickSide(
  pool: Pool,
  date: string,
  history: HistoryPlan[],
): Project | null {
  for (const project of r4Candidates(pool)) {
    if (!isR2Blocked(project.id, date, history)) return project;
  }
  return null;
}

/**
 * Pure selection of 0-3 block slots for a day. R1/R1a/R2/R3/R4/R5/R6 are all
 * evaluated here in priority order. No file or clock access.
 */
export function selectBlocks(
  pool: Pool,
  date: string,
  options: SelectOptions = {},
): Selection {
  const dayType = options.dayType ?? 'normal';
  if (dayType === 'exception') {
    return { blocks: [], forced: [] };
  }

  const history = options.history ?? [];
  const mainCandidates = [
    ...r1Candidates(pool, date),
    ...r3Candidates(pool, date),
  ];

  const blockedCache = new Map<string, boolean>();
  const isBlocked = (project: Project): boolean => {
    const cached = blockedCache.get(project.id);
    if (cached !== undefined) return cached;
    const blocked = isR2Blocked(project.id, date, history);
    blockedCache.set(project.id, blocked);
    return blocked;
  };

  const picked: BlockSlot[] = [];
  const chosen = new Set<string>();
  const forced: string[] = [];

  for (const project of mainCandidates) {
    if (picked.length >= MAX_MAIN_BLOCKS) break;
    if (chosen.has(project.id)) continue;

    if (isBlocked(project)) {
      // The R2 exception is only for R1a high-risk mains, and only when no
      // other usable main project exists.
      const hasAlternative = mainCandidates.some(
        (other) => other.id !== project.id && !isBlocked(other),
      );
      if (!isHighRisk(project, date) || hasAlternative) continue;
      forced.push(project.id);
    }

    picked.push(makeMainSlot(project, picked.length));
    chosen.add(project.id);

    if (isHighRisk(project, date) && picked.length < MAX_MAIN_BLOCKS) {
      picked.push(makeMainSlot(project, picked.length));
    }
  }

  const side = pickSide(pool, date, history);
  if (side !== null && picked.length < MAX_BLOCKS) {
    picked.push({
      start: SIDE_SLOT.start,
      end: SIDE_SLOT.end,
      kind: 'side',
      project_id: side.id,
    });
  }

  return { blocks: picked, forced };
}
