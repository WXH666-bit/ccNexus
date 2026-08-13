export function createDesktopSessionController({ sessions }) {
  async function loadSession(sessionId) {
    return sessions.loadSession(sessionId);
  }

  return { loadSession };
}
