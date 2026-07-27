export const SAFE_ALWAYS_ALLOW_TOOLS = new Set([
  'ToolSearch',
  'Glob',
  'Grep',
  'Read',
  'NotebookRead',
  'BashOutput',
  'LSP',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TaskStop',
  'TaskOutput',
  'AskUserQuestion',
  'EnterPlanMode',
  'Sleep',
]);

function normalizeToolName(toolName) {
  return String(toolName || '').trim();
}

export function createPermissionPolicy({ askUser }) {
  const alwaysAllowedTools = new Set();

  return {
    async canUseTool(toolName, input, options) {
      const normalizedToolName = normalizeToolName(toolName);
      if (SAFE_ALWAYS_ALLOW_TOOLS.has(normalizedToolName)) {
        return { behavior: 'allow' };
      }
      if (alwaysAllowedTools.has(normalizedToolName)) {
        return { behavior: 'allow' };
      }

      const decision = await askUser(normalizedToolName, input, options);
      if (decision?.behavior === 'always_allow') {
        alwaysAllowedTools.add(normalizedToolName);
        return { behavior: 'allow' };
      }
      if (decision?.behavior === 'allow') {
        return { behavior: 'allow' };
      }
      return {
        behavior: 'deny',
        message: decision?.message || 'Denied by user',
      };
    },
  };
}
