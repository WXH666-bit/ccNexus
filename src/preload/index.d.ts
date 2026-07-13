export interface ElectronAPI {
  claude: {
    start: (projectPath: string) => Promise<void>
    send: (input: string) => Promise<void>
    stop: () => Promise<void>
    listSessions: () => Promise<any[]>
    newSession: (projectPath: string) => Promise<any>
    switchSession: (sessionId: string) => Promise<any>
    addMessage: (sessionId: string, message: any) => Promise<void>
    currentSession: () => Promise<any>
    onOutput: (cb: (data: string) => void) => () => void
    onStatus: (cb: (status: string) => void) => () => void
    onExit: (cb: (code: number | null) => void) => () => void
  }
  dialog: {
    openProject: () => Promise<string | null>
    openFile: () => Promise<string[]>
  }
  settings: {
    readClaude: () => Promise<any>
    writeClaude: (s: any) => Promise<void>
    readCcNexus: () => Promise<any>
    writeCcNexus: (c: any) => Promise<void>
    checkClaudePath: (p: string) => Promise<{ valid: boolean; version?: string; error?: string }>
  }
  fs: {
    getTree: (dirPath?: string) => Promise<FileNode[]>
    readFile: (filePath: string) => Promise<string>
  }
  git: {
    status: () => Promise<GitStatus>
    diff: (file?: string) => Promise<string>
    stage: (files: string[]) => Promise<void>
    unstage: (files: string[]) => Promise<void>
    commit: (message: string) => Promise<void>
    push: () => Promise<void>
    pull: () => Promise<void>
    branches: () => Promise<BranchInfo>
    checkout: (branch: string) => Promise<void>
  }
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

export interface GitStatus {
  staged: GitFile[]
  modified: GitFile[]
  untracked: GitFile[]
  currentBranch: string
  ahead: number
  behind: number
}

export interface GitFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
}

export interface BranchInfo {
  current: string
  branches: string[]
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
