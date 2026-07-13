import React from 'react'
import { X } from 'lucide-react'

interface FilePreviewProps {
  filePath: string
  onClose: () => void
}

const FilePreview: React.FC<FilePreviewProps> = ({ filePath, onClose }) => {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b"
           style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={onClose}
          className="p-1 rounded hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <X size={14} />
        </button>
        <span className="text-sm">{filePath}</span>
      </div>
      <div className="flex-1 flex items-center justify-center"
           style={{ color: 'var(--color-text-muted)' }}>
        <div className="text-center">
          <p className="text-lg mb-2">📄</p>
          <p>Monaco Editor will load here</p>
          <p className="text-xs mt-1">File: {filePath}</p>
        </div>
      </div>
    </div>
  )
}

export default FilePreview
