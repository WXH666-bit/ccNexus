import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'

export class ClaudeProcess {
  private process: ChildProcess | null = null
  private mainWindow: BrowserWindow
  private status: 'idle' | 'running' | 'stopped' = 'idle'
  private sessionId: string | null = null
  private projectPath: string = '.'

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  get isRunning(): boolean {
    return this.status === 'running' && this.process !== null
  }

  get currentStatus(): string {
    return this.status
  }

  start(projectPath: string): void {
    this.projectPath = projectPath
    this.sessionId = randomUUID()
    this.status = 'running'
    this.mainWindow.webContents.send('claude:status', 'running')
    this.mainWindow.webContents.send('claude:output', `\n[系统] Claude Code 会话已就绪 (session: ${this.sessionId.slice(0, 8)}...)\n\n`)
  }

  send(input: string): void {
    if (!this.sessionId) return

    const args = [
      '--print',
      input,
      '--session-id', this.sessionId,
    ]

    this.process = spawn('claude', args, {
      cwd: this.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      },
      shell: true,
    })

    let output = ''

    this.process.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      output += text
      this.mainWindow.webContents.send('claude:output', text)
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.mainWindow.webContents.send('claude:output', chunk.toString('utf-8'))
    })

    this.process.on('exit', (code) => {
      this.process = null
      if (code !== 0 && code !== null) {
        this.mainWindow.webContents.send('claude:output', `\n[系统] Claude Code 返回错误码: ${code}\n`)
      }
    })

    this.process.on('error', (err) => {
      this.process = null
      this.mainWindow.webContents.send('claude:output', `\n[错误] ${err.message}\n`)
    })
  }

  write(input: string): void {
    this.send(input)
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.sessionId = null
    this.status = 'stopped'
    this.mainWindow.webContents.send('claude:status', 'stopped')
  }

  forceKill(): void {
    if (this.process) {
      this.process.kill('SIGKILL')
      this.process = null
    }
    this.status = 'stopped'
  }
}
