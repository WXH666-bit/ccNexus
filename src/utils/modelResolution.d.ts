export interface ClaudeModelInfo {
  id: string;
  label: string;
  subtitle: string;
  mappingKey: 'opus' | 'sonnet' | 'haiku';
}

export interface ModelDisplay {
  modelId: string;
  label: string;
  subtitle?: string;
  resolvedId: string;
}

export const CLAUDE_MODELS: ClaudeModelInfo[];

export function stripLongContextSuffix(modelId: string | undefined | null): string;
export function modelSupportsLongContext(modelId: string | undefined | null): boolean;
export function applyLongContextSuffix(modelId: string, enabled: boolean): string;
export function resolveBackendModel(modelId: string, env?: Record<string, string | undefined>): string;
export function resolveModelDisplay(modelId: string, env?: Record<string, string | undefined>): ModelDisplay;
