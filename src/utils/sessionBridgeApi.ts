import type { ChatMessage, Session } from '../types';

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function getSessions() {
  if (window.ccNexusDesktop?.getSessions) {
    return await window.ccNexusDesktop?.getSessions() as {
      type: 'session_list';
      sessions: Session[];
      deletedSessionIds?: string[];
    };
  }
  const sessions = await readJson<Session[]>(await fetch('/api/sessions'));
  return { type: 'session_list' as const, sessions, deletedSessionIds: [] };
}

export async function loadSession(sessionId: string) {
  if (!window.ccNexusDesktop?.loadSession) {
    throw new Error('Desktop session loading is unavailable');
  }
  return await window.ccNexusDesktop?.loadSession(sessionId) as {
    type: 'session_history';
    sessionId: string;
    messages: ChatMessage[];
  };
}

export async function renameSession(sessionId: string, title: string) {
  if (window.ccNexusDesktop?.renameSession) {
    return await window.ccNexusDesktop?.renameSession(sessionId, title);
  }
  await readJson<Session>(
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  );
  return { type: 'session_renamed' as const, session_id: sessionId, title };
}

export async function deleteSession(sessionId: string) {
  if (window.ccNexusDesktop?.deleteSession) {
    return await window.ccNexusDesktop?.deleteSession(sessionId);
  }
  await readJson<{ ok: boolean }>(
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  );
  return { type: 'session_deleted' as const, sessionId };
}
