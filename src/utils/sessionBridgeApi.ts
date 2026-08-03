import type { ChatMessage, Session } from '../types';

function requireDesktopApi(): CcNexusDesktopApi {
  if (!window.ccNexusDesktop) {
    throw new Error('ccNexus desktop bridge is unavailable');
  }
  return window.ccNexusDesktop;
}

export async function getSessions() {
  return await requireDesktopApi().getSessions() as {
    type: 'session_list';
    sessions: Session[];
    deletedSessionIds?: string[];
  };
}

export async function loadSession(sessionId: string) {
  return await requireDesktopApi().loadSession(sessionId) as {
    type: 'session_history';
    sessionId: string;
    messages: ChatMessage[];
  };
}

export async function renameSession(sessionId: string, title: string) {
  return await requireDesktopApi().renameSession(sessionId, title);
}

export async function toggleFavoriteSession(sessionId: string) {
  return await requireDesktopApi().toggleFavoriteSession(sessionId);
}

export async function deleteSession(sessionId: string) {
  return await requireDesktopApi().deleteSession(sessionId);
}
