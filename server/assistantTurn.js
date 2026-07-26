export function createAssistantTurn() {
  const content = [];
  const streamedThinking = new Map();
  let model;

  return {
    add(message) {
      if (Array.isArray(message?.content)) content.push(...message.content);
      if (message?.model !== undefined) model = message.model;
    },

    addStreamEvent(event) {
      if (event?.type === 'content_block_start'
        && event.content_block?.type === 'thinking') {
        streamedThinking.set(event.index, '');
      }
      if (event?.type === 'content_block_delta'
        && event.delta?.type === 'thinking_delta'
        && streamedThinking.has(event.index)) {
        streamedThinking.set(event.index, streamedThinking.get(event.index) + (event.delta.thinking || ''));
      }
    },

    complete({ id, sessionId }) {
      const hasTerminalThinking = content.some((block) => block.type === 'thinking');
      const thinking = hasTerminalThinking
        ? []
        : [...streamedThinking.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, value]) => ({ type: 'thinking', thinking: value }))
          .filter((block) => block.thinking.length > 0);
      const completeContent = [...thinking, ...content];
      if (completeContent.length === 0) return null;
      const message = { id, content: completeContent, sessionId };
      if (model !== undefined) message.model = model;
      return message;
    },
  };
}
