import React, { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface ModelSelectorProps {
  value: string | null
  onChange: (model: string | null) => void
}

interface ModelOption {
  key: string       // e.g. "opus"
  label: string     // e.g. "Opus"
  model: string     // e.g. "deepseek-v4-pro[1M]"
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ value, onChange }) => {
  const [models, setModels] = useState<ModelOption[]>([])
  const [selected, setSelected] = useState<ModelOption | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const load = async () => {
      const s = await window.electronAPI.settings.readClaude()
      const env = s?.env || {}

      const list: ModelOption[] = []
      if (env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME)
        list.push({ key: 'opus', label: 'Opus', model: env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME || env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'opus' })
      if (env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME)
        list.push({ key: 'sonnet', label: 'Sonnet', model: env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME || env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'sonnet' })
      if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME)
        list.push({ key: 'haiku', label: 'Haiku', model: env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME || env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'haiku' })
      if (env.ANTHROPIC_DEFAULT_FABLE_MODEL || env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME)
        list.push({ key: 'fable', label: 'Fable', model: env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME || env.ANTHROPIC_DEFAULT_FABLE_MODEL || 'fable' })

      setModels(list)

      // Pick current model
      const currentKey = value || s?.model || 'opus'
      const current = list.find(m => m.key === currentKey) || list[0] || null
      setSelected(current)
    }
    load()
  }, [value])

  const handleSelect = async (m: ModelOption) => {
    setSelected(m)
    onChange(m.key)
    setOpen(false)
    try {
      const s = await window.electronAPI.settings.readClaude()
      s.model = m.key
      await window.electronAPI.settings.writeClaude(s)
    } catch { /* ignore */ }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:opacity-70"
        style={{ color: 'var(--color-text)' }}
      >
        <span className="text-[10px] mr-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {selected?.label || '模型'}
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--color-accent)' }}>
          {selected?.model || '...'}
        </span>
        <ChevronDown size={10} className={open ? 'rotate-180' : ''} style={{ color: 'var(--color-text-muted)' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 z-20 rounded-md shadow-lg border overflow-hidden min-w-[200px]"
               style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            {models.map((m) => (
              <button
                key={m.key}
                onClick={() => handleSelect(m)}
                className="block w-full text-left px-3 py-1.5 hover:opacity-70"
                style={{
                  backgroundColor: m.key === selected?.key ? 'var(--color-bg)' : 'transparent',
                }}
              >
                <div className="text-xs" style={{ color: 'var(--color-text)' }}>{m.label}</div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--color-accent)' }}>
                  {m.model}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default ModelSelector
