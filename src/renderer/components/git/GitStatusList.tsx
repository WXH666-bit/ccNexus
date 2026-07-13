import React from 'react'
import { PlusCircle, MinusCircle, FileText } from 'lucide-react'
import type { GitStatus } from './GitPanel'

interface Props {
  status: GitStatus
  onStage: (files: string[]) => void
  onUnstage: (files: string[]) => void
}

const STATUS_COLORS: Record<string, string> = {
  modified: '#e5c07b',
  added: '#98c379',
  deleted: '#e06c75',
  renamed: '#61afef',
}

const GitStatusList: React.FC<Props> = ({ status, onStage, onUnstage }) => {
  const renderFileList = (
    title: string,
    files: { path: string; status: string }[],
    action: 'stage' | 'unstage',
    icon: React.ReactNode
  ) => {
    if (files.length === 0) return null

    return (
      <div className="mb-1">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-[10px] font-semibold uppercase"
                style={{ color: 'var(--color-text-muted)' }}>
            {title} ({files.length})
          </span>
          <button
            onClick={() => {
              const paths = files.map(f => f.path)
              action === 'stage' ? onStage(paths) : onUnstage(paths)
            }}
            className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-70"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
          >
            {action === 'stage' ? 'Stage all' : 'Unstage all'}
          </button>
        </div>
        {files.map((f) => (
          <div
            key={f.path}
            className="flex items-center gap-1.5 px-3 py-0.5 cursor-pointer hover:opacity-70 group"
            onClick={() => {
              action === 'stage' ? onStage([f.path]) : onUnstage([f.path])
            }}
          >
            <span className="text-[10px]" style={{ color: STATUS_COLORS[f.status] || 'var(--color-text-muted)' }}>
              {f.status === 'added' ? 'A' :
               f.status === 'deleted' ? 'D' :
               f.status === 'renamed' ? 'R' : 'M'}
            </span>
            <span className="text-xs truncate flex-1">{f.path}</span>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: action === 'stage' ? '#98c379' : '#e06c75' }}>
              {action === 'stage' ? <PlusCircle size={12} /> : <MinusCircle size={12} />}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="py-1">
      {renderFileList('Staged', status.staged, 'unstage', <MinusCircle size={12} />)}
      {renderFileList('Changes', status.modified, 'stage', <PlusCircle size={12} />)}

      {status.untracked.length > 0 && (
        <div className="mb-1">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[10px] font-semibold uppercase"
                  style={{ color: 'var(--color-text-muted)' }}>
              Untracked ({status.untracked.length})
            </span>
            <button
              onClick={() => onStage(status.untracked)}
              className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-70"
              style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
            >
              Stage all
            </button>
          </div>
          {status.untracked.map((path) => (
            <div
              key={path}
              className="flex items-center gap-1.5 px-3 py-0.5 cursor-pointer hover:opacity-70 group"
              onClick={() => onStage([path])}
            >
              <span className="text-[10px]" style={{ color: '#909296' }}>U</span>
              <span className="text-xs truncate flex-1">{path}</span>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#98c379' }}>
                <PlusCircle size={12} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default GitStatusList
