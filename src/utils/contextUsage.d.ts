export const MODEL_CONTEXT_LIMITS: Record<string, number>;

export interface TokenUsagePayload {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface UsageUpdatePayload {
  type: 'usage_update';
  sessionId?: string;
  percentage: number;
  totalTokens: number;
  limit: number;
  usedTokens: number;
  maxTokens: number;
  runtimeClassification?: 'cold' | 'warm';
  runtimeRetirementReason?: string;
}

export function getModelContextLimit(model: string | undefined | null): number;
export function calculateContextPercentage(usedTokens: number | undefined, maxTokens: number | undefined): number;
export function extractUsedTokens(usage: TokenUsagePayload | undefined | null, provider?: string): number;
export function estimateMessagesUsedTokens(messages: unknown[]): number;
export function extractMessagesUsedTokens(messages: unknown[], provider?: string): number | undefined;
export function extractUsageFromSdkEvent(event: unknown): TokenUsagePayload | null;
export function createUsageUpdate(options: {
  usage: TokenUsagePayload;
  provider?: string;
  model?: string;
  sessionId?: string;
  runtimeClassification?: 'cold' | 'warm';
  runtimeRetirementReason?: string;
}): UsageUpdatePayload;
