import React, { useState, useCallback } from 'react'
import Toolbar from './Toolbar'
import FileTree from '../files/FileTree'
import ChatPanel from '../chat/ChatPanel'
import GitPanel from '../git/GitPanel'
import FilePreview from '../files/FilePreview'
import SessionBar from '../chat/SessionBar'
import SettingsPanel from '../settings/SettingsPanel'

interface AppShellProps {
  projectPath: string
  onSwitchProject: () => void
}

const AppShell: React.FC<AppShellProps> = ({ projectPath, onSwitchProject }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [gitPanelOpen, setGitPanelOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleNewSession = useCallback(async () => {
    const session = await window.electronAPI.claude.newSession(projectPath)
    if (session) setSessionId(session.id)
  }, [projectPath])

  const handleSwitchSession = useCallback(async (id: string) => {
    const session = await window.electronAPI.claude.switchSession(id)
    if (session) setSessionId(session.id)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        gitPanelOpen={gitPanelOpen}
        onToggleGit={() => setGitPanelOpen(!gitPanelOpen)}
        projectPath={projectPath}
        onSwitchProject={onSwitchProject}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        <SessionBar
          currentSessionId={sessionId}
          projectPath={projectPath}
          onNewSession={handleNewSession}
          onSwitchSession={handleSwitchSession}
        />
      </Toolbar>

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <div className="w-64 flex-shrink-0 border-r flex flex-col"
               style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="p-3 text-xs font-semibold uppercase tracking-wide"
                 style={{ color: 'var(--color-text-muted)' }}>
              文件
            </div>
            <FileTree onSelectFile={setSelectedFile} projectPath={projectPath} />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <FilePreview filePath={selectedFile} onClose={() => setSelectedFile(null)} />
          ) : (
            <ChatPanel projectPath={projectPath} sessionId={sessionId} />
          )}
        </div>
      </div>

      {gitPanelOpen && (
        <div className="h-56 flex-shrink-0 border-t"
             style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <GitPanel />
        </div>
      )}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default AppShell
