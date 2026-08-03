/**
 * Keeps desktop commands issued before the preload event channel is ready.
 * React effects can run before the Electron listener is attached, so silently
 * dropping those commands makes initial data such as the session list empty.
 */
export function createOutboundMessageQueue(deliver) {
  const pending = [];

  return {
    send(message, isReady) {
      if (isReady) {
        deliver(message);
      } else {
        pending.push(message);
      }
    },

    flush() {
      while (pending.length > 0) {
        deliver(pending.shift());
      }
    },

    clear() {
      pending.length = 0;
    },

    size() {
      return pending.length;
    },
  };
}

export function createInboundMessageQueue() {
  const messages = [];

  return {
    push(message) {
      messages.push(message);
    },

    consumeFrom(cursor) {
      const nextCursor = messages.length;
      return {
        messages: messages.slice(cursor),
        nextCursor,
      };
    },

    clear() {
      messages.length = 0;
    },

    size() {
      return messages.length;
    },
  };
}
