import { readdirSync, statSync, readFileSync } from 'fs'
import { join, relative, extname, basename } from 'path'

export interface FileNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.claude', 'dist', 'out',
  '__pycache__', '.next', '.nuxt', 'build', '.cache'
])

const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini'
])

function buildTree(dirPath: string, rootPath: string, depth = 0): FileNode[] {
  if (depth > 5) return [] // Limit recursion depth

  const entries: FileNode[] = []

  try {
    const items = readdirSync(dirPath)

    for (const name of items.sort((a, b) => {
      // Directories first, then alphabetical
      const aIsDir = statSync(join(dirPath, a)).isDirectory()
      const bIsDir = statSync(join(dirPath, b)).isDirectory()
      if (aIsDir && !bIsDir) return -1
      if (!aIsDir && bIsDir) return 1
      return a.localeCompare(b)
    })) {
      if (name.startsWith('.') && name !== '.gitignore' && name !== '.env') continue
      if (IGNORED_DIRS.has(name)) continue
      if (IGNORED_FILES.has(name)) continue

      const fullPath = join(dirPath, name)
      const relPath = relative(rootPath, fullPath)
      let stat

      try {
        stat = statSync(fullPath)
      } catch {
        continue // Skip inaccessible files
      }

      if (stat.isDirectory()) {
        const children = buildTree(fullPath, rootPath, depth + 1)
        entries.push({
          name,
          path: fullPath,
          relativePath: relPath,
          type: 'directory',
          children
        })
      } else {
        const ext = extname(name).toLowerCase()
        entries.push({
          name,
          path: fullPath,
          relativePath: relPath,
          type: 'file',
          extension: ext || undefined
        })
      }
    }
  } catch {
    // Directory inaccessible, return empty
  }

  return entries
}

export function getFileTree(rootPath: string): FileNode[] {
  return buildTree(rootPath, rootPath)
}

export function readFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    throw new Error(`Cannot read file: ${filePath}`)
  }
}

export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
