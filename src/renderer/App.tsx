import React, { useEffect, useState } from 'react'
import { useUIStore } from './stores/ui-store'
import AppShell from './components/layout/AppShell'
import WelcomeScreen from './components/layout/WelcomeScreen'

const App: React.FC = () => {
  const fontSize = useUIStore((s) => s.fontSize)
  const [projectPath, setProjectPath] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`
  }, [fontSize])

  const handleOpenProject = async () => {
    const path = await window.electronAPI.dialog.openProject()
    if (path) {
      setProjectPath(path)
    }
  }

  if (!projectPath) {
    return <WelcomeScreen onOpenProject={handleOpenProject} />
  }

  return <AppShell projectPath={projectPath} onSwitchProject={handleOpenProject} />
}

export default App
