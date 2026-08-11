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
  'EnterPlanMode',
  'Sleep',
]);

function normalizeToolName(toolName) {
  return String(toolName || '').trim();
}

function buildQuestionAnswers(input, response) {
  if (response?.answers && typeof response.answers === 'object') {
    return response.answers;
  }

  const answer = typeof response?.answer === 'string' ? response.answer.trim() : '';
  if (!answer) return null;
  const firstQuestion = Array.isArray(input?.questions) ? input.questions[0]?.question : input?.question;
  return typeof firstQuestion === 'string' && firstQuestion.trim()
    ? { [firstQuestion]: answer }
    : null;
}

export function createPermissionPolicy({ askUser, askQuestion }) {
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

      if (normalizedToolName === 'AskUserQuestion' && typeof askQuestion === 'function') {
        const response = await askQuestion(input, options);
        const answers = buildQuestionAnswers(input, response);
        if (!answers || response?.cancelled) {
          return {
            behavior: 'deny',
            message: response?.message || 'Question was not answered',
          };
        }
        return {
          behavior: 'allow',
          updatedInput: {
            ...input,
            answers,
          },
        };
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
