import React, { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface ModelSelectorProps {
  value: string | null
  onChange: (model: string | null) => void
}

const MODELS = [
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' },
  { label: 'Fable', value: 'fable' },
]

const ModelSelector: React.FC<ModelSelectorProps> = ({ value, onChange }) => {
  const [settings, setSettings] = useState<any>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    window.electronAPI.settings.readClaude().then(setSettings)
  }, [])

  const currentModel = settings?.model || value || 'opus'
  const currentLabel = MODELS.find((m) => m.value === currentModel)?.label || currentModel

  const handleSelect = async (model: string) => {
    onChange(model)
    setOpen(false)
    // Persist to Claude settings
    try {
      const s = await window.electronAPI.settings.readClaude()
      s.model = model
      await window.electronAPI.settings.writeClaude(s)
    } catch { /* ignore */ }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:opacity-70"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {currentLabel}
        <ChevronDown size={10} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 z-20 rounded-md shadow-lg border overflow-hidden"
               style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            {MODELS.map((m) => (
              <button
                key={m.value}
                onClick={() => handleSelect(m.value)}
                className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-70 whitespace-nowrap"
                style={{
                  backgroundColor: m.value === currentModel ? 'var(--color-bg)' : 'transparent',
                  color: 'var(--color-text)'
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default ModelSelector
