import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'

export class ClaudeProcess {
  private process: ChildProcess | null = null
  private mainWindow: BrowserWindow
  private status: 'idle' | 'running' | 'stopped' = 'idle'

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
    if (this.isRunning) {
      this.stop()
    }

    this.status = 'running'
    this.mainWindow.webContents.send('claude:status', 'running')

    this.process = spawn('claude', [], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        CI: 'true',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      },
      shell: true,
    })

    // stdout → renderer
    this.process.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      this.mainWindow.webContents.send('claude:output', text)
    })

    // stderr → renderer (also useful)
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      this.mainWindow.webContents.send('claude:output', text)
    })

    // Exit
    this.process.on('exit', (code) => {
      this.status = 'stopped'
      this.process = null
      this.mainWindow.webContents.send('claude:status', 'stopped')
      this.mainWindow.webContents.send('claude:exit', code)
    })

    // Error (e.g., claude not found)
    this.process.on('error', (err) => {
      this.status = 'stopped'
      this.process = null
      this.mainWindow.webContents.send('claude:output', `\n[Error] Claude Code failed to start: ${err.message}\n`)
      this.mainWindow.webContents.send('claude:output', `\nMake sure Claude Code is installed: npm install -g @anthropic-ai/claude-code\n`)
      this.mainWindow.webContents.send('claude:status', 'error')
    })
  }

  write(input: string): void {
    if (this.process && this.isRunning) {
      this.process.stdin?.write(input + '\n')
    }
  }

  stop(): void {
    if (!this.process) return

    // Graceful shutdown: Ctrl+C → wait → EOF → force kill
    this.process.stdin?.write('\x03')
    setTimeout(() => {
      if (this.process) {
        this.process.stdin?.end()
      }
      setTimeout(() => {
        if (this.process) {
          this.process.kill()
          this.process = null
          this.status = 'stopped'
        }
      }, 2000)
    }, 500)
  }

  forceKill(): void {
    if (this.process) {
      this.process.kill('SIGKILL')
      this.process = null
    }
    this.status = 'stopped'
  }
}
