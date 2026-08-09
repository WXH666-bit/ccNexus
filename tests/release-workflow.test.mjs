import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);

test('release workflow builds and publishes a stable Windows GitHub Release from version tags', () => {
  assert.equal(existsSync(workflowUrl), true);
  const workflow = readFileSync(workflowUrl, 'utf8');

  assert.match(workflow, /push:\s*[\r\n]+\s+tags:\s*\[["']v\*["']\]/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pnpm install\s+--frozen-lockfile/);
  assert.match(workflow, /pnpm run build/);
  assert.match(workflow, /pnpm exec electron-builder\s+--win\s+nsis\s+--publish\s+always/);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/);
});
