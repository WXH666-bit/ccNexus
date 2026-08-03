export interface PromptEnhancerRule {
  id?: string;
  pattern: string;
  replacement: string;
  enabled?: boolean;
}

function readRules(): { enabled: boolean; rules: PromptEnhancerRule[] } {
  if (typeof window === 'undefined') return { enabled: false, rules: [] };
  const enabled = window.localStorage.getItem('promptEnhancerEnabled') === 'true';
  if (!enabled) return { enabled: false, rules: [] };

  try {
    const parsed = JSON.parse(window.localStorage.getItem('promptEnhancerRules') || '[]');
    if (!Array.isArray(parsed)) return { enabled: true, rules: [] };
    return {
      enabled: true,
      rules: parsed.filter((rule): rule is PromptEnhancerRule => (
        rule && typeof rule === 'object'
        && typeof rule.pattern === 'string'
        && typeof rule.replacement === 'string'
      )),
    };
  } catch {
    return { enabled: true, rules: [] };
  }
}

/** Apply the same local prompt rules configured by the settings panel. */
export function enhancePromptText(text: string): string {
  const config = readRules();
  if (!config.enabled || !text) return text;

  return config.rules.reduce((current, rule) => {
    if (rule.enabled === false || !rule.pattern) return current;
    try {
      return current.replace(new RegExp(rule.pattern, 'g'), rule.replacement);
    } catch {
      // An unfinished rule must not prevent sending the user's prompt.
      return current;
    }
  }, text);
}
