import React, { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'

const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState([
    { role: 'system', text: 'ccNexus ready. Claude Code session will connect here.' }
  ])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)

  const handleSend = () => {
    if (!input.trim()) return
    setMessages(prev => [...prev, { role: 'user', text: input }])
    setInput('')
    // TODO: wire to claude:send IPC
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`
            ${msg.role === 'user'
              ? 'ml-8'
              : msg.role === 'system'
                ? 'text-center'
                : 'mr-8'}
          `}>
            {msg.role !== 'system' && (
              <div className="text-xs mb-1 font-medium" style={{ color: 'var(--color-accent)' }}>
                {msg.role === 'user' ? 'You' : 'Claude'}
              </div>
            )}
            <div
              className={`rounded-lg p-3 text-sm ${
                msg.role === 'system'
                  ? ''
                  : msg.role === 'user'
                    ? ''
                    : ''
              }`}
              style={msg.role !== 'system' ? {
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                border: '1px solid'
              } : {}}
            >
              <p style={msg.role === 'system' ? { color: 'var(--color-text-muted)' } : {}}>
                {msg.text}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to Claude... (Enter to send, Shift+Enter for new line)"
            rows={2}
            className="flex-1 resize-none rounded-md p-2 text-sm outline-none"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: 'var(--color-border)',
              border: '1px solid'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="self-end p-2 rounded-md transition-colors"
            style={{
              backgroundColor: input.trim() ? 'var(--color-accent)' : 'var(--color-border)',
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
