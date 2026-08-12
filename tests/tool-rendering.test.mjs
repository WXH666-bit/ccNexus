import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeToolName,
  isToolName,
  READ_TOOL_NAMES,
  EDIT_TOOL_NAMES,
  BASH_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  AGENT_TOOL_NAMES,
  FILE_MODIFY_TOOL_NAMES,
  groupBlocks,
  findToolResultForBlock,
  shouldRenderToolUse,
  isFileModifyToolName,
} from '../src/utils/toolRendering.js';
import { normalizeToolInput } from '../src/utils/toolInputNormalization.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('normalizes tool names the same way ccgui does', () => {
  assert.equal(normalizeToolName('mcp__filesystem__read_file'), 'read_file');
  assert.equal(normalizeToolName('Bash'), 'bash');
  assert.equal(isToolName('Read', READ_TOOL_NAMES), true);
  assert.equal(isToolName('Edit', EDIT_TOOL_NAMES), true);
  assert.equal(isToolName('shell_command', BASH_TOOL_NAMES), true);
  assert.equal(isToolName('Glob', SEARCH_TOOL_NAMES), true);
  assert.equal(isToolName('spawn_agent', AGENT_TOOL_NAMES), true);
  assert.equal(isToolName('Write', FILE_MODIFY_TOOL_NAMES), true);
  assert.equal(isFileModifyToolName('create_file'), true);
});

test('groups tool blocks using ccgui structural rules', () => {
  const blocks = [
    { type: 'tool_use', id: 'agent-1', name: 'Task', input: { description: 'inspect' } },
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.ts' } },
    { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'pnpm test' } },
    { type: 'text', text: 'done' },
    { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'a.ts' } },
    { type: 'tool_use', id: 'edit-2', name: 'MultiEdit', input: { file_path: 'b.ts' } },
  ];

  assert.deepEqual(
    groupBlocks(blocks).map((group) => ({
      type: group.type,
      count: group.blocks?.length ?? group.followingBlocks?.length ?? 1,
    })),
    [
      { type: 'agent_group', count: 2 },
      { type: 'single', count: 1 },
      { type: 'edit_group', count: 2 },
    ],
  );
});

test('keeps consecutive Read calls grouped when their results are interleaved', () => {
  const blocks = [
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.ts' } },
    { type: 'tool_result', tool_use_id: 'read-1', content: 'a', is_error: false },
    { type: 'tool_use', id: 'read-2', name: 'Read', input: { file_path: 'b.ts' } },
    { type: 'tool_result', tool_use_id: 'read-2', content: 'b', is_error: false },
  ];

  assert.deepEqual(
    groupBlocks(blocks).map((group) => ({
      type: group.type,
      count: group.blocks?.length ?? 1,
    })),
    [{ type: 'read_group', count: 2 }],
  );
});

test('tool group headers keep their label on the left like other tool cards', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.tool-group-header \.expand-icon\s*\{[^}]*margin-left:\s*0;/s);
});

test('live tool groups expand while the assistant turn is streaming', () => {
  const messageItem = read('src/components/MessageItem.tsx');
  const toolGroup = read('src/components/toolBlocks/ToolGroupBlock.tsx');

  assert.match(messageItem, /isStreaming=\{isMessageStreaming\}/);
  assert.match(toolGroup, /isStreaming/);
  assert.match(toolGroup, /useEffect/);
});

test('finds the nearest later tool result by tool id', () => {
  const messages = [
    {
      id: 'm1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo hi' } },
      ],
    },
    {
      id: 'm2',
      role: 'assistant',
      content: [
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'hi', is_error: false },
      ],
    },
  ];

  assert.deepEqual(findToolResultForBlock(messages, 0, 'tool-1'), {
    type: 'tool_result',
    tool_use_id: 'tool-1',
    content: 'hi',
    is_error: false,
  });
});

test('hides ccgui transient and task-management tools after streaming', () => {
  assert.equal(shouldRenderToolUse('TodoWrite', false), false);
  assert.equal(shouldRenderToolUse('update_plan', false), false);
  assert.equal(shouldRenderToolUse('multi_tool_use.parallel', false), false);
  assert.equal(shouldRenderToolUse('multi_tool_use.parallel', true), true);
  assert.equal(shouldRenderToolUse('Bash', false), true);
});

test('normalizes Write input content like ccgui file modification handling', () => {
  assert.deepEqual(
    normalizeToolInput('Write', {
      path: 'permission-check.html',
      content: '<h1>ok</h1>\n<p>done</p>',
    }),
    {
      path: 'permission-check.html',
      content: '<h1>ok</h1>\n<p>done</p>',
      file_path: 'permission-check.html',
      new_string: '<h1>ok</h1>\n<p>done</p>',
    },
  );
});
