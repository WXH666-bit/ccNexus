import { createTwoFilesPatch } from 'diff';

interface DiffResult {
  additions: number;
  deletions: number;
  html: string;
}

export function computeDiff(oldStr: string, newStr: string): DiffResult {
  let additions = 0;
  let deletions = 0;

  if (oldStr && newStr) {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    deletions = oldLines.filter(l => !newLines.includes(l)).length;
    additions = newLines.filter(l => !oldLines.includes(l)).length;
  } else if (newStr) {
    additions = newStr.split('\n').length;
  } else if (oldStr) {
    deletions = oldStr.split('\n').length;
  }

  const patch = createTwoFilesPatch('original', 'modified', oldStr, newStr, '', '', { context: 3 });
  const lines = patch.split('\n');
  const htmlLines = lines.slice(4).map(line => {
    if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
    if (line.startsWith('-')) return `<span class="diff-del">${escapeHtml(line)}</span>`;
    if (line.startsWith('@@')) return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
    return `<span class="diff-context">${escapeHtml(line)}</span>`;
  });

  return { additions, deletions, html: htmlLines.join('\n') };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
