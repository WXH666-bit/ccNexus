import path from 'node:path';

export function encodeClaudeProjectPath(cwd) {
  return path.resolve(cwd).replace(/[:/\\]/g, '-');
}

export function claudeProjectSessionsDir({ homeDir, cwd }) {
  return path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));
}
