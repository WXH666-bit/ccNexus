import React, { useState } from 'react'
import Toolbar from './Toolbar'
import FileTree from '../files/FileTree'
import ChatPanel from '../chat/ChatPanel'
import GitPanel from '../git/GitPanel'
import FilePreview from '../files/FilePreview'

const AppShell: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [gitPanelOpen, setGitPanelOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        gitPanelOpen={gitPanelOpen}
        onToggleGit={() => setGitPanelOpen(!gitPanelOpen)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - File Tree */}
        {sidebarOpen && (
          <div className="w-64 flex-shrink-0 border-r flex flex-col"
               style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="p-3 text-xs font-semibold uppercase tracking-wide"
                 style={{ color: 'var(--color-text-muted)' }}>
              文件
            </div>
            <FileTree onSelectFile={setSelectedFile} />
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <FilePreview filePath={selectedFile} onClose={() => setSelectedFile(null)} />
          ) : (
            <ChatPanel />
          )}
        </div>
      </div>

      {/* Bottom Git Panel */}
      {gitPanelOpen && (
        <div className="h-56 flex-shrink-0 border-t"
             style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <GitPanel />
        </div>
      )}
    </div>
  )
}

export default AppShell
