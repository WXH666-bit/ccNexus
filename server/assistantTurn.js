export function createAssistantTurn() {
  const content = [];
  let model;

  return {
    add(message) {
      if (Array.isArray(message?.content)) content.push(...message.content);
      if (message?.model !== undefined) model = message.model;
    },

    complete({ id, sessionId }) {
      if (content.length === 0) return null;
      const message = { id, content, sessionId };
      if (model !== undefined) message.model = model;
      return message;
    },
  };
}
