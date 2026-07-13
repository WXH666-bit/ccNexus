import React from 'react'
import { FolderTree, GitBranch, Terminal, Plus, Minus, FolderOpen } from 'lucide-react'
import { useUIStore } from '../../stores/ui-store'

interface ToolbarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  gitPanelOpen: boolean
  onToggleGit: () => void
  projectPath: string
  onSwitchProject: () => void
  children?: React.ReactNode
}

const Toolbar: React.FC<ToolbarProps> = ({
  sidebarOpen, onToggleSidebar,
  gitPanelOpen, onToggleGit,
  projectPath, onSwitchProject,
  children
}) => {
  const { fontSize, increaseFont, decreaseFont } = useUIStore()
  const projectName = projectPath.split(/[/\\]/).pop() || projectPath

  return (
    <div className="h-10 flex items-center px-3 gap-2 flex-shrink-0 border-b"
         style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <span className="text-sm font-semibold mr-2" style={{ color: 'var(--color-accent)' }}>
        ccNexus
      </span>

      <button onClick={onToggleSidebar}
              className={`p-1.5 rounded transition-colors ${sidebarOpen ? 'opacity-100' : 'opacity-50'}`}
              style={{ color: 'var(--color-text-muted)' }} title="文件树">
        <FolderTree size={16} />
      </button>

      <button onClick={onToggleGit}
              className={`p-1.5 rounded transition-colors ${gitPanelOpen ? 'opacity-100' : 'opacity-50'}`}
              style={{ color: 'var(--color-text-muted)' }} title="Git 面板">
        <GitBranch size={16} />
      </button>

      {/* Project path */}
      <button onClick={onSwitchProject}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:opacity-70 truncate max-w-[200px]"
              style={{ color: 'var(--color-text-muted)' }} title={`项目: ${projectPath}\n点击切换`}>
        <FolderOpen size={12} />
        <span className="truncate">{projectName}</span>
      </button>

      {children}

      <div className="flex-1" />

      <button onClick={decreaseFont} className="p-1 rounded hover:opacity-70"
              style={{ color: 'var(--color-text-muted)' }} title="缩小字体">
        <Minus size={12} />
      </button>
      <span className="text-[10px] min-w-[24px] text-center" style={{ color: 'var(--color-text-muted)' }}>
        {fontSize}px
      </span>
      <button onClick={increaseFont} className="p-1 rounded hover:opacity-70"
              style={{ color: 'var(--color-text-muted)' }} title="放大字体">
        <Plus size={12} />
      </button>

      <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />

      <Terminal size={14} style={{ color: 'var(--color-text-muted)' }} />
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>master</span>
    </div>
  )
}

export default Toolbar
