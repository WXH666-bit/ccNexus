import React from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
}

const GitCommitForm: React.FC<Props> = ({ value, onChange, onCommit }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      onCommit()
    }
  }

  return (
    <div className="p-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="提交信息（Ctrl+Enter 提交）"
          className="flex-1 text-xs px-2 py-1.5 rounded outline-none"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: 'var(--color-border)',
            border: '1px solid'
          }}
        />
        <button
          onClick={onCommit}
          disabled={!value.trim()}
          className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-30"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          提交
        </button>
      </div>
    </div>
  )
}

export default GitCommitForm
