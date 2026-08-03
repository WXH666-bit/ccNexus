function buildWindowsPathConstraint() {
  if (process.platform !== 'win32') return '';
  return '\n\n## CRITICAL: File Path Format Requirement\n\n'
    + "**IMPORTANT**: There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Apply this rule going forward, not just for this file.\n\n"
    + '**Examples**:\n'
    + '- \u2705 Correct: `C:\\Users\\username\\project\\src\\file.js`\n'
    + '- \u274C Wrong: `/c/Users/username/project/src/file.js`\n'
    + '- \u274C Wrong: `./src/file.js` (relative paths)\n\n'
    + '---\n\n';
}

export function buildClaudeSystemPromptAppend({ agentPrompt = null } = {}) {
  let prompt = '';
  if (typeof agentPrompt === 'string' && agentPrompt.trim()) {
    prompt += '\n\n## Agent Role and Instructions\n\n'
      + 'You are acting as a specialized agent with the following role and instructions:\n\n'
      + agentPrompt.trim()
      + '\n\n**IMPORTANT**: Follow the above role and instructions throughout this conversation.\n'
      + '\n---\n';
  }
  return prompt + buildWindowsPathConstraint();
}
