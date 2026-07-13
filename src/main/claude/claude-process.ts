import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { loadConfig } from './config-store'

export class ClaudeProcess {
  private process: ChildProcess | null = null
  private mainWindow: BrowserWindow
  private status: 'idle' | 'running' | 'stopped' = 'idle'
  private sessionId: string | null = null
  private projectPath: string = '.'
  private model: string | null = null
  private permissionMode: string | null = null

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  setModel(model: string | null): void {
    this.model = model
  }

  setPermissionMode(mode: string | null): void {
    this.permissionMode = mode
  }

  private getClaudePath(): string {
    const config = loadConfig()
    return config.claudePath || 'claude'
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

  send(input: string, attachments?: string[]): void {
    if (!this.sessionId) return

    const args = [
      '--print',
      input,
      '--session-id', this.sessionId,
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
    ]

    if (this.model) {
      args.push('--model', this.model)
    }

    if (this.permissionMode) {
      args.push('--permission-mode', this.permissionMode)
    }

    // Add file attachments as --add-dir
    if (attachments && attachments.length > 0) {
      const dirs = new Set<string>()
      for (const f of attachments) {
        const dir = f.replace(/[/\\][^/\\]*$/, '')
        dirs.add(dir)
      }
      args.push('--add-dir', ...dirs)
    }

    const claudePath = this.getClaudePath()

    this.process = spawn(claudePath, args, {
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

    let lineBuffer = ''

    const processLine = (line: string) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line)
        // Extract text from stream-json format
        let text = ''
        let isThinking = false

        if (obj.type === 'stream_event') {
          const evt = obj.event || {}
          if (evt.type === 'content_block_delta') {
            const delta = evt.delta || {}
            if (delta.type === 'text_delta') {
              text = delta.text || ''
            } else if (delta.type === 'thinking_delta') {
              text = delta.thinking || ''
              isThinking = true
            } else if (delta.type === 'input_json_delta') {
              text = delta.partial_json || ''
            }
          }
        } else if (obj.type === 'assistant') {
          // Final message
          const content = obj.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') text += block.text || ''
              if (block.type === 'thinking') { text += block.thinking || ''; isThinking = true }
            }
          }
        } else if (obj.type === 'system') {
          text = obj.subtype ? `[${obj.subtype}] ` : ''
        } else if (obj.type === 'user') {
          // Skip user message echo
          return
        } else if (obj.type === 'result') {
          text = obj.result || ''
        }

        if (text) {
          const prefix = isThinking ? '💭 ' : ''
          this.mainWindow.webContents.send('claude:output', prefix + text)
        }
      } catch {
        // Not JSON, send as-is
        this.mainWindow.webContents.send('claude:output', line)
      }
    }

    this.process.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      lineBuffer += text
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || '' // Keep incomplete last line
      for (const line of lines) {
        processLine(line)
      }
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      // stderr might also contain stream-json or debug logs
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          try {
            const obj = JSON.parse(line)
            if (obj.type === 'stream_event') {
              processLine(line)
              continue
            }
          } catch {}
          this.mainWindow.webContents.send('claude:output', `[stderr] ${line}`)
        }
      }
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
