import type { Idea, Plan, Pool } from './types.ts';
import { daysBetween } from './dates.ts';

const MAIN_LABELS = ['一', '二', '三', '四'];
const CN_NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const MAX_DUE_ITEMS = 3;

export type MorningOptions = {
  /** ideas already selected as due; at most three are appended */
  due?: Idea[];
  /** day the message describes; defaults to plan.date, never the clock */
  today?: string;
};

export function countLabel(count: number): string {
  return CN_NUMBERS[count] ?? String(count);
}

/** Morning title, e.g. `早。今天三块：`. Zero blocks render nothing. */
export function morningTitle(count: number): string {
  if (count <= 0) return '';
  const label = count === 2 ? '两' : countLabel(count);
  return `早。今天${label}块：`;
}

function projectTitle(pool: Pool, projectId: string): string {
  const project = pool.projects.find((candidate) => candidate.id === projectId);
  return project?.title ?? projectId;
}

function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ');
}

/**
 * One trailing line for due wake-ups. Text is collapsed to one line and the
 * parenthetical counts how many days ago the idea came due. Empty input
 * returns an empty string so the caller appends nothing at all.
 */
function dueLine(due: Idea[], today: string): string {
  if (due.length === 0) return '';
  const entries = due.slice(0, MAX_DUE_ITEMS).map((idea) => {
    const days =
      idea.wake_at === null ? 0 : Math.max(0, daysBetween(idea.wake_at, today));
    const when = days === 0 ? '今天' : `${days} 天前`;
    return `${oneLine(idea.text)}（${when}）`;
  });
  return `到期唤醒：${entries.join('，')}`;
}

/**
 * Morning message, following v0.01/README.md. Fixed line order, fixed
 * separators, fixed en dash; no clock, random, or locale-dependent formatting.
 * R5: exception days render an empty string.
 *
 * v0.03 appends the due wake-up line only when one exists, so every v0.02
 * output stays byte-identical.
 */
export function renderMorning(
  plan: Plan,
  pool: Pool,
  options: MorningOptions = {},
): string {
  if (plan.day_type === 'exception') return '';
  if (plan.blocks.length === 0) return '';

  const lines: string[] = [morningTitle(plan.blocks.length), ''];
  let mainIndex = 0;

  for (const block of plan.blocks) {
    let label: string;
    if (block.kind === 'main') {
      label = `主线${MAIN_LABELS[mainIndex] ?? String(mainIndex + 1)}`;
      mainIndex += 1;
    } else {
      label = '支线';
    }
    const title = oneLine(projectTitle(pool, block.project_id));
    lines.push(
      `**${block.start}–${block.end}** ${label} —— 《${title}》下一步：${oneLine(block.action)}`,
    );
  }

  if (plan.blocks.length > 0) lines.push('');

  if (plan.shelved.length > 0) {
    const entries = plan.shelved.slice(0, 3).map((entry) => {
      const title = oneLine(projectTitle(pool, entry.project_id));
      return entry.reason ? `${title}（${oneLine(entry.reason)}）` : title;
    });
    lines.push(`搁置中：${entries.join('；')}`);
  }

  if (plan.do_not.length > 0) {
    lines.push(`今天不要做：${plan.do_not.map(oneLine).join(' / ')}`);
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const due = dueLine(options.due ?? [], options.today ?? plan.date);
  if (due !== '') lines.push(due);
  return lines.join('\n');
}

/**
 * Evening message: exactly one question per call, nothing else.
 * R5: exception days render an empty string.
 */
export function renderEvening(plan: Plan, step: 1 | 2): string {
  if (plan.day_type === 'exception') return '';
  if (step === 1) return '今天三块里，哪块真做了？';
  if (step === 2) return '没做的那块断在哪，下一块的第一个动作是什么？';
  throw new Error(`无效的 step：${String(step)}（只支持 1 或 2）`);
}
