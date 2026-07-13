import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DATA_DIR = join(homedir(), '.ccNexus')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

export interface SessionRecord {
  id: string
  name: string
  projectPath: string
  createdAt: string
  lastActiveAt: string
  messageCount: number
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    text: string
    timestamp: number
  }>
}

export function loadSessions(): SessionRecord[] {
  try {
    if (!existsSync(SESSIONS_FILE)) return []
    const raw = readFileSync(SESSIONS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveSessions(sessions: SessionRecord[]): void {
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8')
}

export function createSession(projectPath: string): SessionRecord {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const session: SessionRecord = {
    id,
    name: `会话 ${new Date().toLocaleString('zh-CN')}`,
    projectPath,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    messageCount: 0,
    messages: []
  }

  const sessions = loadSessions()
  sessions.unshift(session)
  saveSessions(sessions)
  return session
}

export function updateSession(
  id: string,
  updates: Partial<Pick<SessionRecord, 'messages' | 'messageCount' | 'lastActiveAt' | 'name'>>
): SessionRecord | null {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return null

  sessions[idx] = { ...sessions[idx], ...updates, lastActiveAt: new Date().toISOString() }
  saveSessions(sessions)
  return sessions[idx]
}

export function addMessage(sessionId: string, message: SessionRecord['messages'][0]): void {
  const sessions = loadSessions()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return

  session.messages.push(message)
  session.messageCount = session.messages.filter((m) => m.role !== 'system').length
  session.lastActiveAt = new Date().toISOString()
  saveSessions(sessions)
}
