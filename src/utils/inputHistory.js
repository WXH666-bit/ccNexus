/**
 * Small localStorage-backed input history store.
 * The ordering and bounded storage mirror ccgui's inputHistoryStorage module.
 */
export const INPUT_HISTORY_STORAGE_KEY = 'chat-input-history';
export const MAX_INPUT_HISTORY_ITEMS = 200;
export const INVISIBLE_INPUT_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

const INPUT_FRAGMENT_SEPARATORS_RE = /[,.;\uFF0C\u3002\uFF1B\s]+/;
const MAX_SPLIT_LENGTH = 300;
const MIN_FRAGMENT_LENGTH = 3;

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function splitInputHistoryFragments(text) {
  const trimmed = text.trim();
  if (trimmed.length > MAX_SPLIT_LENGTH) return [];

  const fragments = new Set();
  for (const rawFragment of trimmed.split(INPUT_FRAGMENT_SEPARATORS_RE)) {
    const fragment = rawFragment.trim();
    if (fragment.length >= MIN_FRAGMENT_LENGTH) fragments.add(fragment);
  }
  if (trimmed.length >= MIN_FRAGMENT_LENGTH) fragments.add(trimmed);
  return [...fragments];
}

export function loadInputHistory(storage) {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(INPUT_HISTORY_STORAGE_KEY) || 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value) => typeof value === 'string' && value.length > 0)
      .slice(-MAX_INPUT_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function saveInputHistory(items, storage) {
  const target = resolveStorage(storage);
  const bounded = items.slice(-MAX_INPUT_HISTORY_ITEMS);
  if (!target) return bounded;

  try {
    target.setItem(INPUT_HISTORY_STORAGE_KEY, JSON.stringify(bounded));
    return bounded;
  } catch (error) {
    const name = error?.name;
    if (name !== 'QuotaExceededError' && name !== 'NS_ERROR_DOM_QUOTA_REACHED') return bounded;
    for (let start = 1; start < bounded.length; start += 1) {
      const subset = bounded.slice(start);
      try {
        target.setItem(INPUT_HISTORY_STORAGE_KEY, JSON.stringify(subset));
        return subset;
      } catch (retryError) {
        const retryName = retryError?.name;
        if (retryName !== 'QuotaExceededError' && retryName !== 'NS_ERROR_DOM_QUOTA_REACHED') return bounded;
      }
    }
  }
  return bounded;
}

export function appendInputHistory(items, text) {
  const sanitized = String(text || '').replace(INVISIBLE_INPUT_CHARS_RE, '');
  if (!sanitized.trim()) return [...items];

  const fragments = splitInputHistoryFragments(sanitized);
  if (fragments.length === 0) return [...items];

  const newFragments = new Set(fragments);
  const withoutDuplicates = items.filter((item) => !newFragments.has(item));
  return [...withoutDuplicates, ...fragments].slice(-MAX_INPUT_HISTORY_ITEMS);
}
