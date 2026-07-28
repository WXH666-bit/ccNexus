export const READ_TOOL_NAMES = new Set(['read', 'read_file', 'read_multiple_files']);
export const EDIT_TOOL_NAMES = new Set(['edit', 'multiedit', 'edit_file', 'replace_string', 'write_to_file']);
export const FILE_MODIFY_TOOL_NAMES = new Set([
  'write',
  'write_file',
  'create_file',
  'edit',
  'multiedit',
  'edit_file',
  'replace_string',
  'write_to_file',
  'notebookedit',
]);
export const BASH_TOOL_NAMES = new Set(['bash', 'run_terminal_cmd', 'exec_command', 'execute_command', 'shell_command']);
export const SEARCH_TOOL_NAMES = new Set(['grep', 'glob', 'search', 'find', 'search_files']);
export const AGENT_TOOL_NAMES = new Set(['task', 'agent', 'spawn_agent']);
export const TASK_MANAGE_TOOL_NAMES = new Set(['todowrite', 'update_plan', 'taskcreate', 'taskupdate', 'taskget', 'tasklist']);

export const TRANSIENT_INTERNAL_TOOL_NAMES = new Set([
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
  'parallel',
  'multi_tool_use.parallel',
]);

export function normalizeToolName(toolName = '') {
  const lower = String(toolName).toLowerCase();
  const mcpMatch = /^mcp__[^_]+__(.+)$/.exec(lower);
  return mcpMatch ? mcpMatch[1] : lower;
}

export function isToolName(toolName, toolSet) {
  return toolName !== undefined && toolSet.has(normalizeToolName(toolName));
}

export function isTransientInternalToolName(toolName) {
  if (!toolName) return false;
  const lower = String(toolName).toLowerCase();
  return TRANSIENT_INTERNAL_TOOL_NAMES.has(lower) || TRANSIENT_INTERNAL_TOOL_NAMES.has(normalizeToolName(lower));
}

export function isFileModifyToolName(toolName) {
  return isToolName(toolName, FILE_MODIFY_TOOL_NAMES);
}

export function shouldRenderToolUse(toolName, isStreaming) {
  const normalized = normalizeToolName(toolName);
  if (TASK_MANAGE_TOOL_NAMES.has(normalized)) return false;
  if (!isStreaming && isTransientInternalToolName(toolName)) return false;
  return true;
}

function isToolBlockOfType(block, toolNames) {
  return block?.type === 'tool_use' && isToolName(block.name, toolNames);
}

export function getToolGroupType(block) {
  if (isToolBlockOfType(block, READ_TOOL_NAMES)) return 'read_group';
  if (isToolBlockOfType(block, EDIT_TOOL_NAMES)) return 'edit_group';
  if (isToolBlockOfType(block, BASH_TOOL_NAMES)) return 'bash_group';
  if (isToolBlockOfType(block, SEARCH_TOOL_NAMES)) return 'search_group';
  return null;
}

export function groupBlocks(blocks) {
  const groupedBlocks = [];
  let currentReadGroup = [];
  let readGroupStartIndex = -1;
  let currentEditGroup = [];
  let editGroupStartIndex = -1;
  let currentBashGroup = [];
  let bashGroupStartIndex = -1;
  let currentSearchGroup = [];
  let searchGroupStartIndex = -1;
  let currentAgentBlock = null;
  let agentFollowingBlocks = [];
  let agentGroupStartIndex = -1;

  const flushReadGroup = () => {
    if (currentReadGroup.length > 0) {
      groupedBlocks.push({ type: 'read_group', blocks: [...currentReadGroup], startIndex: readGroupStartIndex });
      currentReadGroup = [];
      readGroupStartIndex = -1;
    }
  };

  const flushEditGroup = () => {
    if (currentEditGroup.length > 0) {
      groupedBlocks.push({ type: 'edit_group', blocks: [...currentEditGroup], startIndex: editGroupStartIndex });
      currentEditGroup = [];
      editGroupStartIndex = -1;
    }
  };

  const flushBashGroup = () => {
    if (currentBashGroup.length > 0) {
      groupedBlocks.push({ type: 'bash_group', blocks: [...currentBashGroup], startIndex: bashGroupStartIndex });
      currentBashGroup = [];
      bashGroupStartIndex = -1;
    }
  };

  const flushSearchGroup = () => {
    if (currentSearchGroup.length > 0) {
      groupedBlocks.push({ type: 'search_group', blocks: [...currentSearchGroup], startIndex: searchGroupStartIndex });
      currentSearchGroup = [];
      searchGroupStartIndex = -1;
    }
  };

  const flushToolGroups = () => {
    flushReadGroup();
    flushEditGroup();
    flushBashGroup();
    flushSearchGroup();
  };

  const flushAgentGroup = () => {
    if (currentAgentBlock) {
      groupedBlocks.push({
        type: 'agent_group',
        agentBlock: currentAgentBlock,
        followingBlocks: [...agentFollowingBlocks],
        startIndex: agentGroupStartIndex,
      });
      currentAgentBlock = null;
      agentFollowingBlocks = [];
      agentGroupStartIndex = -1;
    }
  };

  blocks.forEach((block, idx) => {
    if (currentAgentBlock) {
      if (isToolBlockOfType(block, AGENT_TOOL_NAMES)) {
        flushAgentGroup();
      } else if (block.type === 'tool_use') {
        agentFollowingBlocks.push(block);
        return;
      } else if (block.type === 'tool_result') {
        return;
      } else {
        flushAgentGroup();
      }
    }

    if (isToolBlockOfType(block, AGENT_TOOL_NAMES)) {
      flushToolGroups();
      currentAgentBlock = block;
      agentGroupStartIndex = idx;
    } else if (isToolBlockOfType(block, READ_TOOL_NAMES)) {
      flushEditGroup();
      flushBashGroup();
      flushSearchGroup();
      if (currentReadGroup.length === 0) readGroupStartIndex = idx;
      currentReadGroup.push(block);
    } else if (isToolBlockOfType(block, EDIT_TOOL_NAMES)) {
      flushReadGroup();
      flushBashGroup();
      flushSearchGroup();
      if (currentEditGroup.length === 0) editGroupStartIndex = idx;
      currentEditGroup.push(block);
    } else if (isToolBlockOfType(block, BASH_TOOL_NAMES)) {
      flushReadGroup();
      flushEditGroup();
      flushSearchGroup();
      if (currentBashGroup.length === 0) bashGroupStartIndex = idx;
      currentBashGroup.push(block);
    } else if (isToolBlockOfType(block, SEARCH_TOOL_NAMES)) {
      flushReadGroup();
      flushEditGroup();
      flushBashGroup();
      if (currentSearchGroup.length === 0) searchGroupStartIndex = idx;
      currentSearchGroup.push(block);
    } else if (block.type === 'tool_result') {
      return;
    } else {
      flushToolGroups();
      groupedBlocks.push({ type: 'single', block, originalIndex: idx });
    }
  });

  flushAgentGroup();
  flushToolGroups();

  return groupedBlocks;
}

function getBlocks(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

export function findToolResultForBlock(messages, messageIndex, toolId) {
  if (!toolId) return null;
  for (let i = messageIndex; i < messages.length; i += 1) {
    const result = getBlocks(messages[i]).find(
      (block) => block?.type === 'tool_result' && block.tool_use_id === toolId,
    );
    if (result) return result;
  }
  return null;
}
