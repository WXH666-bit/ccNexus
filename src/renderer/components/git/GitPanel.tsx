import React from 'react'
import { GitBranch, Plus, Minus } from 'lucide-react'

const GitPanel: React.FC = () => {
  return (
    <div className="h-full flex flex-col p-3">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch size={14} style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-medium">Git</span>
        <span className="text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
          master
        </span>
      </div>

      {/* Placeholder sections */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          Staged Changes (0)
        </div>
        <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          Changes (0)
        </div>
        <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          Untracked Files (0)
        </div>
      </div>

      <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button className="flex-1 text-xs py-1.5 rounded"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
          Commit
        </button>
        <button className="text-xs py-1.5 px-3 rounded"
                style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
          Push
        </button>
        <button className="text-xs py-1.5 px-3 rounded"
                style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
          Pull
        </button>
      </div>
    </div>
  )
}

export default GitPanel
