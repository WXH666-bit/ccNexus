import React, { useEffect, useState } from 'react'
import { GitBranch, Check } from 'lucide-react'

interface BranchInfo {
  current: string
  branches: string[]
}

interface Props {
  currentBranch: string
}

const GitBranchBar: React.FC<Props> = ({ currentBranch }) => {
  const [branches, setBranches] = useState<BranchInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await window.electronAPI.git.branches()
        setBranches(data)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleCheckout = async (branch: string) => {
    if (branch === currentBranch) return
    if (confirm(`Switch to branch "${branch}"?`)) {
      try {
        await window.electronAPI.git.checkout(branch)
        // Reload after switching
        const data = await window.electronAPI.git.branches()
        setBranches(data)
      } catch (e: any) {
        alert(`Failed to switch branch: ${e.message}`)
      }
    }
  }

  if (loading) {
    return <div className="p-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>Loading branches...</div>
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {branches?.branches.map((branch) => (
        <div
          key={branch}
          className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:opacity-70 text-xs"
          onClick={() => handleCheckout(branch)}
          style={{
            backgroundColor: branch === currentBranch ? 'var(--color-bg)' : 'transparent'
          }}
        >
          <GitBranch size={12}
            style={{ color: branch === currentBranch ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
          />
          <span className="flex-1 truncate"
                style={{ color: branch === currentBranch ? 'var(--color-accent)' : 'var(--color-text)' }}>
            {branch}
          </span>
          {branch === currentBranch && (
            <Check size={12} style={{ color: 'var(--color-accent)' }} />
          )}
        </div>
      ))}
    </div>
  )
}

export default GitBranchBar
