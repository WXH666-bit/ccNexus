import { ipcMain, BrowserWindow, dialog } from 'electron'
import { getFileTree, readFile } from './fs/fs-service'
import { ClaudeProcess } from './claude/claude-process'
import { loadSessions, createSession, addMessage } from './claude/session-store'
import simpleGit from 'simple-git'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

let claudeProcess: ClaudeProcess | null = null
let currentProjectPath: string = process.cwd()
let currentSessionId: string | null = null

const dataDir = join(homedir(), '.ccNexus')
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true })
}

export function registerHandlers(mainWindow: BrowserWindow): void {
  // ===== Dialog =====
  ipcMain.handle('dialog:open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择项目文件夹'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      currentProjectPath = result.filePaths[0]
      return currentProjectPath
    }
    return null
  })

  // ===== Claude Code =====
  claudeProcess = new ClaudeProcess(mainWindow)

  ipcMain.handle('claude:start', async (_event, projectPath: string) => {
    claudeProcess?.start(projectPath)
  })

  ipcMain.handle('claude:send', async (_event, input: string) => {
    claudeProcess?.write(input)
  })

  ipcMain.handle('claude:stop', async () => {
    claudeProcess?.stop()
  })

  // ===== Sessions =====
  ipcMain.handle('claude:list-sessions', async () => {
    return loadSessions()
  })

  ipcMain.handle('claude:new-session', async (_event, projectPath: string) => {
    const session = createSession(projectPath)
    currentSessionId = session.id
    claudeProcess?.start(projectPath)
    return session
  })

  ipcMain.handle('claude:switch-session', async (_event, sessionId: string) => {
    const sessions = loadSessions()
    const session = sessions.find((s) => s.id === sessionId)
    if (session) {
      currentSessionId = session.id
      return session
    }
    return null
  })

  ipcMain.handle('claude:add-message', async (_event, sessionId: string, message: any) => {
    addMessage(sessionId, message)
  })

  ipcMain.handle('claude:current-session', async () => {
    if (!currentSessionId) return null
    const sessions = loadSessions()
    return sessions.find((s) => s.id === currentSessionId) || null
  })

  // ===== File System =====
  ipcMain.handle('fs:tree', async (_event, dirPath?: string) => {
    const projectRoot = dirPath || process.cwd()
    return getFileTree(projectRoot)
  })

  ipcMain.handle('fs:read', async (_event, filePath: string) => {
    return readFile(filePath)
  })

  // ===== Git =====
  const git = simpleGit(process.cwd())

  ipcMain.handle('git:status', async () => {
    try {
      const status = await git.status()
      return {
        staged: status.staged,
        modified: status.modified,
        untracked: status.not_added || [],
        currentBranch: status.current || 'unknown',
        ahead: status.ahead || 0,
        behind: status.behind || 0
      }
    } catch (e: any) {
      return {
        staged: [],
        modified: [],
        untracked: [],
        currentBranch: 'unknown',
        ahead: 0,
        behind: 0,
        error: e.message
      }
    }
  })

  ipcMain.handle('git:diff', async (_event, file?: string) => {
    try {
      const args = file ? [file] : []
      return await git.diff(args)
    } catch (e: any) {
      return e.message
    }
  })

  ipcMain.handle('git:stage', async (_event, files: string[]) => {
    try {
      await git.add(files)
    } catch (e: any) {
      throw new Error(`git add failed: ${e.message}`)
    }
  })

  ipcMain.handle('git:unstage', async (_event, files: string[]) => {
    try {
      await git.reset(['--', ...files])
    } catch (e: any) {
      throw new Error(`git reset failed: ${e.message}`)
    }
  })

  ipcMain.handle('git:commit', async (_event, message: string) => {
    try {
      await git.commit(message)
    } catch (e: any) {
      throw new Error(`git commit failed: ${e.message}`)
    }
  })

  ipcMain.handle('git:push', async () => {
    try {
      await git.push()
    } catch (e: any) {
      throw new Error(`git push failed: ${e.message}`)
    }
  })

  ipcMain.handle('git:pull', async () => {
    try {
      await git.pull()
    } catch (e: any) {
      throw new Error(`git pull failed: ${e.message}`)
    }
  })

  ipcMain.handle('git:branches', async () => {
    try {
      const result = await git.branch()
      return {
        current: result.current,
        branches: Object.keys(result.branches)
      }
    } catch (e: any) {
      return { current: 'unknown', branches: [] }
    }
  })

  ipcMain.handle('git:checkout', async (_event, branch: string) => {
    try {
      await git.checkout(branch)
    } catch (e: any) {
      throw new Error(`git checkout failed: ${e.message}`)
    }
  })
}
