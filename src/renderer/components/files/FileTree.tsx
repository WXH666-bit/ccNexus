import React, { useEffect, useState } from 'react'
import { File, Folder, FolderOpen, FolderTree } from 'lucide-react'

interface FileNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

interface FileTreeProps {
  onSelectFile: (path: string) => void
}

const FILE_ICONS: Record<string, string> = {
  '.ts': '🔷', '.tsx': '⚛️', '.js': '🟨', '.jsx': '⚛️',
  '.json': '📋', '.md': '📝', '.css': '🎨', '.html': '🌐',
  '.gitignore': '⚙️', '.env': '🔒',
}

const FileIcon: React.FC<{ name: string; type: 'file' | 'directory'; expanded?: boolean }> = ({ name, type, expanded }) => {
  if (type === 'directory') {
    return expanded
      ? <FolderOpen size={14} style={{ color: 'var(--color-accent)' }} />
      : <Folder size={14} style={{ color: 'var(--color-accent)' }} />
  }

  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  const emoji = FILE_ICONS[ext]
  if (emoji) {
    return <span className="text-xs">{emoji}</span>
  }
  return <File size={14} style={{ color: 'var(--color-text-muted)' }} />
}

const FileTreeNode: React.FC<{
  node: FileNode
  depth?: number
  onSelectFile: (path: string) => void
}> = ({ node, depth = 0, onSelectFile }) => {
  const [expanded, setExpanded] = React.useState(depth < 1)

  const handleClick = () => {
    if (node.type === 'directory') {
      setExpanded(!expanded)
    } else {
      onSelectFile(node.path)
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:opacity-80 text-sm"
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={handleClick}
      >
        <FileIcon name={node.name} type={node.type} expanded={expanded} />
        <span className="truncate text-xs">{node.name}</span>
      </div>
      {node.type === 'directory' && expanded && node.children && (
        <div>
          {node.children.map((child, i) => (
            <FileTreeNode
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const FileTree: React.FC<FileTreeProps> = ({ onSelectFile }) => {
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const data = await window.electronAPI.fs.getTree()
        setTree(data)
        setError(null)
      } catch (e: any) {
        setError(e.message || 'Failed to load file tree')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
        <span className="text-xs">Loading files...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4" style={{ color: '#e06c75' }}>
        <span className="text-xs">{error}</span>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {tree.length === 0 ? (
        <div className="p-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No files found
        </div>
      ) : (
        tree.map((node) => (
          <FileTreeNode key={node.relativePath} node={node} onSelectFile={onSelectFile} />
        ))
      )}
    </div>
  )
}

export default FileTree
