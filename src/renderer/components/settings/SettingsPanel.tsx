import React, { useEffect, useState } from 'react'
import { X, Check, ExternalLink, FolderOpen, Server, Puzzle, Terminal } from 'lucide-react'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

interface McpServer {
  name: string
  command?: string
  args?: string[]
  url?: string
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const [tab, setTab] = useState<'path' | 'mcp' | 'skills'>('path')
  const [claudePath, setClaudePath] = useState('claude')
  const [pathValid, setPathValid] = useState<boolean | null>(null)
  const [pathResult, setPathResult] = useState('')
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [skills, setSkills] = useState<string[]>([])

  useEffect(() => {
    if (!open) return

    // Load Claude path
    window.electronAPI.settings.readCcNexus().then((c: any) => {
      setClaudePath(c.claudePath || 'claude')
    })

    // Load Claude settings for MCP
    window.electronAPI.settings.readClaude().then((s: any) => {
      const mcp: McpServer[] = []
      if (s?.mcpServers) {
        for (const [name, cfg] of Object.entries(s.mcpServers)) {
          mcp.push({ name, ...(cfg as any) })
        }
      }
      setMcpServers(mcp)
    })

    // Skills - list from CLI
    window.electronAPI.settings.readClaude().then(async () => {
      // Skills are in ~/.claude/skills/ directory
      // We detect them from the settings or through a separate IPC call
    })

    setPathValid(null)
    setPathResult('')
  }, [open])

  const handleValidatePath = async () => {
    const result = await window.electronAPI.settings.checkClaudePath(claudePath)
    setPathValid(result.valid)
    setPathResult(result.valid ? `✅ ${result.version}` : `❌ ${result.error}`)
  }

  const handleBrowsePath = async () => {
    const files = await window.electronAPI.dialog.openFile()
    if (files && files.length > 0) {
      setClaudePath(files[0])
      setPathValid(null)
      setPathResult('')
    }
  }

  const handleSavePath = async () => {
    const config = await window.electronAPI.settings.readCcNexus()
    config.claudePath = claudePath
    await window.electronAPI.settings.writeCcNexus(config)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[560px] max-h-[80vh] rounded-lg shadow-xl overflow-hidden flex flex-col"
           style={{ backgroundColor: 'var(--color-surface)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b"
             style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-medium text-sm">设置</span>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70"
                  style={{ color: 'var(--color-text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
          {[
            { key: 'path' as const, label: 'Claude 路径', icon: <Terminal size={12} /> },
            { key: 'mcp' as const, label: 'MCP 服务器', icon: <Server size={12} /> },
            { key: 'skills' as const, label: 'Skills', icon: <Puzzle size={12} /> },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors"
              style={{
                borderColor: tab === t.key ? 'var(--color-accent)' : 'transparent',
                color: tab === t.key ? 'var(--color-accent)' : 'var(--color-text-muted)'
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'path' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text)' }}>
                  Claude Code 可执行文件路径
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={claudePath}
                    onChange={(e) => { setClaudePath(e.target.value); setPathValid(null); setPathResult('') }}
                    className="flex-1 text-xs px-3 py-1.5 rounded outline-none font-mono"
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      border: '1px solid',
                      borderColor: pathValid === true ? '#98c379' : pathValid === false ? '#e06c75' : 'var(--color-border)'
                    }}
                    placeholder="claude"
                  />
                  <button onClick={handleBrowsePath}
                          className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
                          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
                    <FolderOpen size={12} /> 浏览
                  </button>
                  <button onClick={handleValidatePath}
                          className="text-xs px-3 py-1.5 rounded"
                          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
                    验证
                  </button>
                </div>
                {pathResult && (
                  <p className="text-xs mt-1" style={{ color: pathValid ? '#98c379' : '#e06c75' }}>
                    {pathResult}
                  </p>
                )}
                <p className="text-[10px] mt-2" style={{ color: 'var(--color-text-muted)' }}>
                  默认 "claude"（从 PATH 查找）。如果不在 PATH 中，请选择 claude 可执行文件。
                </p>
              </div>
              <button onClick={handleSavePath}
                      className="text-xs px-4 py-1.5 rounded"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                保存
              </button>
            </div>
          )}

          {tab === 'mcp' && (
            <div>
              {mcpServers.length === 0 ? (
                <div className="text-center py-8">
                  <Server size={32} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    未检测到 MCP 服务器
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    在 ~/.claude/settings.json 中配置 mcpServers
                  </p>
                  <button
                    onClick={async () => {
                      const s = await window.electronAPI.settings.readClaude()
                      setMcpServers(s?.mcpServers ? Object.entries(s.mcpServers).map(([name, cfg]) => ({ name, ...(cfg as any) })) : [])
                    }}
                    className="text-[10px] mt-2 px-2 py-1 rounded"
                    style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
                    刷新
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {mcpServers.map((server) => (
                    <div key={server.name}
                         className="p-3 rounded border"
                         style={{ backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Server size={14} style={{ color: 'var(--color-accent)' }} />
                        <span className="text-sm font-medium">{server.name}</span>
                      </div>
                      {server.command && (
                        <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--color-text-muted)' }}>
                          命令: {server.command} {server.args?.join(' ') || ''}
                        </div>
                      )}
                      {server.url && (
                        <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--color-text-muted)' }}>
                          URL: {server.url}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'skills' && (
            <div>
              <div className="text-center py-8">
                <Puzzle size={32} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Skills 由 Claude Code 自动管理
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  Skills 存放在 ~/.claude/skills/ 目录中
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  在 CLI 中通过 /skill-name 使用，ccNexus 中输入 /skill-name 即可调用
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
