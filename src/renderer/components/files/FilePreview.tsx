import React, { useEffect, useState } from 'react'
import { X, Copy, Check } from 'lucide-react'

interface FilePreviewProps {
  filePath: string
  onClose: () => void
}

const FilePreview: React.FC<FilePreviewProps> = ({ filePath, onClose }) => {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fileName = filePath.split(/[/\\]/).pop() || filePath

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await window.electronAPI.fs.readFile(filePath)
        setContent(data)
      } catch (e: any) {
        setError(e.message || 'Failed to read file')
        setContent(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [filePath])

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const getLanguage = (name: string): string => {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript',
      '.json': 'json', '.css': 'css', '.html': 'html',
      '.md': 'markdown', '.py': 'python', '.rs': 'rust',
      '.go': 'go', '.java': 'java', '.yml': 'yaml', '.yaml': 'yaml',
    }
    return map[ext] || 'plaintext'
  }

  const isImage = /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(fileName)
  const isLargeFile = content && content.length > 500 * 1024 // 500KB

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 p-2 border-b flex-shrink-0"
           style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <button
          onClick={onClose}
          className="p-1 rounded hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <X size={14} />
        </button>
        <span className="text-xs font-medium truncate">{fileName}</span>
        <span className="text-[10px] opacity-50">{getLanguage(fileName)}</span>

        <div className="flex-1" />

        <button
          onClick={handleCopy}
          className="p-1 rounded hover:opacity-70 flex items-center gap-1"
          style={{ color: copied ? '#98c379' : 'var(--color-text-muted)' }}
          title="Copy content"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Loading...
          </div>
        ) : error ? (
          <div className="p-4 text-xs" style={{ color: '#e06c75' }}>
            {error}
          </div>
        ) : isImage ? (
          <div className="p-4 flex items-center justify-center">
            <img
              src={`file://${filePath}`}
              alt={fileName}
              className="max-w-full max-h-full object-contain"
              onError={() => setError('无法预览该图片')}
            />
          </div>
        ) : isLargeFile ? (
          <div className="p-4">
            <p className="text-xs mb-2" style={{ color: '#e5c07b' }}>
              大文件 ({Math.round(content!.length / 1024)}KB) — 仅显示前段:
            </p>
            <pre className="text-xs font-mono p-3 rounded" style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              maxHeight: 'calc(100vh - 200px)',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {content!.slice(0, 100 * 1024)}
            </pre>
            <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
              File truncated. Full size: {(content!.length / 1024).toFixed(1)}KB
            </p>
          </div>
        ) : (
          <pre className="text-xs font-mono p-4" style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            minHeight: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            tabSize: 2
          }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}

export default FilePreview
