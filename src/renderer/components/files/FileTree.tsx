import React from 'react'
import { File, Folder, FolderOpen } from 'lucide-react'

interface FileTreeProps {
  onSelectFile: (path: string) => void
}

// Mock file tree for now - will be replaced with real fs:tree IPC
const MOCK_TREE = [
  { name: 'src', type: 'directory' as const, children: [
    { name: 'main', type: 'directory' as const, children: [
      { name: 'index.ts', type: 'file' as const }
    ]},
    { name: 'preload', type: 'directory' as const, children: [
      { name: 'index.ts', type: 'file' as const }
    ]},
    { name: 'renderer', type: 'directory' as const, children: [
      { name: 'App.tsx', type: 'file' as const },
      { name: 'main.tsx', type: 'file' as const },
      { name: 'index.html', type: 'file' as const },
      { name: 'components', type: 'directory' as const },
      { name: 'styles', type: 'directory' as const },
    ]}
  ]},
  { name: 'package.json', type: 'file' as const },
  { name: 'tsconfig.json', type: 'file' as const },
  { name: '.gitignore', type: 'file' as const },
]

const FileTreeNode: React.FC<{
  node: any
  depth?: number
  onSelectFile: (path: string) => void
}> = ({ node, depth = 0, onSelectFile }) => {
  const [expanded, setExpanded] = React.useState(depth < 1)

  const handleClick = () => {
    if (node.type === 'directory') {
      setExpanded(!expanded)
    } else {
      onSelectFile(node.name)
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:opacity-80 text-sm"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {node.type === 'directory' ? (
          expanded
            ? <FolderOpen size={14} style={{ color: 'var(--color-accent)' }} />
            : <Folder size={14} style={{ color: 'var(--color-accent)' }} />
        ) : (
          <File size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.type === 'directory' && expanded && node.children && (
        <div>
          {node.children.map((child: any, i: number) => (
            <FileTreeNode
              key={i}
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
  return (
    <div className="flex-1 overflow-y-auto py-1">
      {MOCK_TREE.map((node, i) => (
        <FileTreeNode key={i} node={node} onSelectFile={onSelectFile} />
      ))}
    </div>
  )
}

export default FileTree
