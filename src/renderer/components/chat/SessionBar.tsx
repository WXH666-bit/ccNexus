import React, { useEffect, useState } from 'react'
import { ChevronDown, Plus, MessageSquare } from 'lucide-react'

interface SessionBarProps {
  currentSessionId: string | null
  projectPath: string
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
}

const SessionBar: React.FC<SessionBarProps> = ({
  currentSessionId,
  projectPath,
  onNewSession,
  onSwitchSession
}) => {
  const [sessions, setSessions] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [currentName, setCurrentName] = useState('新会话')

  useEffect(() => {
    const load = async () => {
      const list = await window.electronAPI.claude.listSessions()
      setSessions(list)
      if (currentSessionId) {
        const cur = list.find((s: any) => s.id === currentSessionId)
        if (cur) setCurrentName(cur.name)
      }
    }
    load()
  }, [currentSessionId])

  return (
    <div className="relative">
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs hover:opacity-70"
          style={{ color: 'var(--color-text)' }}
        >
          <MessageSquare size={12} style={{ color: 'var(--color-accent)' }} />
          <span className="truncate max-w-[160px]">{currentName}</span>
          <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        <button
          onClick={onNewSession}
          className="p-0.5 rounded hover:opacity-70 ml-1"
          style={{ color: 'var(--color-accent)' }}
          title="新建会话"
        >
          <Plus size={14} />
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-2 z-20 w-64 rounded-md shadow-lg border overflow-hidden"
               style={{
                 backgroundColor: 'var(--color-surface)',
                 borderColor: 'var(--color-border)'
               }}>
            <div className="p-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              历史会话
            </div>
            <div className="max-h-60 overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="p-3 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                  暂无历史会话
                </div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSwitchSession(s.id)
                      setOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70 border-b"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: s.id === currentSessionId ? 'var(--color-bg)' : 'transparent'
                    }}
                  >
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {s.messageCount} 条消息 · {new Date(s.lastActiveAt).toLocaleString('zh-CN')}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default SessionBar
