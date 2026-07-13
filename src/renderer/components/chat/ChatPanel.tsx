import React, { useState, useEffect, useRef } from 'react'
import { Send, Square, Play, Paperclip, X } from 'lucide-react'
import ModelSelector from './ModelSelector'
import PermissionSelector from './PermissionSelector'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
}

interface Attachment {
  path: string
  name: string
  type: 'image' | 'file'
}

interface ChatPanelProps {
  projectPath: string
  sessionId: string | null
}

const ChatPanel: React.FC<ChatPanelProps> = ({ projectPath, sessionId }) => {
  const [messages, setMessages] = useState<Message[]>([{
    id: 'init',
    role: 'system',
    text: sessionId
      ? 'ccNexus 就绪，点击 ▶ 启动 Claude Code 会话'
      : '请先创建一个会话（点击工具栏的 ➕）',
    timestamp: Date.now()
  }])
  const [input, setInput] = useState('')
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStatus, setSessionStatus] = useState('idle')
  const [model, setModel] = useState<string | null>(null)
  const [permMode, setPermMode] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isImage = (path: string) => /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(path)

  const saveMsg = async (msg: Message) => {
    if (!sessionId) return
    try { await window.electronAPI.claude.addMessage(sessionId, msg) } catch { /* ignore */ }
  }

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (!sessionId) return
    window.electronAPI.claude.currentSession().then(session => {
      if (session?.messages?.length) setMessages(session.messages)
    })
  }, [sessionId])

  useEffect(() => {
    const unsubOutput = window.electronAPI.claude.onOutput((data: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        let newMsg: Message
        if (last && last.role === 'assistant' && Date.now() - last.timestamp < 5000) {
          newMsg = { ...last, text: last.text + data, timestamp: Date.now() }
        } else {
          newMsg = { id: `asst-${Date.now()}`, role: 'assistant', text: data, timestamp: Date.now() }
        }
        saveMsg(newMsg)
        return last?.role === 'assistant' && Date.now() - last.timestamp < 5000
          ? [...prev.slice(0, -1), newMsg]
          : [...prev, newMsg]
      })
    })
    const unsubStatus = window.electronAPI.claude.onStatus((status: string) => {
      setSessionStatus(status)
      setSessionActive(status === 'running')
      const msg: Message = { id: `sys-${Date.now()}`, role: 'system',
        text: status === 'running' ? '🟢 Claude Code 会话已启动' :
              status === 'stopped' ? '🔴 Claude Code 会话已结束' : '', timestamp: Date.now() }
      if (status === 'running' || status === 'stopped') {
        setMessages(prev => [...prev, msg])
        saveMsg(msg)
      }
    })
    return () => { unsubOutput(); unsubStatus() }
  }, [sessionId])

  const handleStart = () => {
    setSessionStatus('running'); setSessionActive(true)
    const msg: Message = { id: `sys-${Date.now()}`, role: 'system', text: '正在启动 Claude Code...', timestamp: Date.now() }
    setMessages(prev => [...prev, msg]); saveMsg(msg)
    window.electronAPI.claude.start(projectPath)
  }

  const handleStop = () => {
    window.electronAPI.claude.stop()
    setSessionActive(false); setSessionStatus('stopped')
  }

  const handleAttach = async () => {
    const files = await window.electronAPI.dialog.openFile()
    if (files && files.length > 0) {
      setAttachments(prev => [...prev, ...files.map((f: string) => ({
        path: f,
        name: f.split(/[/\\]/).pop() || f,
        type: isImage(f) ? 'image' as const : 'file' as const
      }))])
    }
  }

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || !sessionActive) return

    let prompt = input.trim()
    if (attachments.length > 0) {
      const paths = attachments.map(a => a.path).join('\n')
      prompt = prompt ? `${prompt}\n\n附件文件:\n${paths}` : `请分析以下文件:\n${paths}`
    }

    const msg: Message = { id: `user-${Date.now()}`, role: 'user', text: prompt, timestamp: Date.now() }
    setMessages(prev => [...prev, msg]); saveMsg(msg)
    window.electronAPI.claude.send(prompt)
    setInput(''); setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`
            ${msg.role === 'user' ? 'flex justify-end'
              : msg.role === 'system' ? 'flex justify-center'
              : 'flex justify-start'}
          `}>
            <div className="max-w-[80%]">
              {msg.role !== 'system' && (
                <div className="text-[10px] mb-0.5 font-semibold px-1"
                     style={{ color: msg.role === 'user' ? '#61afef' : 'var(--color-text-muted)' }}>
                  {msg.role === 'user' ? '我' : 'Claude'}
                </div>
              )}
              <div className="rounded-lg px-3 py-2 text-sm"
                   style={msg.role !== 'system' ? {
                     backgroundColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--color-surface)',
                     color: msg.role === 'user' ? '#fff' : 'var(--color-text)',
                     borderColor: msg.role !== 'user' ? 'var(--color-border)' : 'transparent',
                     border: msg.role !== 'user' ? '1px solid' : 'none'
                   } : {}}>
                <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {msg.text}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 px-3 pt-2 flex-wrap">
            {attachments.map((a, i) => (
              <div key={i} className="relative group"
                   style={{ backgroundColor: 'var(--color-bg)', borderRadius: 4, overflow: 'hidden' }}>
                {a.type === 'image' ? (
                  <img src={`file://${a.path}`} alt={a.name}
                       className="h-12 w-12 object-cover" />
                ) : (
                  <div className="h-12 px-2 flex items-center text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    {a.name.slice(0, 15)}
                  </div>
                )}
                <button onClick={() => removeAttachment(i)}
                        className="absolute top-0 right-0 p-0.5 opacity-0 group-hover:opacity-100"
                        style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text input */}
        <div className="p-3 pb-1">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sessionActive ? '输入消息...（Enter 发送，Shift+Enter 换行）' : '请先创建会话并点击 ▶ 启动...'}
              disabled={!sessionActive}
              rows={2}
              className="flex-1 resize-none rounded-md p-2 text-sm outline-none disabled:opacity-40"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: 'var(--color-border)',
                border: '1px solid'
              }}
            />
            <button onClick={handleSend}
                    disabled={(!input.trim() && attachments.length === 0) || !sessionActive}
                    className="self-end p-2 rounded-md transition-colors disabled:opacity-30"
                    style={{
                      backgroundColor: ((input.trim() || attachments.length > 0) && sessionActive) ? 'var(--color-accent)' : 'var(--color-border)',
                      color: '#fff'
                    }}>
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* Bottom bar: model + permission + attach + play/stop */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <button onClick={sessionActive ? handleStop : handleStart}
                  disabled={!sessionId}
                  className="p-1 rounded transition-colors disabled:opacity-30"
                  style={{ backgroundColor: sessionActive ? '#e06c75' : 'var(--color-accent)', color: '#fff' }}
                  title={sessionActive ? '停止' : '启动'}>
            {sessionActive ? <Square size={10} /> : <Play size={10} />}
          </button>

          <div className="w-px h-4" style={{ backgroundColor: 'var(--color-border)' }} />

          <ModelSelector value={model} onChange={setModel} />

          <div className="w-px h-4" style={{ backgroundColor: 'var(--color-border)' }} />

          <PermissionSelector value={permMode} onChange={setPermMode} />

          <div className="flex-1" />

          <button onClick={handleAttach}
                  className="p-1 rounded hover:opacity-70"
                  style={{ color: 'var(--color-text-muted)' }} title="添加附件">
            <Paperclip size={14} />
          </button>

          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{
              backgroundColor: sessionStatus === 'running' ? '#98c379' :
                sessionStatus === 'error' ? '#e06c75' : '#909296'
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatPanel
