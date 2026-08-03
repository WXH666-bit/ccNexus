import { createTwoFilesPatch } from 'diff';

export interface DiffResult {
  additions: number;
  deletions: number;
  html: string;
  truncated: boolean;
}

interface DiffStats {
  additions: number;
  deletions: number;
}

// Match ccgui's bounded LCS strategy so large edits never monopolize the UI thread.
const LCS_MAX_LINES = 100;
const DIFF_CACHE_MAX_SIZE = 100;
const MAX_DIFF_RENDER_LINES = 1200;
const MAX_DIFF_RENDER_CHARS = 200_000;
const diffStatsCache = new Map<string, DiffStats>();

function normalizeDiffText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getDiffCacheKey(oldString: string, newString: string) {
  if (oldString.length + newString.length < 500) {
    return `${oldString.length}:${newString.length}:${oldString}:${newString}`;
  }
  return `${oldString.length}:${newString.length}:${oldString.slice(0, 30)}:${oldString.slice(-20)}:${newString.slice(0, 30)}:${newString.slice(-20)}`;
}

function computeLcsDiff(oldLines: string[], newLines: string[], m: number, n: number): DiffStats {
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  let additions = 0;
  let deletions = 0;
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      additions += 1;
      j -= 1;
    } else {
      deletions += 1;
      i -= 1;
    }
  }

  return { additions, deletions };
}

/**
 * Compute line statistics without creating a rendered diff.
 * The large-file fallback intentionally follows ccgui: line-count delta is
 * cheap and predictable, while small edits get exact LCS counts.
 */
export function computeDiffStats(oldStr: string, newStr: string): DiffStats {
  const oldText = normalizeDiffText(oldStr || '');
  const newText = normalizeDiffText(newStr || '');
  const cacheKey = getDiffCacheKey(oldText, newText);
  const cached = diffStatsCache.get(cacheKey);
  if (cached) return cached;

  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  let result: DiffStats;

  if (oldLines.length === 0 && newLines.length === 0) {
    result = { additions: 0, deletions: 0 };
  } else if (oldLines.length === 0) {
    result = { additions: newLines.length, deletions: 0 };
  } else if (newLines.length === 0) {
    result = { additions: 0, deletions: oldLines.length };
  } else if (oldLines.length > LCS_MAX_LINES || newLines.length > LCS_MAX_LINES) {
    const lineDelta = newLines.length - oldLines.length;
    result = lineDelta >= 0
      ? { additions: lineDelta, deletions: 0 }
      : { additions: 0, deletions: -lineDelta };
  } else {
    result = computeLcsDiff(oldLines, newLines, oldLines.length, newLines.length);
  }

  if (diffStatsCache.size >= DIFF_CACHE_MAX_SIZE) {
    const firstKey = diffStatsCache.keys().next().value;
    if (firstKey) diffStatsCache.delete(firstKey);
  }
  diffStatsCache.set(cacheKey, result);
  return result;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderDiffHtml(oldText: string, newText: string) {
  const patch = createTwoFilesPatch('original', 'modified', oldText, newText, '', '', { context: 3 });
  return patch.split('\n').slice(4).map(line => {
    if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
    if (line.startsWith('-')) return `<span class="diff-del">${escapeHtml(line)}</span>`;
    if (line.startsWith('@@')) return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
    return `<span class="diff-context">${escapeHtml(line)}</span>`;
  }).join('\n');
}

export function computeDiff(oldStr: string, newStr: string): DiffResult {
  const oldText = normalizeDiffText(oldStr || '');
  const newText = normalizeDiffText(newStr || '');
  const stats = computeDiffStats(oldText, newText);
  const lineCount = (oldText ? oldText.split('\n').length : 0) + (newText ? newText.split('\n').length : 0);

  // Keep the status popover responsive. The file name still opens the editor,
  // where the complete file can be inspected without building a huge DOM tree.
  if (lineCount > MAX_DIFF_RENDER_LINES || oldText.length + newText.length > MAX_DIFF_RENDER_CHARS) {
    return { ...stats, html: '', truncated: true };
  }

  return { ...stats, html: renderDiffHtml(oldText, newText), truncated: false };
}
