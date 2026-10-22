import type {
  Breakpoint,
  Plan,
  PlanBlock,
  PlanResult,
  PlanResultBlock,
  Pool,
  Project,
  ShelvedEntry,
} from './types.ts';
import { formatShortDate } from './dates.ts';
import {
  r7Actions,
  selectBlocks,
  type HistoryPlan,
  type SelectOptions,
} from './rules.ts';

export const DEFAULT_DO_NOT = ['换笔记软件', '开新项目'];

export type BuildPlanOptions = SelectOptions & {
  /** overrides the action of the first block only */
  actionOverride?: string;
  /** overrides done_when of the first block only */
  doneWhenOverride?: string;
  /** per-project action overrides; fallback is project.next_action, then note */
  actions?: Record<string, string>;
  /** per-project done_when overrides; fallback is project.next_action, then note */
  doneWhenByProject?: Record<string, string>;
  /** per-block action overrides keyed `<project_id>#<occurrence>` (1-based) */
  blockActions?: Record<string, string>;
  /** per-block done_when overrides keyed `<project_id>#<occurrence>` (1-based) */
  blockDoneWhen?: Record<string, string>;
  doNot?: string[];
  risk?: string | null;
  result?: PlanResult | null;
};

/** Copy used when one project takes a second block on the same day. */
export const REPEAT_ACTION = '接着上一块往下做，收手前留一句断点';
export const REPEAT_DONE_WHEN = '能说出这一块和上一块的区别';

export type ReviewInput = {
  block: number;
  done: boolean;
  note?: string | null;
  reviewedAt: string;
};

function poolOrder(pool: Pool): Map<string, number> {
  const order = new Map<string, number>();
  pool.projects.forEach((project, index) => {
    if (!order.has(project.id)) order.set(project.id, index);
  });
  return order;
}

/**
 * Builds the plan.shelved list. Only status=shelved is considered "shelved";
 * paused projects are intentionally not listed. Wake dates sort ascending,
 * projects without a wake date come last, ties follow pool.json order.
 */
export function buildShelved(pool: Pool): ShelvedEntry[] {
  const order = poolOrder(pool);
  return pool.projects
    .filter((project) => project.status === 'shelved')
    .sort((a, b) => {
      const aNull = a.wake_at === null;
      const bNull = b.wake_at === null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (!aNull) {
        if ((a.wake_at as string) < (b.wake_at as string)) return -1;
        if ((a.wake_at as string) > (b.wake_at as string)) return 1;
      }
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    })
    .slice(0, 3)
    .map((project) => ({
      project_id: project.id,
      reason:
        project.wake_at !== null
          ? `${formatShortDate(project.wake_at)} 唤醒`
          : project.note,
    }));
}

function projectById(pool: Pool, id: string): Project | undefined {
  return pool.projects.find((project) => project.id === id);
}

/**
 * Pure plan construction: selection + copy resolution + shelved list + do_not
 * + forced-risk notes.
 *
 * Copy priority is: block-level override > R7 breakpoint (first block of a
 * project only) > project.next_action > project.note.
 * A project's second block on the same day never inherits a breakpoint and
 * would otherwise repeat the first line verbatim, so it gets a fixed "continue
 * from the last block" pair instead.
 */
export function buildPlan(
  pool: Pool,
  date: string,
  options: BuildPlanOptions = {},
): Plan {
  const dayType = options.dayType ?? 'normal';
  if (dayType === 'exception') {
    return {
      date,
      day_type: 'exception',
      blocks: [],
      shelved: [],
      do_not: [],
      risk: null,
      result: null,
    };
  }

  const selection = selectBlocks(pool, date, options);
  const inheritedActions = r7Actions(pool, date, options.history ?? []);
  const occurrences = new Map<string, number>();
  const blocks: PlanBlock[] = selection.blocks.map((slot, index) => {
    const project = projectById(pool, slot.project_id);
    const occurrence = (occurrences.get(slot.project_id) ?? 0) + 1;
    occurrences.set(slot.project_id, occurrence);
    const key = `${slot.project_id}#${occurrence}`;

    const base = project?.next_action ?? project?.note ?? '';
    const projectAction = project ? options.actions?.[project.id] : undefined;
    const projectDoneWhen = project
      ? options.doneWhenByProject?.[project.id]
      : undefined;

    const blockAction = options.blockActions?.[key];
    const blockDoneWhen = options.blockDoneWhen?.[key];

    const explicitAction =
      blockAction ??
      (index === 0 ? options.actionOverride : undefined) ??
      projectAction;
    const explicitDoneWhen =
      blockDoneWhen ??
      (index === 0 ? options.doneWhenOverride : undefined) ??
      projectDoneWhen;
    const inheritedAction =
      occurrence === 1 ? inheritedActions.get(slot.project_id) : undefined;

    if (
      occurrence > 1 &&
      explicitAction === undefined &&
      explicitDoneWhen === undefined
    ) {
      return {
        start: slot.start,
        end: slot.end,
        kind: slot.kind,
        project_id: slot.project_id,
        action: REPEAT_ACTION,
        done_when: REPEAT_DONE_WHEN,
        breakpoint: null,
      };
    }

    return {
      start: slot.start,
      end: slot.end,
      kind: slot.kind,
      project_id: slot.project_id,
      action: explicitAction ?? inheritedAction ?? base,
      done_when: explicitDoneWhen ?? base,
      breakpoint: null,
    };
  });

  const riskParts: string[] = [];
  if (options.risk !== undefined && options.risk !== null && options.risk !== '') {
    riskParts.push(options.risk);
  }
  for (const projectId of selection.forced) {
    riskParts.push(`forced: ${projectId}`);
  }

  return {
    date,
    day_type: 'normal',
    blocks,
    shelved: buildShelved(pool),
    do_not: options.doNot ?? [...DEFAULT_DO_NOT],
    risk: riskParts.length > 0 ? riskParts.join('；') : null,
    result: options.result ?? null,
  };
}

/** A plan with a result must never be overwritten by `plan new`. */
export function canOverwritePlan(plan: Plan | null): boolean {
  return plan === null || plan.result === null;
}

export type BreakpointInput = {
  block: number;
  did: string;
  stuck?: string | null;
  next: string;
  at: string;
};

/**
 * Records the single breakpoint of one block, replacing any earlier one.
 * The timestamp is passed in by the caller, so this function stays pure and
 * clock-free. Exception days have no blocks and therefore no breakpoints.
 */
export function applyBreakpoint(
  plan: Plan,
  input: BreakpointInput,
): Plan | null {
  if (plan.day_type === 'exception') return null;
  const index = input.block - 1;
  if (!Number.isInteger(index) || index < 0 || index >= plan.blocks.length) {
    throw new Error(`块号超出范围：${input.block}（本日共 ${plan.blocks.length} 块）`);
  }

  const breakpoint: Breakpoint = {
    at: input.at,
    did: input.did,
    stuck: input.stuck ?? null,
    next: input.next,
  };

  const blocks = plan.blocks.map((block, blockIndex) =>
    blockIndex === index ? { ...block, breakpoint } : block,
  );

  return { ...plan, blocks };
}

/**
 * Applies one evening review answer. The result.blocks array stays aligned
 * with plan.blocks, so a repeated project (R1a double block) is unambiguous.
 * Returns null for exception days (R5).
 */
export function applyReview(plan: Plan, input: ReviewInput): Plan | null {
  if (plan.day_type === 'exception') return null;
  const index = input.block - 1;
  if (!Number.isInteger(index) || index < 0 || index >= plan.blocks.length) {
    throw new Error(`块号超出范围：${input.block}（本日共 ${plan.blocks.length} 块）`);
  }

  const previous: PlanResultBlock[] = plan.result?.blocks ?? [];
  const blocks: PlanResultBlock[] = plan.blocks.map((block, blockIndex) => {
    if (blockIndex === index) {
      return {
        project_id: block.project_id,
        done: input.done,
        note: input.note ?? null,
      };
    }
    const old = previous[blockIndex];
    if (old !== undefined && old.project_id === block.project_id) {
      return {
        project_id: old.project_id,
        done: old.done,
        note: old.note,
      };
    }
    return { project_id: block.project_id, done: false, note: null };
  });

  return {
    ...plan,
    result: {
      reviewed_at: input.reviewedAt,
      blocks,
    },
  };
}
