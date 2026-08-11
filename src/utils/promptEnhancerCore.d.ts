export interface PromptEnhancerRule {
  id?: string;
  pattern: string;
  replacement: string;
  enabled?: boolean;
}

export function applyPromptRules(text: string, rules?: PromptEnhancerRule[]): string;
export function organizePromptText(text: string): string;
export function createLocalPromptEnhancement(text: string, rules?: PromptEnhancerRule[]): string;
export function createPromptEnhancementPreview(
  text: string,
  rules?: PromptEnhancerRule[],
): {
  originalText: string;
  localResult: string;
  changed: boolean;
};
