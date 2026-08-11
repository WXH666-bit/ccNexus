export function createDisposableQuery({ query, dispose } = {}) {
  if (!query || typeof query[Symbol.asyncIterator] !== 'function') {
    throw new Error('Disposable query requires an async iterable query');
  }

  let closePromise = null;

  async function close() {
    if (!closePromise) {
      closePromise = (async () => {
        try {
          await query.close?.();
        } finally {
          await dispose?.();
        }
      })();
    }
    return closePromise;
  }

  return {
    interrupt: async () => await query.interrupt?.(),
    close,
    [Symbol.asyncIterator]() {
      const iterator = query[Symbol.asyncIterator]();
      return {
        next: (...args) => iterator.next(...args),
        return: async (...args) => {
          try {
            return await iterator.return?.(...args) || { value: undefined, done: true };
          } finally {
            await close();
          }
        },
        throw: async (...args) => {
          try {
            return await iterator.throw?.(...args);
          } finally {
            await close();
          }
        },
      };
    },
  };
}
