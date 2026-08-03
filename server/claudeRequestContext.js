import { loadMcpServersConfigAsRecord } from './claudeMcp.js';

export async function buildClaudeClientOptions({
  cwd,
  clientOptions = {},
  loadAgent,
  loadMcpServers = (workingDirectory) => loadMcpServersConfigAsRecord(workingDirectory),
} = {}) {
  const {
    mcpServers: _requestMcpServers,
    agentPrompt: requestedAgentPrompt,
    ...restOptions
  } = clientOptions || {};

  let agentPrompt = typeof requestedAgentPrompt === 'string' ? requestedAgentPrompt : '';
  if (!agentPrompt && clientOptions?.agent && typeof loadAgent === 'function') {
    try {
      const agent = await loadAgent(clientOptions.agent);
      agentPrompt = typeof agent?.content === 'string' ? agent.content : '';
    } catch {
      agentPrompt = '';
    }
  }

  const mcpServers = await loadMcpServers(cwd);
  return {
    ...restOptions,
    ...(agentPrompt ? { agentPrompt } : {}),
    ...(mcpServers ? { mcpServers } : {}),
  };
}
