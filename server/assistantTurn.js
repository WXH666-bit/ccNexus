import { normalizeStreamDelta, resetTurnBlockState, resolveSnapshotDelta } from '../src/utils/streamDeltaNormalizer.js';

export function createAssistantTurn() {
  const content = [];
  const streamedBlocks = [];
  const activeBlockByIndex = new Map();
  const partialToolInputs = new Map();
  const streamDeltaState = {
    textBlockContentByIndex: new Map(),
    thinkingBlockContentByIndex: new Map(),
    blockStreamModeByKey: new Map(),
  };
  const toolResults = [];
  let model;
  let usage;

  function interleaveToolResults(blocks) {
    if (toolResults.length === 0) return blocks;
    const usedResultIndexes = new Set();
    const result = [];
    for (const block of blocks) {
      result.push(block);
      if (block?.type !== 'tool_use' || !block.id) continue;
      toolResults.forEach((toolResult, index) => {
        if (toolResult.tool_use_id === block.id) {
          result.push(toolResult);
          usedResultIndexes.add(index);
        }
      });
    }
    toolResults.forEach((toolResult, index) => {
      if (!usedResultIndexes.has(index)) result.push(toolResult);
    });
    return result;
  }

  function tailFillSnapshotBlock(block, index) {
    if (streamedBlocks.length === 0) return;
    const streamedIndex = activeBlockByIndex.get(index);
    const streamedBlock = streamedBlocks[streamedIndex];
    if (!streamedBlock) return;

    if (block.type === 'text' && streamedBlock.type === 'text') {
      const { delta, hadPrevious } = resolveSnapshotDelta(streamDeltaState, 'text', index, block.text || '');
      if (delta && hadPrevious) streamedBlock.text += delta;
    }

    if (block.type === 'thinking' && streamedBlock.type === 'thinking') {
      const { delta, hadPrevious } = resolveSnapshotDelta(streamDeltaState, 'thinking', index, block.thinking || block.text || '');
      if (delta && hadPrevious) streamedBlock.thinking += delta;
    }
  }

  return {
    add(message) {
      if (Array.isArray(message?.content)) {
        message.content.forEach((block, index) => tailFillSnapshotBlock(block, index));
        content.push(...message.content);
      }
      if (message?.model !== undefined) model = message.model;
      if (message?.usage !== undefined) usage = message.usage;
    },

    addToolResult(block) {
      if (block?.type === 'tool_result') toolResults.push(block);
    },

    addUsage(nextUsage) {
      if (nextUsage && typeof nextUsage === 'object') usage = nextUsage;
    },

    addStreamEvent(event) {
      if (event?.type === 'message_start') {
        activeBlockByIndex.clear();
        partialToolInputs.clear();
        resetTurnBlockState(streamDeltaState);
        return;
      }

      if (event?.type === 'content_block_start') {
        const source = event.content_block;
        let block;
        if (source?.type === 'thinking') block = { type: 'thinking', thinking: '' };
        if (source?.type === 'text') block = { type: 'text', text: '' };
        if (source?.type === 'tool_use') {
          block = { type: 'tool_use', id: source.id || '', name: source.name || '', input: {} };
        }
        if (block) {
          activeBlockByIndex.set(event.index, streamedBlocks.length);
          streamedBlocks.push(block);
        }
        return;
      }

      if (event?.type === 'content_block_delta') {
        const blockIndex = activeBlockByIndex.get(event.index);
        const block = streamedBlocks[blockIndex];
        if (!block) return;
        if (event.delta?.type === 'thinking_delta' && block.type === 'thinking') {
          block.thinking += normalizeStreamDelta(streamDeltaState, 'thinking', event.index, event.delta.thinking || '');
        }
        if (event.delta?.type === 'text_delta' && block.type === 'text') {
          block.text += normalizeStreamDelta(streamDeltaState, 'text', event.index, event.delta.text || '');
        }
        if (event.delta?.type === 'input_json_delta' && block.type === 'tool_use') {
          const current = partialToolInputs.get(blockIndex) || '';
          const input = current + (event.delta.partial_json || '');
          partialToolInputs.set(blockIndex, input);
          try { block.input = JSON.parse(input); } catch { /* wait for complete JSON */ }
        }
      }
    },

    complete({ id, sessionId }) {
      const completeContent = streamedBlocks.length > 0 ? [...streamedBlocks] : [...content];
      if (streamedBlocks.length > 0) {
        for (const block of content) {
          if (block.type === 'text' && !completeContent.some((item) => item.type === 'text')) {
            completeContent.push(block);
          }
          if (block.type === 'thinking' && !completeContent.some((item) => item.type === 'thinking')) {
            completeContent.push(block);
          }
          if (block.type === 'tool_use') {
            const streamedTool = completeContent.find((item) => item.type === 'tool_use' && item.id === block.id);
            if (streamedTool) Object.assign(streamedTool, block);
            else completeContent.push(block);
          }
        }
      }
      const contentWithToolResults = interleaveToolResults(completeContent);
      if (contentWithToolResults.length === 0) return null;
      const message = { id, content: contentWithToolResults, sessionId };
      if (model !== undefined) message.model = model;
      if (usage !== undefined) message.usage = usage;
      return message;
    },
  };
}
