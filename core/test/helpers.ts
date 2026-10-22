import type { Plan, PlanBlock, Pool, Project } from '../src/types.ts';

export function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    title: overrides.id,
    kind: 'main',
    status: 'active',
    deadline: null,
    wake_at: null,
    last_touched: null,
    progress: null,
    note: `note-${overrides.id}`,
    ...overrides,
  };
}

export function pool(projects: Project[]): Pool {
  return { version: 1, projects };
}

export function block(
  projectId: string,
  kind: 'main' | 'side' = 'main',
): PlanBlock {
  return {
    start: kind === 'main' ? '09:00' : '14:00',
    end: kind === 'main' ? '10:30' : '15:00',
    kind,
    project_id: projectId,
    action: `action-${projectId}`,
    done_when: `done-${projectId}`,
    breakpoint: null,
  };
}

export function planOf(
  date: string,
  projectIds: string[],
  dayType: 'normal' | 'exception' = 'normal',
): Plan {
  return {
    date,
    day_type: dayType,
    blocks: projectIds.map((projectId) => block(projectId)),
    shelved: [],
    do_not: [],
    risk: null,
    result: null,
  };
}
