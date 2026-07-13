import React, { useEffect, useState } from 'react'
import { GitBranch, Plus, Minus, RotateCcw, ArrowUp, ArrowDown, RefreshCw, Check } from 'lucide-react'
import GitStatusList from './GitStatusList'
import GitCommitForm from './GitCommitForm'
import GitBranchBar from './GitBranchBar'

export interface GitStatus {
  staged: { path: string; status: string }[]
  modified: { path: string; status: string }[]
  untracked: string[]
  currentBranch: string
  ahead: number
  behind: number
  error?: string
}

const GitPanel: React.FC = () => {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [activeTab, setActiveTab] = useState<'status' | 'branches'>('status')

  const loadStatus = async () => {
    try {
      setLoading(true)
      const data = await window.electronAPI.git.status()
      setStatus(data)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  const handleStage = async (files: string[]) => {
    await window.electronAPI.git.stage(files)
    loadStatus()
  }
  const handleUnstage = async (files: string[]) => {
    await window.electronAPI.git.unstage(files)
    loadStatus()
  }
  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    await window.electronAPI.git.commit(commitMsg.trim())
    setCommitMsg('')
    loadStatus()
  }
  const handlePush = async () => {
    try { await window.electronAPI.git.push(); loadStatus() }
    catch (e: any) { setError(e.message) }
  }
  const handlePull = async () => {
    try { await window.electronAPI.git.pull(); loadStatus() }
    catch (e: any) { setError(e.message) }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
        加载 Git 状态...
      </div>
    )
  }

  if (!status) {
    return (
      <div className="h-full flex items-center justify-center text-xs" style={{ color: '#e06c75' }}>
        {error || '无法加载 Git 状态'}
      </div>
    )
  }

  const stagedCount = status.staged.length
  const modifiedCount = status.modified.length
  const untrackedCount = status.untracked.length
  const totalChanges = stagedCount + modifiedCount + untrackedCount

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-shrink-0"
           style={{ borderColor: 'var(--color-border)' }}>
        <GitBranch size={14} style={{ color: 'var(--color-accent)' }} />
        <span className="text-xs font-medium">{status.currentBranch}</span>
        {status.ahead > 0 && (
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: '#61afef' }}>
            <ArrowUp size={10} />{status.ahead}
          </span>
        )}
        {status.behind > 0 && (
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: '#e5c07b' }}>
            <ArrowDown size={10} />{status.behind}
          </span>
        )}
        <span className="text-[10px] px-1 rounded" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
          {totalChanges} 个变更
        </span>
        <div className="flex-1" />
        <button onClick={() => setActiveTab('status')}
                className={`text-[10px] px-2 py-0.5 rounded ${activeTab === 'status' ? '' : 'opacity-50'}`}
                style={activeTab === 'status' ? { backgroundColor: 'var(--color-bg)' } : {}}>
          状态
        </button>
        <button onClick={() => setActiveTab('branches')}
                className={`text-[10px] px-2 py-0.5 rounded ${activeTab === 'branches' ? '' : 'opacity-50'}`}
                style={activeTab === 'branches' ? { backgroundColor: 'var(--color-bg)' } : {}}>
          分支
        </button>
        <button onClick={loadStatus} className="p-1 rounded hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {activeTab === 'status' ? (
        <>
          <div className="flex-1 overflow-y-auto">
            {totalChanges === 0 ? (
              <div className="p-4 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <Check size={20} className="mx-auto mb-1" style={{ color: '#98c379' }} />
                工作区干净
              </div>
            ) : (
              <GitStatusList status={status} onStage={handleStage} onUnstage={handleUnstage} />
            )}
          </div>
          {stagedCount > 0 && (
            <GitCommitForm value={commitMsg} onChange={setCommitMsg} onCommit={handleCommit} />
          )}
          <div className="flex gap-2 p-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button onClick={handlePush}
                    className="flex-1 text-xs py-1.5 rounded flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
              <ArrowUp size={12} /> 推送
            </button>
            <button onClick={handlePull}
                    className="flex-1 text-xs py-1.5 rounded flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
              <ArrowDown size={12} /> 拉取
            </button>
          </div>
        </>
      ) : (
        <GitBranchBar currentBranch={status.currentBranch} />
      )}
    </div>
  )
}

export default GitPanel
