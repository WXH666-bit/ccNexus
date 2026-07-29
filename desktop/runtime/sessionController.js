function titleFromMessages(messages) {
  const userText = messages
    ?.find((message) => message?.role === 'user')
    ?.content
    ?.find((block) => block?.type === 'text')
    ?.text;
  return typeof userText === 'string' && userText.trim()
    ? userText.trim().slice(0, 60)
    : 'Loaded session';
}

export function createDesktopSessionController({ runtime, sessions }) {
  async function loadSession(sessionId) {
    const history = await sessions.loadSession(sessionId);
    if (history?.sessionId) {
      runtime.ensureSessionDaemon({
        sessionId: history.sessionId,
        title: titleFromMessages(history.messages),
      });
    }
    return history;
  }

  return { loadSession };
}
