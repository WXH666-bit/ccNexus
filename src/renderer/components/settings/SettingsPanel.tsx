import React, { useEffect, useState } from 'react'
import { X, Check, AlertCircle, FolderOpen } from 'lucide-react'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const [claudePath, setClaudePath] = useState('claude')
  const [pathValid, setPathValid] = useState<boolean | null>(null)
  const [pathResult, setPathResult] = useState('')
  const [rawSettings, setRawSettings] = useState('')
  const [tab, setTab] = useState<'path' | 'env' | 'json'>('path')

  useEffect(() => {
    if (!open) return
    // Load ccNexus config
    window.electronAPI.settings.readCcNexus().then((c: any) => {
      setClaudePath(c.claudePath || 'claude')
    })
    // Load Claude settings
    window.electronAPI.settings.readClaude().then((s: any) => {
      setRawSettings(JSON.stringify(s, null, 2))
    })
  }, [open])

  const handlePathChange = async (path: string) => {
    setClaudePath(path)
    setPathValid(null)
    setPathResult('')
  }

  const handleValidatePath = async () => {
    const result = await window.electronAPI.settings.checkClaudePath(claudePath)
    setPathValid(result.valid)
    setPathResult(result.valid ? `✅ ${result.version}` : `❌ ${result.error}`)
  }

  const handleSavePath = async () => {
    const config = await window.electronAPI.settings.readCcNexus()
    config.claudePath = claudePath
    await window.electronAPI.settings.writeCcNexus(config)
    onClose()
  }

  const handleSaveSettings = async () => {
    try {
      const parsed = JSON.parse(rawSettings)
      await window.electronAPI.settings.writeClaude(parsed)
      onClose()
    } catch {
      alert('JSON 格式错误')
    }
  }

  const handleBrowsePath = async () => {
    // Use the file dialog to select claude binary
    // For now, user manually enters path
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[500px] max-h-[80vh] rounded-lg shadow-xl overflow-hidden flex flex-col"
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
            { key: 'path' as const, label: 'Claude 路径' },
            { key: 'env' as const, label: '环境变量' },
            { key: 'json' as const, label: '高级' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-4 py-2 text-xs border-b-2 transition-colors"
              style={{
                borderColor: tab === t.key ? 'var(--color-accent)' : 'transparent',
                color: tab === t.key ? 'var(--color-accent)' : 'var(--color-text-muted)'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'path' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                  Claude Code 可执行文件路径
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={claudePath}
                    onChange={(e) => handlePathChange(e.target.value)}
                    className="flex-1 text-xs px-3 py-1.5 rounded outline-none"
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      border: '1px solid',
                      borderColor: 'var(--color-border)'
                    }}
                    placeholder="claude"
                  />
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
                  默认为 "claude"（从系统 PATH 查找）。如果 Claude Code 不在 PATH 中，请填写完整路径。
                </p>
              </div>
              <button onClick={handleSavePath}
                      className="text-xs px-4 py-1.5 rounded"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                保存
              </button>
            </div>
          )}

          {tab === 'env' && (
            <div>
              <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
                以下是从 Claude Code settings.json 读取的配置。
                在高级选项卡中可以编辑完整 JSON。
              </p>
              {(() => {
                try {
                  const s = JSON.parse(rawSettings || '{}')
                  const env = s.env || {}
                  return Object.keys(env).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(env).map(([key, value]: [string, any]) => (
                        <div key={key} className="flex gap-2 items-start">
                          <div className="text-[10px] font-mono w-[180px] truncate pt-0.5"
                               style={{ color: 'var(--color-text)' }}>{key}</div>
                          <div className="text-[10px] font-mono flex-1 break-all px-2 py-0.5 rounded"
                               style={{
                                 backgroundColor: 'var(--color-bg)',
                                 color: key.toLowerCase().includes('key') || key.toLowerCase().includes('token')
                                   ? 'var(--color-text-muted)' : 'var(--color-text)'
                               }}>
                            {key.toLowerCase().includes('key') || key.toLowerCase().includes('token')
                              ? '••••••••'
                              : String(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>无环境变量</p>
                  )
                } catch { return <p className="text-xs" style={{ color: '#e06c75' }}>解析失败</p> }
              })()}
            </div>
          )}

          {tab === 'json' && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                直接编辑 ~/.claude/settings.json
              </p>
              <textarea
                value={rawSettings}
                onChange={(e) => setRawSettings(e.target.value)}
                rows={20}
                className="w-full resize-none rounded p-3 text-xs font-mono outline-none"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid',
                  borderColor: 'var(--color-border)'
                }}
              />
              <button onClick={handleSaveSettings}
                      className="text-xs px-4 py-1.5 rounded"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
                保存
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
