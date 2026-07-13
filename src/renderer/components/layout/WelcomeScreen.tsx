import React from 'react'
import { FolderOpen } from 'lucide-react'

interface WelcomeScreenProps {
  onOpenProject: () => void
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onOpenProject }) => {
  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="text-center">
        <div className="text-5xl mb-6">🦾</div>
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--color-accent)' }}>
          ccNexus
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--color-text-muted)' }}>
          Claude Code 可视化工作台
        </p>
        <button
          onClick={onOpenProject}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium text-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          <FolderOpen size={18} />
          打开项目文件夹
        </button>
        <p className="text-xs mt-4" style={{ color: 'var(--color-text-muted)' }}>
          选择一个文件夹开始使用 Claude Code
        </p>
      </div>
    </div>
  )
}

export default WelcomeScreen
