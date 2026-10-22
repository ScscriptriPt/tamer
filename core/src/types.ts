export type ProjectKind = 'main' | 'side';
export type ProjectStatus = 'active' | 'paused' | 'shelved' | 'done';
export type DayType = 'normal' | 'exception';
export type BlockKind = 'main' | 'side';

export type Project = {
  id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  deadline: string | null;
  wake_at: string | null;
  last_touched: string | null;
  progress: number | null;
  /** one-line description: what this project is / how far it got */
  note: string | null;
  /** one concrete action that can start within 90 minutes */
  next_action?: string | null;
};

export type Pool = {
  version: number;
  projects: Project[];
};

export type Breakpoint = {
  /** when the breakpoint was recorded; supplied by the CLI, never by core */
  at: string;
  /** what actually got done */
  did: string;
  /** where it got stuck; null when nothing was stuck */
  stuck: string | null;
  /** the first action of the next block */
  next: string;
};

export type PlanBlock = {
  start: string;
  end: string;
  kind: BlockKind;
  project_id: string;
  action: string;
  done_when: string;
  breakpoint: Breakpoint | null;
};

export type ShelvedEntry = {
  project_id: string;
  reason: string | null;
};

export type PlanResultBlock = {
  project_id: string;
  done: boolean;
  note: string | null;
};

export type PlanResult = {
  reviewed_at: string;
  blocks: PlanResultBlock[];
};

export type Plan = {
  date: string;
  day_type: DayType;
  blocks: PlanBlock[];
  shelved: ShelvedEntry[];
  do_not: string[];
  risk: string | null;
  result: PlanResult | null;
};

export type IdeaState = 'graveyard' | 'explore' | 'wake' | 'promoted' | 'discarded';

export type Idea = {
  id: string;
  text: string;
  captured_at: string;
  state: IdeaState;
  occurrences: number;
  wake_at: string | null;
  reason: string | null;
};

export type IdeaBook = {
  version: number;
  ideas: Idea[];
};
