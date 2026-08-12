import { normalizeStreamDelta, resetTurnBlockState } from './streamDeltaNormalizer.js';

const MAX_PARTIAL_TOOL_PREVIEW_CHARS = 32000;

function decodeJsonEscape(escape, source, index) {
  if (escape === 'n') return { value: '\n', nextIndex: index + 1 };
  if (escape === 'r') return { value: '\r', nextIndex: index + 1 };
  if (escape === 't') return { value: '\t', nextIndex: index + 1 };
  if (escape === 'b') return { value: '\b', nextIndex: index + 1 };
  if (escape === 'f') return { value: '\f', nextIndex: index + 1 };
  if (escape === '"') return { value: '"', nextIndex: index + 1 };
  if (escape === '\\') return { value: '\\', nextIndex: index + 1 };
  if (escape === '/') return { value: '/', nextIndex: index + 1 };
  if (escape === 'u') {
    const hex = source.slice(index + 1, index + 5);
    if (/^[0-9a-f]{4}$/i.test(hex)) {
      return { value: String.fromCharCode(parseInt(hex, 16)), nextIndex: index + 5 };
    }
  }
  return { value: `\\${escape}`, nextIndex: index + 1 };
}

function readPartialJsonString(source, startIndex) {
  let value = '';
  let index = startIndex;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') return { value, complete: true };
    if (character === '\\') {
      if (index + 1 >= source.length) return { value: `${value}\\`, complete: false };
      const decoded = decodeJsonEscape(source[index + 1], source, index + 1);
      value += decoded.value;
      index = decoded.nextIndex;
    } else {
      value += character;
      index += 1;
    }
    if (value.length >= MAX_PARTIAL_TOOL_PREVIEW_CHARS) {
      return { value: value.slice(0, MAX_PARTIAL_TOOL_PREVIEW_CHARS), complete: false };
    }
  }
  return { value, complete: false };
}

function extractPartialToolPreviews(source) {
  const previews = {};
  if (typeof source !== 'string' || !source) return previews;

  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') {
      const keyStart = index;
      let keyEnd = index + 1;
      let escaped = false;
      while (keyEnd < source.length) {
        const keyCharacter = source[keyEnd];
        if (escaped) {
          escaped = false;
        } else if (keyCharacter === '\\') {
          escaped = true;
        } else if (keyCharacter === '"') {
          break;
        }
        keyEnd += 1;
      }
      if (keyEnd >= source.length) break;

      const key = source.slice(keyStart + 1, keyEnd);
      if (depth === 1 && (key === 'command' || key === 'content')) {
        let valueStart = keyEnd + 1;
        while (/\s/.test(source[valueStart] || '')) valueStart += 1;
        if (source[valueStart] === ':') {
          valueStart += 1;
          while (/\s/.test(source[valueStart] || '')) valueStart += 1;
          if (source[valueStart] === '"') {
            const partial = readPartialJsonString(source, valueStart + 1);
            previews[key] = partial.value;
            if (!partial.complete) break;
          }
        }
      }
      index = keyEnd + 1;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && depth > 0) depth -= 1;
    index += 1;
  }
  return previews;
}

export function createStreamingBlockState() {
  return {
    blocks: [],
    activeBlockByIndex: new Map(),
    partialToolInputs: new Map(),
    textBlockContentByIndex: new Map(),
    thinkingBlockContentByIndex: new Map(),
    blockStreamModeByKey: new Map(),
  };
}

export function resetStreamingBlockState(state) {
  state.blocks = [];
  state.activeBlockByIndex.clear();
  state.partialToolInputs.clear();
  resetTurnBlockState(state);
}

export function appendToolResultBlock(state, block) {
  if (block?.type !== 'tool_result') return state.blocks;
  const existingIndex = state.blocks.findIndex(
    (item) => item?.type === 'tool_result' && item.tool_use_id === block.tool_use_id,
  );
  if (existingIndex >= 0) {
    state.blocks[existingIndex] = block;
  } else {
    state.blocks.push(block);
  }
  return state.blocks;
}

export function applyStreamEventToBlocks(state, event) {
  if (event?.type === 'message_start') {
    state.activeBlockByIndex.clear();
    state.partialToolInputs.clear();
    resetTurnBlockState(state);
    return state.blocks;
  }

  if (event?.type === 'content_block_start') {
    const source = event.content_block || {};
    let block = null;
    if (source.type === 'text') block = { type: 'text', text: '' };
    if (source.type === 'thinking') block = { type: 'thinking', thinking: '' };
    if (source.type === 'tool_use') {
      block = {
        type: 'tool_use',
        id: source.id || '',
        name: source.name || '',
        input: {},
      };
    }
    if (block) {
      const blockIndex = state.blocks.length;
      state.activeBlockByIndex.set(event.index, blockIndex);
      state.blocks.push(block);
    }
    return state.blocks;
  }

  if (event?.type === 'content_block_delta') {
    const blockIndex = state.activeBlockByIndex.get(event.index);
    const block = state.blocks[blockIndex];
    if (!block) return state.blocks;

    const delta = event.delta || {};
    if (delta.type === 'text_delta' && block.type === 'text') {
      block.text += normalizeStreamDelta(state, 'text', event.index, delta.text || '');
    }
    if (delta.type === 'thinking_delta' && block.type === 'thinking') {
      block.thinking += normalizeStreamDelta(state, 'thinking', event.index, delta.thinking || '');
    }
    if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
      const current = state.partialToolInputs.get(blockIndex) || '';
      const input = current + (delta.partial_json || '');
      state.partialToolInputs.set(blockIndex, input);
      try {
        block.input = JSON.parse(input);
        delete block._partialInput;
        delete block._partialCommand;
        delete block._partialContent;
      } catch {
        // Keep buffering until the SDK emits valid JSON, while exposing a
        // display-only preview so the renderer can show the live tool card.
        block._partialInput = input;
        const previews = extractPartialToolPreviews(input);
        block._partialCommand = previews.command ?? '';
        block._partialContent = previews.content ?? '';
      }
    }
  }

  return state.blocks;
}
