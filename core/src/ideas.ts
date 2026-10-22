import type {
  Idea,
  IdeaBook,
  IdeaState,
  Pool,
  Project,
  ProjectKind,
} from './types.ts';
import { addDays, isDateString, parseDate } from './dates.ts';

export type AddIdeaResult = {
  book: IdeaBook;
  idea: Idea;
  added: boolean;
};

export type AddIdeaOptions = {
  /** increment this existing idea instead of creating a new one */
  sameId?: string;
  /** already-resolved YYYY-MM-DD; also moves the idea to state=wake */
  wakeAt?: string | null;
};

export type IdeaMutation = {
  book: IdeaBook;
  idea: Idea;
};

export const IDEA_STATES: readonly IdeaState[] = [
  'graveyard',
  'explore',
  'wake',
  'promoted',
  'discarded',
];

/** R8: the same idea must show up three times before it may be promoted. */
export const PROMOTE_THRESHOLD = 3;

/** R9: at most two active projects of each kind. */
export const MAX_ACTIVE: Record<ProjectKind, number> = {
  main: 2,
  side: 2,
};

const WAKE_SOURCES: readonly IdeaState[] = ['graveyard', 'wake'];
const DISCARD_SOURCES: readonly IdeaState[] = [
  'graveyard',
  'wake',
  'discarded',
];

export function nextIdeaId(ideas: Idea[], capturedAt: string): string {
  const compact = capturedAt.replaceAll('-', '');
  const prefix = `idea-${compact}-`;
  let next = 1;
  for (const idea of ideas) {
    if (!idea.id.startsWith(prefix)) continue;
    const suffix = Number(idea.id.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix >= next) next = suffix + 1;
  }
  return `${prefix}${next}`;
}

/** R10: due means state=wake and wake_at <= today, both ends included. */
export function isDue(idea: Idea, today: string): boolean {
  return (
    idea.state === 'wake' &&
    idea.wake_at !== null &&
    idea.wake_at <= today
  );
}

/** Due ideas, oldest wake date first; ties keep ideas.json order. */
export function dueIdeas(book: IdeaBook, today: string): Idea[] {
  if (!isDateString(today)) throw new Error(`无效日期：${today}`);
  return book.ideas
    .filter((idea) => isDue(idea, today))
    .sort((a, b) => {
      const left = a.wake_at as string;
      const right = b.wake_at as string;
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
}

export type IdeaFilter = {
  state?: IdeaState;
  due?: boolean;
  today?: string;
};

export function filterIdeas(book: IdeaBook, filter: IdeaFilter = {}): Idea[] {
  let ideas = book.ideas;
  if (filter.state !== undefined) {
    ideas = ideas.filter((idea) => idea.state === filter.state);
  }
  if (filter.due === true) {
    const today = filter.today;
    if (today === undefined) throw new Error('列出到期想法需要 today');
    ideas = ideas.filter((idea) => isDue(idea, today));
  }
  return ideas;
}

function findIdea(book: IdeaBook, id: string): Idea {
  const idea = book.ideas.find((candidate) => candidate.id === id);
  if (idea === undefined) throw new Error(`没有找到想法：${id}`);
  return idea;
}

function replaceIdea(book: IdeaBook, updated: Idea): IdeaBook {
  return {
    ...book,
    ideas: book.ideas.map((idea) => (idea.id === updated.id ? updated : idea)),
  };
}

function assertCanWake(idea: Idea): void {
  if (!WAKE_SOURCES.includes(idea.state)) {
    throw new Error(`非法状态迁移：${idea.state} → wake（${idea.id}）`);
  }
}

function assertCanDiscard(idea: Idea): void {
  if (!DISCARD_SOURCES.includes(idea.state)) {
    throw new Error(`非法状态迁移：${idea.state} → discarded（${idea.id}）`);
  }
}

/**
 * Resolves `--wake 7|30|YYYY-MM-DD` against a caller-supplied today. Pure:
 * the CLI owns the clock, so this function is testable without faking time.
 */
export function resolveWakeAt(raw: string, today: string): string {
  if (!isDateString(today)) throw new Error(`无效日期：${today}`);
  if (/^\d+$/.test(raw)) {
    const days = Number(raw);
    if (!Number.isSafeInteger(days) || days <= 0) {
      throw new Error(`无效的 --wake：${raw}（要求 7、30 或 YYYY-MM-DD）`);
    }
    return addDays(today, days);
  }
  if (!isDateString(raw)) {
    throw new Error(`无效的 --wake：${raw}（要求 7、30 或 YYYY-MM-DD）`);
  }
  return raw;
}

/**
 * Pure capture. Without `sameId` every call is a new idea (semantic dedupe is
 * the caller's job); with `sameId` only occurrences changes, so `text` and
 * `captured_at` are never overwritten.
 */
export function addIdea(
  book: IdeaBook,
  text: string,
  capturedAt: string,
  options: AddIdeaOptions = {},
): AddIdeaResult {
  if (!isDateString(capturedAt)) throw new Error(`无效日期：${capturedAt}`);
  const wakeAt = options.wakeAt ?? null;
  if (wakeAt !== null && !isDateString(wakeAt)) {
    throw new Error(`无效日期：${wakeAt}`);
  }
  const trimmed = text.trim();

  if (options.sameId !== undefined) {
    const existing = findIdea(book, options.sameId);
    if (wakeAt !== null) assertCanWake(existing);
    const updated: Idea = {
      ...existing,
      occurrences: existing.occurrences + 1,
      ...(wakeAt !== null ? { state: 'wake' as const, wake_at: wakeAt } : {}),
    };
    return {
      book: replaceIdea(book, updated),
      idea: updated,
      added: false,
    };
  }

  if (trimmed.length === 0) throw new Error('想法不能为空');
  const idea: Idea = {
    id: nextIdeaId(book.ideas, capturedAt),
    text: trimmed,
    captured_at: capturedAt,
    state: wakeAt !== null ? 'wake' : 'graveyard',
    occurrences: 1,
    wake_at: wakeAt,
    reason: null,
  };

  return {
    book: { ...book, ideas: [...book.ideas, idea] },
    idea,
    added: true,
  };
}

/** R11: graveyard|wake → wake. Same-state calls reschedule instead. */
export function markIdeaWake(
  book: IdeaBook,
  id: string,
  wakeAt: string,
): IdeaMutation {
  if (!isDateString(wakeAt)) throw new Error(`无效日期：${wakeAt}`);
  const existing = findIdea(book, id);
  assertCanWake(existing);
  const updated: Idea = { ...existing, state: 'wake', wake_at: wakeAt };
  return { book: replaceIdea(book, updated), idea: updated };
}

/** R11: graveyard|wake → discarded. A repeated discard updates the reason. */
export function discardIdea(
  book: IdeaBook,
  id: string,
  reason: string,
): IdeaMutation {
  const trimmed = reason.trim();
  if (trimmed.length === 0) throw new Error('丢弃原因不能为空');
  const existing = findIdea(book, id);
  assertCanDiscard(existing);
  const updated: Idea = {
    ...existing,
    state: 'discarded',
    reason: trimmed,
  };
  return { book: replaceIdea(book, updated), idea: updated };
}

export type PromoteOptions = {
  kind?: ProjectKind;
  deadline?: string | null;
  /** one concrete action that can start within 90 minutes; required */
  next: string;
  /** caller-supplied date used for last_touched; core never reads a clock */
  today: string;
};

export type PromoteOutcome =
  | {
      ok: true;
      book: IdeaBook;
      pool: Pool;
      idea: Idea;
      project: Project;
    }
  | { ok: false; reason: 'occurrences'; missing: number }
  | {
      ok: false;
      reason: 'quota';
      kind: ProjectKind;
      limit: number;
      active: number;
    };

/**
 * R8 + R9 + R11: promotes a proven idea into pool.json with the idea id.
 * Returns a discriminated result for the two rule failures; illegal states
 * and unknown ids throw, which the CLI maps to exit 1.
 */
export function promoteIdea(
  book: IdeaBook,
  pool: Pool,
  id: string,
  options: PromoteOptions,
): PromoteOutcome {
  if (!isDateString(options.today)) {
    throw new Error(`无效日期：${options.today}`);
  }
  const kind: ProjectKind = options.kind ?? 'side';
  const deadline = options.deadline ?? null;
  if (deadline !== null) parseDate(deadline);

  const existing = findIdea(book, id);
  if (!WAKE_SOURCES.includes(existing.state)) {
    throw new Error(`非法状态迁移：${existing.state} → promoted（${id}）`);
  }

  const missing = PROMOTE_THRESHOLD - existing.occurrences;
  if (missing > 0) return { ok: false, reason: 'occurrences', missing };

  if (pool.projects.some((project) => project.id === id)) {
    throw new Error(`项目已存在：${id}`);
  }

  const limit = MAX_ACTIVE[kind];
  const active = pool.projects.filter(
    (project) => project.kind === kind && project.status === 'active',
  ).length;
  if (active >= limit) {
    return { ok: false, reason: 'quota', kind, limit, active };
  }

  const project: Project = {
    id: existing.id,
    title: existing.text,
    kind,
    status: 'active',
    deadline,
    wake_at: null,
    last_touched: options.today,
    note: existing.text,
    next_action: options.next,
  };
  const idea: Idea = { ...existing, state: 'promoted' };

  return {
    ok: true,
    book: replaceIdea(book, idea),
    pool: { ...pool, projects: [...pool.projects, project] },
    idea,
    project,
  };
}
