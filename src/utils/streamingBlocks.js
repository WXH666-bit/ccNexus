export function createStreamingBlockState() {
  return {
    blocks: [],
    activeBlockByIndex: new Map(),
    partialToolInputs: new Map(),
  };
}

export function resetStreamingBlockState(state) {
  state.blocks = [];
  state.activeBlockByIndex.clear();
  state.partialToolInputs.clear();
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
      block.text += delta.text || '';
    }
    if (delta.type === 'thinking_delta' && block.type === 'thinking') {
      block.thinking += delta.thinking || '';
    }
    if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
      const current = state.partialToolInputs.get(blockIndex) || '';
      const input = current + (delta.partial_json || '');
      state.partialToolInputs.set(blockIndex, input);
      try {
        block.input = JSON.parse(input);
      } catch {
        // Keep buffering until the SDK emits valid JSON.
      }
    }
  }

  return state.blocks;
}
