import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DATA_DIR = join(homedir(), '.ccNexus')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

interface CcNexusConfig {
  claudePath: string
}

const DEFAULT_CONFIG: CcNexusConfig = {
  claudePath: 'claude'
}

export function loadConfig(): CcNexusConfig {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    if (!existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
      return DEFAULT_CONFIG
    }
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: CcNexusConfig): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

// Claude Code settings (read from ~/.claude/settings.json)
const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json')

export function readClaudeSettings(): any {
  try {
    if (!existsSync(CLAUDE_SETTINGS)) return {}
    return JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8'))
  } catch {
    return {}
  }
}

export function writeClaudeSettings(settings: any): void {
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2))
}

// Validate claude path by running --version
export async function validateClaudePath(claudePath: string): Promise<{ valid: boolean; version?: string; error?: string }> {
  const { spawn } = await import('child_process')
  return new Promise((resolve) => {
    const proc = spawn(claudePath, ['--version'], { shell: true, timeout: 10000 })
    let output = ''
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })
    proc.on('error', (err: any) => resolve({ valid: false, error: err.message }))
    proc.on('exit', (code) => {
      resolve(code === 0 ? { valid: true, version: output.trim() } : { valid: false, error: output.trim() || `exit code ${code}` })
    })
  })
}
