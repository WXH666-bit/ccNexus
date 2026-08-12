const DEFAULT_RULE_FLAGS = 'g';
const MAX_RULE_PATTERN_LENGTH = 256;
const MAX_RULE_INPUT_LENGTH = 100_000;

function hasNestedQuantifier(pattern) {
  // Reject common catastrophic-backtracking shapes such as `(a+)+` and
  // quantified character classes followed by another quantifier.
  return /(?:\([^)]*[+*][^)]*\)|\[[^\]]+\][+*]|\\[dDsSwW][+*])\s*(?:[+*?]|\{\d)/.test(pattern)
    || /(?:[+*?]|\{\d+(?:,\d*)?\})\s*(?:[+*?]|\{\d)/.test(pattern);
}

function isSafeRulePattern(pattern) {
  return pattern.length <= MAX_RULE_PATTERN_LENGTH && !hasNestedQuantifier(pattern);
}

function normalizeText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').trim();
}

function protectSegments(text) {
  const protectedParts = [];
  const tokenFor = (kind, value) => {
    const token = `@@PROMPT_${kind}_${protectedParts.length}@@`;
    protectedParts.push({ token, value });
    return token;
  };

  let current = text;
  current = current.replace(/```[\s\S]*?```/g, (match) => tokenFor('FENCE', match));
  current = current.replace(/`[^`\n]+`/g, (match) => tokenFor('INLINE', match));
  current = current.replace(/https?:\/\/[^\s<>()]+/g, (match) => tokenFor('URL', match));
  current = current.replace(
    /(?:[A-Za-z]:\\(?:[^\\\n]+\\)*[^\\\n]+|\\\\[^\\\n]+\\[^\\\n]+(?:\\[^\\\n]+)*)/g,
    (match) => tokenFor('PATH', match),
  );
  current = current.replace(
    /(?:^|\s)(?:[A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){1,6})(?=$|\s)/g,
    (match) => {
      const value = match.trim();
      if (!/[\\/]|\.cmd\b|\.bat\b|npm\b|node\b|pnpm\b|yarn\b|git\b|python\b|run\b|build\b|test\b|install\b/.test(value)) {
        return match;
      }
      const token = tokenFor('CMD', value);
      return match.startsWith(' ') ? ` ${token}` : token;
    },
  );

  return { text: current, protectedParts };
}

function restoreSegments(text, protectedParts) {
  return protectedParts.reduce((current, part) => current.replaceAll(part.token, part.value), text);
}

export function applyPromptRules(text, rules = []) {
  let current = normalizeText(text);
  if (current.length > MAX_RULE_INPUT_LENGTH) return current;

  for (const rule of rules) {
    if (!rule || rule.enabled === false || !rule.pattern) continue;
    const pattern = String(rule.pattern);
    if (!isSafeRulePattern(pattern)) continue;
    try {
      current = current.replace(new RegExp(pattern, DEFAULT_RULE_FLAGS), rule.replacement ?? '');
    } catch {
      // Invalid custom rule must not affect the prompt.
    }
  }
  return current;
}

function classifySentence(sentence) {
  if (/背景|目前|项目/.test(sentence)) return ['背景', sentence];
  if (/验收|检查|确认|确保/.test(sentence)) return ['验收', sentence];
  if (/输出|返回|提供/.test(sentence)) return ['输出', sentence];
  if (/要求|必须|不要|不需要|需要|要/.test(sentence)) return ['约束', sentence];
  return ['目标', sentence];
}

function splitSentences(text) {
  return text
    .split(/(?<=[。！？\n,，；;:：])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function organizePromptText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return '';

  const initialSentences = splitSentences(normalized);
  if (initialSentences.length <= 1) return normalized;

  const { text: protectedText, protectedParts } = protectSegments(normalized);
  const protectedSentences = splitSentences(protectedText);
  const sections = new Map();
  const goal = [];

  for (const sentence of protectedSentences) {
    const originalSentence = restoreSegments(sentence, protectedParts).trim();
    if (!originalSentence) continue;

    const [label, content] = classifySentence(originalSentence);
    if (label === '目标') {
      goal.push(content);
      continue;
    }

    if (!sections.has(label)) sections.set(label, []);
    sections.get(label).push(content);
  }

  const meaningful = [];
  if (goal.length) meaningful.push(['目标', goal.join(' ')]);
  for (const [label, items] of sections) meaningful.push([label, items.join(' ')]);
  if (meaningful.length < 2) return normalized;

  return meaningful.map(([label, content]) => `${label}：${content}`).join('\n');
}

export function createLocalPromptEnhancement(text, rules = []) {
  return organizePromptText(applyPromptRules(text, rules));
}

export function createPromptEnhancementPreview(text, rules = []) {
  const localResult = createLocalPromptEnhancement(text, rules);
  return {
    originalText: text,
    localResult,
    changed: localResult !== text,
  };
}
