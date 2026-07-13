import React, { useState, useEffect, useRef } from 'react'
import { Send, Square, Play } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
}

const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init',
      role: 'system',
      text: 'ccNexus 就绪，点击 ▶ 启动 Claude Code 会话',
      timestamp: Date.now()
    }
  ])
  const [input, setInput] = useState('')
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStatus, setSessionStatus] = useState('idle')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const unsubOutput = window.electronAPI.claude.onOutput((data: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && Date.now() - last.timestamp < 5000) {
          return [
            ...prev.slice(0, -1),
            { ...last, text: last.text + data, timestamp: Date.now() }
          ]
        }
        return [...prev, {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          text: data,
          timestamp: Date.now()
        }]
      })
    })

    const unsubStatus = window.electronAPI.claude.onStatus((status: string) => {
      setSessionStatus(status)
      setSessionActive(status === 'running')

      if (status === 'running') {
        setMessages(prev => [...prev, {
          id: `sys-${Date.now()}`,
          role: 'system',
          text: '🟢 Claude Code 会话已启动',
          timestamp: Date.now()
        }])
      } else if (status === 'stopped') {
        setMessages(prev => [...prev, {
          id: `sys-${Date.now()}`,
          role: 'system',
          text: '🔴 Claude Code 会话已结束',
          timestamp: Date.now()
        }])
      } else if (status === 'error') {
        setSessionActive(false)
      }
    })

    return () => { unsubOutput(); unsubStatus() }
  }, [])

  const handleStart = () => {
    setSessionStatus('running')
    setSessionActive(true)
    setMessages(prev => [...prev, {
      id: `sys-${Date.now()}`,
      role: 'system',
      text: '正在启动 Claude Code...',
      timestamp: Date.now()
    }])
    window.electronAPI.claude.start('.')
  }

  const handleStop = () => {
    window.electronAPI.claude.stop()
    setSessionActive(false)
    setSessionStatus('stopped')
  }

  const handleSend = () => {
    if (!input.trim() || !sessionActive) return
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      text: input,
      timestamp: Date.now()
    }])
    window.electronAPI.claude.send(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-shrink-0"
           style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={sessionActive ? handleStop : handleStart}
          className="p-1.5 rounded transition-colors"
          style={{
            backgroundColor: sessionActive ? '#e06c75' : 'var(--color-accent)',
            color: '#fff'
          }}
          title={sessionActive ? '停止会话' : '启动会话'}
        >
          {sessionActive ? <Square size={12} /> : <Play size={12} />}
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{
            backgroundColor:
              sessionStatus === 'running' ? '#98c379' :
              sessionStatus === 'error' ? '#e06c75' : '#909296'
          }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {sessionStatus === 'running' ? '已连接' :
             sessionStatus === 'error' ? '错误' :
             sessionStatus === 'stopped' ? '已停止' : '空闲'}
          </span>
        </div>
      </div>

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

      <div className="p-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sessionActive
              ? '输入消息...（Enter 发送，Shift+Enter 换行）'
              : '请先启动 Claude Code 会话...'}
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
          <button
            onClick={handleSend}
            disabled={!input.trim() || !sessionActive}
            className="self-end p-2 rounded-md transition-colors disabled:opacity-30"
            style={{
              backgroundColor: (input.trim() && sessionActive) ? 'var(--color-accent)' : 'var(--color-border)',
              color: '#fff'
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatPanel
