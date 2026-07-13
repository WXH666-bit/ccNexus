import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface PermissionSelectorProps {
  value: string | null
  onChange: (mode: string | null) => void
}

const MODES = [
  { label: '手动确认', value: 'manual', desc: '每次操作需确认' },
  { label: '接受编辑', value: 'acceptEdits', desc: '自动允许编辑操作' },
  { label: '全部放行', value: 'bypassPermissions', desc: '跳过所有权限检查' },
]

const PermissionSelector: React.FC<PermissionSelectorProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false)
  const current = MODES.find((m) => m.value === value) || MODES[0]

  const handleSelect = (mode: string) => {
    onChange(mode)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:opacity-70"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {current.label}
        <ChevronDown size={10} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 z-20 rounded-md shadow-lg border overflow-hidden"
               style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => handleSelect(m.value)}
                className="block w-full text-left px-3 py-1.5 hover:opacity-70"
                style={{
                  backgroundColor: m.value === current.value ? 'var(--color-bg)' : 'transparent',
                }}
              >
                <div className="text-xs" style={{ color: 'var(--color-text)' }}>{m.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default PermissionSelector
