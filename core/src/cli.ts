import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDateString, parseDate, todayLocal } from './dates.ts';
import {
  IDEA_STATES,
  addIdea,
  discardIdea,
  dueIdeas,
  filterIdeas,
  markIdeaWake,
  promoteIdea,
  resolveWakeAt,
} from './ideas.ts';
import {
  applyBreakpoint,
  applyReview,
  buildPlan,
  canOverwritePlan,
} from './plan.ts';
import { renderEvening, renderMorning } from './render.ts';
import * as store from './store.ts';
import type {
  DayType,
  Idea,
  IdeaState,
  Plan,
  Pool,
  ProjectKind,
} from './types.ts';

type FlagValue = string | boolean | string[];

type ParsedArgs = {
  positionals: string[];
  flags: Record<string, FlagValue>;
};

class CliError extends Error {
  exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

const USAGE = `用法：
  node core/src/cli.ts plan new --date YYYY-MM-DD [--day-type normal|exception] [--exception] [--action "整体动作"] [--action 项目#N="该块动作"]
  node core/src/cli.ts plan show --date YYYY-MM-DD
  node core/src/cli.ts plan render --morning --date YYYY-MM-DD
  node core/src/cli.ts plan render --evening --step 1|2 --date YYYY-MM-DD
  node core/src/cli.ts plan review --date YYYY-MM-DD --block N [--done|--undone] [--note 文本]
  node core/src/cli.ts plan breakpoint --date YYYY-MM-DD --block N --did "做了什么" [--stuck "卡在哪"] --next "下一步动作" [--at 时间戳]
  node core/src/cli.ts idea add "想法" [--same <id>] [--wake 7|30|YYYY-MM-DD] [--date YYYY-MM-DD]
  node core/src/cli.ts idea list [--state graveyard|explore|wake|promoted|discarded] [--due] [--date YYYY-MM-DD]
  node core/src/cli.ts idea wake <id> --at YYYY-MM-DD
  node core/src/cli.ts idea promote <id> [--kind main|side] [--deadline YYYY-MM-DD]
  node core/src/cli.ts idea discard <id> --reason "一句话"
可选：--data-dir <目录>（默认 E:\\驯兽师\\data）
逐块文案：#N 表示当天该项目的第 N 块，例如 --action microwave#1="翻目录"；逐块优先于整体。`;

function setFlag(
  flags: Record<string, FlagValue>,
  name: string,
  value: string | boolean,
): void {
  const previous = flags[name];
  if (previous === undefined) {
    flags[name] = value;
    return;
  }
  if (Array.isArray(previous)) {
    previous.push(String(value));
    return;
  }
  flags[name] = [String(previous), String(value)];
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const body = arg.slice(2);
    if (body.length === 0) throw new CliError('无效参数：--');
    const equals = body.indexOf('=');
    if (equals >= 0) {
      setFlag(flags, body.slice(0, equals), body.slice(equals + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      setFlag(flags, body, next);
      index += 1;
    } else {
      setFlag(flags, body, true);
    }
  }

  return { positionals, flags };
}

function stringFlag(
  flags: Record<string, FlagValue>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new CliError(`--${name} 需要一个值`);
  return value;
}

function arrayFlag(
  flags: Record<string, FlagValue>,
  name: string,
): string[] | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  throw new CliError(`--${name} 需要一个值`);
}

function boolFlag(flags: Record<string, FlagValue>, name: string): boolean {
  const value = flags[name];
  return value === true || value === 'true';
}

const BLOCK_COPY_PATTERN = /^([A-Za-z0-9_-]+)#([1-9]\d*)=([\s\S]*)$/;

/**
 * Splits `--action` values into the whole-plan override and per-block copies.
 * `--action "整体"` sets the first block; `--action microwave#2="..."` targets
 * the second block that belongs to microwave that day.
 */
function splitCopyFlags(values: string[] | undefined): {
  whole: string | undefined;
  blocks: Record<string, string>;
} {
  const blocks: Record<string, string> = {};
  let whole: string | undefined;
  for (const value of values ?? []) {
    const match = BLOCK_COPY_PATTERN.exec(value);
    if (match === null) {
      whole = value;
      continue;
    }
    blocks[`${match[1]}#${match[2]}`] = match[3];
  }
  return { whole, blocks };
}

function dateFlag(flags: Record<string, FlagValue>): string {
  const raw = stringFlag(flags, 'date');
  if (raw === undefined) return todayLocal();
  parseDate(raw);
  return raw;
}

function dayTypeFlag(flags: Record<string, FlagValue>): DayType {
  const raw = stringFlag(flags, 'day-type');
  if (raw !== undefined) {
    if (raw === 'normal' || raw === 'exception') return raw;
    throw new CliError(`--day-type 只能是 normal 或 exception：${raw}`);
  }
  return boolFlag(flags, 'exception') ? 'exception' : 'normal';
}

function requirePlan(dataDir: string, date: string) {
  const plan = store.readPlan(dataDir, date);
  if (plan === null) throw new CliError(`没有找到计划：${date}`);
  return plan;
}

function writeText(text: string): void {
  if (text.length === 0) return;
  process.stdout.write(`${text}\n`);
}

/**
 * Morning text for one plan date. The plan date is also the notion of
 * "today" for due wake-ups, so rendering is deterministic and never reads the
 * system clock.
 */
function morningText(dataDir: string, plan: Plan, pool: Pool): string {
  const due = dueIdeas(store.readIdeasIfPresent(dataDir), plan.date);
  return renderMorning(plan, pool, { due, today: plan.date });
}

function planNew(
  dataDir: string,
  flags: Record<string, FlagValue>,
): number {
  const date = dateFlag(flags);
  const dayType = dayTypeFlag(flags);
  const pool = store.readPool(dataDir);
  const existing = store.readPlan(dataDir, date);

  if (!canOverwritePlan(existing)) {
    process.stderr.write(`拒绝覆盖：${date} 的计划已有 result\n`);
    return 2;
  }

  const history = store.readHistory(dataDir, date, 2);
  const actionCopy = splitCopyFlags(arrayFlag(flags, 'action'));
  const doneWhenCopy = splitCopyFlags(arrayFlag(flags, 'done-when'));
  const plan = buildPlan(pool, date, {
    dayType,
    history,
    actionOverride: actionCopy.whole,
    doneWhenOverride: doneWhenCopy.whole,
    blockActions: actionCopy.blocks,
    blockDoneWhen: doneWhenCopy.blocks,
    doNot: arrayFlag(flags, 'do-not'),
    risk: stringFlag(flags, 'risk'),
  });

  store.writePlan(dataDir, plan);
  writeText(morningText(dataDir, plan, pool));
  return 0;
}

function planShow(
  dataDir: string,
  flags: Record<string, FlagValue>,
): number {
  const date = dateFlag(flags);
  const plan = requirePlan(dataDir, date);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return 0;
}

function planRender(
  dataDir: string,
  flags: Record<string, FlagValue>,
): number {
  const date = dateFlag(flags);
  const plan = requirePlan(dataDir, date);
  const morning = boolFlag(flags, 'morning');
  const evening = boolFlag(flags, 'evening');

  if (morning && evening) {
    throw new CliError('--morning 和 --evening 只能选一个');
  }

  if (evening) {
    const rawStep = stringFlag(flags, 'step');
    if (rawStep === undefined) {
      throw new CliError('--evening 需要 --step 1 或 2');
    }
    const step = Number(rawStep);
    if (step === 1) {
      writeText(renderEvening(plan, 1));
      return 0;
    }
    if (step === 2) {
      writeText(renderEvening(plan, 2));
      return 0;
    }
    throw new CliError(`--step 只能是 1 或 2：${rawStep}`);
  }

  const pool = store.readPool(dataDir);
  writeText(morningText(dataDir, plan, pool));
  return 0;
}

function planReview(
  dataDir: string,
  flags: Record<string, FlagValue>,
): number {
  const date = dateFlag(flags);
  const rawBlock = stringFlag(flags, 'block');
  if (rawBlock === undefined) {
    throw new CliError('plan review 需要 --block <序号>');
  }
  const block = Number(rawBlock);
  if (!Number.isInteger(block) || block < 1) {
    throw new CliError(`--block 需要正整数：${rawBlock}`);
  }

  const doneFlag = boolFlag(flags, 'done');
  const undoneFlag = boolFlag(flags, 'undone') || boolFlag(flags, 'not-done');
  if (doneFlag && undoneFlag) {
    throw new CliError('--done 和 --undone 不能同时使用');
  }

  const plan = requirePlan(dataDir, date);
  const reviewedAt = stringFlag(flags, 'at') ?? new Date().toISOString();
  const updated = applyReview(plan, {
    block,
    done: doneFlag,
    note: stringFlag(flags, 'note') ?? null,
    reviewedAt,
  });
  if (updated === null) {
    throw new CliError('例外日不产生验收结果');
  }

  store.writePlan(dataDir, updated);
  process.stdout.write(
    `已记录：第 ${block} 块 ${doneFlag ? '完成' : '未完成'}\n`,
  );
  return 0;
}

function planBreakpoint(
  dataDir: string,
  flags: Record<string, FlagValue>,
): number {
  const date = dateFlag(flags);
  const rawBlock = stringFlag(flags, 'block');
  if (rawBlock === undefined) {
    throw new CliError('plan breakpoint 需要 --block <序号>');
  }
  const block = Number(rawBlock);
  if (!Number.isInteger(block) || block < 1) {
    throw new CliError(`--block 需要正整数：${rawBlock}`);
  }

  const did = stringFlag(flags, 'did');
  if (did === undefined || did.trim() === '') {
    throw new CliError('plan breakpoint 需要 --did <做了什么>');
  }
  const next = stringFlag(flags, 'next');
  if (next === undefined || next.trim() === '') {
    throw new CliError('plan breakpoint 需要 --next <下一步动作>');
  }
  const rawStuck = stringFlag(flags, 'stuck');
  const stuck = rawStuck === undefined || rawStuck.trim() === '' ? null : rawStuck;
  const at = stringFlag(flags, 'at') ?? new Date().toISOString();

  const plan = requirePlan(dataDir, date);
  const updated = applyBreakpoint(plan, { block, did, stuck, next, at });
  if (updated === null) {
    throw new CliError(`例外日没有块：${date}`);
  }

  store.writePlan(dataDir, updated);
  process.stdout.write(`已记录断点：第 ${block} 块\n`);
  return 0;
}

function ideaById(positionals: string[]): string {
  const id = positionals[2];
  if (id === undefined || id.trim() === '') {
    throw new CliError(`idea ${positionals[1]} 需要 <id>`);
  }
  return id;
}

function ideaAdd(
  dataDir: string,
  positionals: string[],
  flags: Record<string, FlagValue>,
): number {
  const capturedAt = dateFlag(flags);
  const sameId = stringFlag(flags, 'same');
  let text = positionals.slice(2).join(' ').trim();
  const book = store.readIdeas(dataDir);

  // `--same` only touches occurrences, so the text is optional; reuse the
  // stored text rather than overwriting it.
  if (sameId !== undefined && text.length === 0) {
    const existing = book.ideas.find((idea) => idea.id === sameId);
    if (existing === undefined) throw new CliError(`没有找到想法：${sameId}`);
    text = existing.text;
  }
  if (text.length === 0) throw new CliError('idea add 需要一个想法文本');

  const rawWake = stringFlag(flags, 'wake');
  const wakeAt =
    rawWake === undefined ? null : resolveWakeAt(rawWake, capturedAt);

  const result = addIdea(book, text, capturedAt, { sameId, wakeAt });
  store.writeIdeas(dataDir, result.book);
  const suffix = result.added ? '' : `（第 ${result.idea.occurrences} 次）`;
  process.stdout.write(`已记录：${result.idea.id}${suffix}\n`);
  return 0;
}

function writeIdeaLines(ideas: Idea[]): void {
  for (const idea of ideas) {
    const wake = idea.wake_at === null ? '' : `，${idea.wake_at} 唤醒`;
    const occurrences = idea.occurrences > 1 ? ` ×${idea.occurrences}` : '';
    process.stdout.write(
      `- [${idea.state}] ${idea.text}（${idea.captured_at}${wake}${occurrences}）\n`,
    );
  }
}

function ideaList(
  dataDir: string,
  flags: Record<string, FlagValue>,
): number {
  const rawState = stringFlag(flags, 'state');
  let state: IdeaState | undefined;
  if (rawState !== undefined) {
    if (!IDEA_STATES.includes(rawState as IdeaState)) {
      throw new CliError(
        `--state 只能是 ${IDEA_STATES.join('|')}：${rawState}`,
      );
    }
    state = rawState as IdeaState;
  }

  const book = store.readIdeas(dataDir);
  const ideas = filterIdeas(book, {
    state,
    due: boolFlag(flags, 'due'),
    today: dateFlag(flags),
  });
  writeIdeaLines(ideas);
  return 0;
}

function ideaWake(
  dataDir: string,
  positionals: string[],
  flags: Record<string, FlagValue>,
): number {
  const id = ideaById(positionals);
  const at = stringFlag(flags, 'at');
  if (at === undefined) throw new CliError('idea wake 需要 --at YYYY-MM-DD');
  if (!isDateString(at)) throw new CliError(`无效日期：${at}（要求 YYYY-MM-DD）`);

  const book = store.readIdeas(dataDir);
  const result = markIdeaWake(book, id, at);
  store.writeIdeas(dataDir, result.book);
  process.stdout.write(`已更新：${result.idea.id}，${at} 唤醒\n`);
  return 0;
}

function ideaPromote(
  dataDir: string,
  positionals: string[],
  flags: Record<string, FlagValue>,
): number {
  const id = ideaById(positionals);

  const rawKind = stringFlag(flags, 'kind');
  let kind: ProjectKind = 'side';
  if (rawKind !== undefined) {
    if (rawKind !== 'main' && rawKind !== 'side') {
      throw new CliError(`--kind 只能是 main 或 side：${rawKind}`);
    }
    kind = rawKind;
  }

  const deadline = stringFlag(flags, 'deadline') ?? null;
  if (deadline !== null) parseDate(deadline);

  const today = dateFlag(flags);
  const book = store.readIdeas(dataDir);
  const pool = store.readPool(dataDir);
  const outcome = promoteIdea(book, pool, id, { kind, deadline, today });

  if (!outcome.ok) {
    if (outcome.reason === 'occurrences') {
      // R8
      process.stderr.write(`还差 ${outcome.missing} 次才能升级\n`);
      return 3;
    }
    // R9
    process.stderr.write(
      `名额已满：${outcome.kind} 已有 ${outcome.active} 个 active（上限 ${outcome.limit}），先 discard 或替换现有项目\n`,
    );
    return 4;
  }

  store.writeIdeas(dataDir, outcome.book);
  store.writePool(dataDir, outcome.pool);
  process.stdout.write(
    `已升级：${outcome.project.id} → ${outcome.project.kind}（已写入 pool.json）\n`,
  );
  return 0;
}

function ideaDiscard(
  dataDir: string,
  positionals: string[],
  flags: Record<string, FlagValue>,
): number {
  const id = ideaById(positionals);
  const rawReason = stringFlag(flags, 'reason');
  if (rawReason === undefined || rawReason.trim() === '') {
    throw new CliError('idea discard 需要 --reason "一句话"');
  }

  const book = store.readIdeas(dataDir);
  const result = discardIdea(book, id, rawReason);
  store.writeIdeas(dataDir, result.book);
  process.stdout.write(`已丢弃：${result.idea.id}（${rawReason.trim()}）\n`);
  return 0;
}

function main(argv: string[]): number {
  const { positionals, flags } = parseArgv(argv);
  const dataDirRaw = stringFlag(flags, 'data-dir');
  const dataDir =
    dataDirRaw === undefined ? store.defaultDataDir() : resolve(dataDirRaw);

  const [scope, command] = positionals;

  if (scope === 'plan') {
    if (command === 'new') return planNew(dataDir, flags);
    if (command === 'show') return planShow(dataDir, flags);
    if (command === 'render') return planRender(dataDir, flags);
    if (command === 'review') return planReview(dataDir, flags);
    if (command === 'breakpoint') return planBreakpoint(dataDir, flags);
  }

  if (scope === 'idea') {
    if (command === 'add') return ideaAdd(dataDir, positionals, flags);
    if (command === 'list') return ideaList(dataDir, flags);
    if (command === 'wake') return ideaWake(dataDir, positionals, flags);
    if (command === 'promote') return ideaPromote(dataDir, positionals, flags);
    if (command === 'discard') return ideaDiscard(dataDir, positionals, flags);
  }

  throw new CliError(USAGE);
}

const invokedPath = process.argv[1];
const isMain =
  invokedPath !== undefined &&
  resolve(invokedPath) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`错误：${message}\n`);
      process.exitCode = 1;
    }
  }
}
