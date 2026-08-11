export type McpViewScope = 'global' | 'project';

export interface McpViewItem {
  id: string;
  name: string;
  enabled: boolean;
  scope: McpViewScope;
  config?: Record<string, unknown>;
  kind: 'server' | 'disabled' | 'invalid';
  status: string;
  statusKey: string;
  error: string;
  connection: string;
  reason?: string;
}

export interface McpViewModel {
  state: unknown;
  statuses: unknown[];
  items: McpViewItem[];
  allItems: McpViewItem[];
  counts: {
    all: number;
    connected: number;
    pending: number;
    failed: number;
    disabled: number;
    invalid: number;
  };
}

export function buildMcpViewModel(
  state?: unknown,
  statuses?: unknown[],
  filters?: { search?: string; scope?: string; status?: string },
): McpViewModel;

export function getMcpConnectionText(config?: Record<string, unknown>): string;
