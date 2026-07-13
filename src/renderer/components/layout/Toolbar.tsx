import React from 'react'
import { FolderTree, GitBranch, Terminal } from 'lucide-react'

interface ToolbarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  gitPanelOpen: boolean
  onToggleGit: () => void
}

const Toolbar: React.FC<ToolbarProps> = ({
  sidebarOpen,
  onToggleSidebar,
  gitPanelOpen,
  onToggleGit
}) => {
  return (
    <div className="h-10 flex items-center px-3 gap-2 flex-shrink-0 border-b"
         style={{
           backgroundColor: 'var(--color-surface)',
           borderColor: 'var(--color-border)'
         }}>
      <span className="text-sm font-semibold mr-4" style={{ color: 'var(--color-accent)' }}>
        ccNexus
      </span>

      <button
        onClick={onToggleSidebar}
        className={`p-1.5 rounded transition-colors ${sidebarOpen ? 'opacity-100' : 'opacity-50'}`}
        style={{ color: 'var(--color-text-muted)' }}
        title="文件树"
      >
        <FolderTree size={16} />
      </button>

      <button
        onClick={onToggleGit}
        className={`p-1.5 rounded transition-colors ${gitPanelOpen ? 'opacity-100' : 'opacity-50'}`}
        style={{ color: 'var(--color-text-muted)' }}
        title="Toggle Git Panel"
      >
        <GitBranch size={16} />
      </button>

      <div className="flex-1" />

      <Terminal size={14} style={{ color: 'var(--color-text-muted)' }} />
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        master
      </span>
    </div>
  )
}

export default Toolbar
