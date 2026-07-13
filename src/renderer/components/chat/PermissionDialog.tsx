import React from 'react'
import { Shield, X } from 'lucide-react'

interface PermissionDialogProps {
  visible: boolean
  message: string
  onAllow: () => void
  onDeny: () => void
}

const PermissionDialog: React.FC<PermissionDialogProps> = ({
  visible,
  message,
  onAllow,
  onDeny
}) => {
  if (!visible) return null

  return (
    <div className="p-3 mx-4 mb-2 rounded-lg border"
         style={{
           backgroundColor: 'var(--color-surface)',
           borderColor: '#e5c07b',
         }}>
      <div className="flex items-start gap-2">
        <Shield size={16} style={{ color: '#e5c07b', marginTop: 2 }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium mb-2" style={{ color: '#e5c07b' }}>
            Claude wants permission
          </p>
          <p className="text-xs mb-3 whitespace-pre-wrap break-words">
            {message}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onAllow}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ backgroundColor: '#98c379', color: '#1a1b1e' }}
            >
              Allow
            </button>
            <button
              onClick={onDeny}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ backgroundColor: '#e06c75', color: '#fff' }}
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PermissionDialog
