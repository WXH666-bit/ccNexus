import { ipcMain, BrowserWindow } from 'electron'
import { getFileTree, readFile } from './fs/fs-service'
import simpleGit from 'simple-git'
import { join } from 'path'

export function registerHandlers(mainWindow: BrowserWindow): void {
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
