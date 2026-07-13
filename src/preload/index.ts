import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Claude
  claude: {
    start: (projectPath: string) => ipcRenderer.invoke('claude:start', projectPath),
    send: (input: string) => ipcRenderer.invoke('claude:send', input),
    stop: () => ipcRenderer.invoke('claude:stop'),
    onOutput: (cb: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: string) => cb(data)
      ipcRenderer.on('claude:output', handler)
      return () => ipcRenderer.removeListener('claude:output', handler)
    },
    onStatus: (cb: (status: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: string) => cb(status)
      ipcRenderer.on('claude:status', handler)
      return () => ipcRenderer.removeListener('claude:status', handler)
    },
    onExit: (cb: (code: number | null) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, code: number | null) => cb(code)
      ipcRenderer.on('claude:exit', handler)
      return () => ipcRenderer.removeListener('claude:exit', handler)
    }
  },
  // File System
  fs: {
    getTree: (dirPath?: string) => ipcRenderer.invoke('fs:tree', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read', filePath)
  },
  // Git
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    diff: (file?: string) => ipcRenderer.invoke('git:diff', file),
    stage: (files: string[]) => ipcRenderer.invoke('git:stage', files),
    unstage: (files: string[]) => ipcRenderer.invoke('git:unstage', files),
    commit: (message: string) => ipcRenderer.invoke('git:commit', message),
    push: () => ipcRenderer.invoke('git:push'),
    pull: () => ipcRenderer.invoke('git:pull'),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (branch: string) => ipcRenderer.invoke('git:checkout', branch),
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
