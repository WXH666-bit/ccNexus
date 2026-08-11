export type SkillViewScope = 'global' | 'local';

export interface SkillViewItem {
  id: string;
  skillName?: string;
  name: string;
  type: string;
  scope: SkillViewScope;
  path: string;
  enabled: boolean;
  description?: string;
  warning?: string;
  modifiedAt?: string;
  statusKey?: 'enabled' | 'disabled';
}

export interface SkillsViewState {
  global: Record<string, SkillViewItem>;
  local: Record<string, SkillViewItem>;
}

export interface SkillsViewModel {
  state: SkillsViewState;
  items: SkillViewItem[];
  allItems: SkillViewItem[];
  counts: {
    all: number;
    enabled: number;
    disabled: number;
    global: number;
    local: number;
  };
}

export function buildSkillsViewModel(
  state: SkillsViewState,
  filters?: { search?: string; scope?: string; status?: string },
): SkillsViewModel;
