/**
 * Keeps client commands issued before a WebSocket is ready. React effects can
 * run before the socket's `open` event, so silently dropping those commands
 * makes initial data such as the session list appear empty.
 */
export function createOutboundMessageQueue(deliver) {
  const pending = [];

  return {
    send(message, isOpen) {
      if (isOpen) {
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
