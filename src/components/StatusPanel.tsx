import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  FileText,
  ListChecks,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  StatusData,
  StatusFileChange,
  StatusTaskItem,
  SubagentHistoryResponse,
  SubAgentInfo,
} from '../types';
import { computeDiff } from '../utils/diff';
import { buildSubagentProcessModel, formatSubagentDuration } from '../utils/subagentProcess';

type StatusTab = 'tasks' | 'subagents' | 'edits';

interface Props {
  status: StatusData;
  onUndoFile?: (filePath: string) => void;
  onOpenFile?: (filePath: string) => void;
  onDiscardAllFiles?: (filePaths: string[]) => void;
  onKeepAllFiles?: () => void;
  subagentHistories?: Record<string, SubagentHistoryResponse>;
  onSubagentHistory?: (key: string, history: SubagentHistoryResponse) => void;
  sessionId?: string | null;
  isStreaming?: boolean;
}

function normalizeTasks(status?: StatusData['tasks']): StatusTaskItem[] {
  if (!status?.items?.length) return [];
  const completedCount = status.done || 0;
  return status.items.map((item, index) => {
    if (typeof item !== 'string') return item;
    return {
      id: `task-${index}`,
      content: item,
      status: index < completedCount ? 'completed' : 'pending',
    };
  });
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function normalizeFileChange(change: string | StatusFileChange): StatusFileChange {
  if (typeof change !== 'string') return change;
  return {
    path: change,
    name: fileNameFromPath(change),
    status: 'M',
    additions: 0,
    deletions: 0,
  };
}

function taskStatusIcon(status: StatusTaskItem['status']) {
  if (status === 'completed') return <Check size={14} />;
  if (status === 'in_progress') return <Loader2 size={14} className="status-panel-spin" />;
  if (status === 'deleted') return <Trash2 size={13} />;
  return <Circle size={12} />;
}

function subagentStatusIcon(status: SubAgentInfo['status']) {
  if (status === 'running') return <Loader2 size={14} className="status-panel-spin" />;
  if (status === 'completed') return <Check size={14} />;
  if (status === 'error') return <AlertCircle size={14} />;
  return <Circle size={12} />;
}

function statusText(status: string | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  switch (status) {
    case 'in_progress': return t('status.inProgress', { defaultValue: '进行中' });
    case 'completed': return t('status.completed', { defaultValue: '已完成' });
    case 'error': return t('status.error', { defaultValue: '失败' });
    case 'deleted': return t('status.deleted', { defaultValue: '已删除' });
    default: return t('status.pending', { defaultValue: '待处理' });
  }
}

function StatusTaskList({ tasks }: { tasks: StatusTaskItem[] }) {
  const { t } = useTranslation();
  if (tasks.length === 0) {
    return <div className="status-panel-empty"><ListChecks size={18} /><span>{t('status.noTasks')}</span></div>;
  }

  return (
    <div className="status-panel-todo-list">
      {tasks.map((task, index) => {
        const taskStatus = task.status || 'pending';
        return (
          <div key={task.id || `task-${index}`} className={`status-panel-todo-item status-${taskStatus}`}>
            <span className="status-panel-todo-icon">{taskStatusIcon(taskStatus)}</span>
            <span className="status-panel-todo-content" title={task.content}>{task.content}</span>
            <span className="status-panel-todo-status">{statusText(taskStatus, t)}</span>
            {task.blockedBy?.length ? (
              <span className="status-panel-todo-blocked" title={task.blockedBy.join(', ')}>
                #{task.blockedBy.join(', #')}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SubagentProcessDetails({
  agent,
  history,
  canLoad,
}: {
  agent: SubAgentInfo;
  history?: SubagentHistoryResponse;
  canLoad: boolean;
}) {
  const { t } = useTranslation();
  const process = buildSubagentProcessModel(history);
  const stats = [
    formatSubagentDuration(agent.totalDurationMs),
    agent.totalToolUseCount != null ? `${agent.totalToolUseCount} ${t('status.subagentTools', { defaultValue: '工具' })}` : null,
    agent.totalTokens != null ? `${agent.totalTokens.toLocaleString()} ${t('status.subagentTokens', { defaultValue: 'tokens' })}` : null,
  ].filter(Boolean).join(' · ');
  const summary = agent.resultText?.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 180);
  const hasContent = process.notes.length > 0 || process.readFiles.length > 0 || process.toolCalls.length > 0 || Boolean(summary);

  return (
    <div className="status-subagent-process-card">
      <div className="status-subagent-process-header">
        <div>
          <div className="status-subagent-process-title">{t('status.subagentProcessTitle', { defaultValue: '子代理进程' })}</div>
          {agent.agentId ? <div className="status-subagent-process-subtitle">{agent.agentId}</div> : null}
        </div>
        {stats ? <div className="status-subagent-process-stats">{stats}</div> : null}
      </div>
      {history?.error ? <div className="status-subagent-error">{history.error}</div> : null}
      {hasContent ? (
        <div className="status-subagent-process-sections">
          {process.notes.length > 0 ? (
            <section className="status-subagent-process-section">
              <div className="status-subagent-section-heading">{t('status.subagentThought', { defaultValue: '思考' })}</div>
              <div className="status-subagent-note-card">{process.notes[0]}</div>
            </section>
          ) : null}
          {process.readFiles.length > 0 ? (
            <section className="status-subagent-process-section">
              <div className="status-subagent-section-heading">{t('status.subagentFilesRead', { defaultValue: '读取文件' })}</div>
              <div className="status-subagent-file-grid">
                {process.readFiles.map(file => <span key={file} className="status-subagent-file-chip" title={file}>{file}</span>)}
              </div>
            </section>
          ) : null}
          {process.toolCalls.length > 0 ? (
            <section className="status-subagent-process-section">
              <div className="status-subagent-section-heading">{t('status.subagentToolsUsed', { defaultValue: '工具调用' })}</div>
              <div className="status-subagent-tool-list">
                {process.toolCalls.map(tool => (
                  <span key={tool.id} className="status-subagent-tool-chip">
                    <strong>{tool.name}</strong>{tool.detail ? <small>{tool.detail}</small> : null}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          {summary ? (
            <section className="status-subagent-process-section">
              <div className="status-subagent-section-heading">{t('status.subagentResult', { defaultValue: '结果' })}</div>
              <div className="status-subagent-result-card">{summary}</div>
              {agent.resultText && agent.resultText !== summary ? (
                <details>
                  <summary>{t('status.subagentFullResult', { defaultValue: '查看完整结果' })}</summary>
                  <pre>{agent.resultText}</pre>
                </details>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="status-subagent-loading">{canLoad ? t('status.subagentLoading', { defaultValue: '正在读取子代理进程...' }) : t('status.subagentUnavailable', { defaultValue: '暂无子代理进程记录' })}</div>
      )}
    </div>
  );
}

function StatusSubagentList({
  subagents,
  histories = {},
  sessionId,
  isStreaming = false,
  onHistory,
}: {
  subagents: SubAgentInfo[];
  histories?: Record<string, SubagentHistoryResponse>;
  sessionId?: string | null;
  isStreaming?: boolean;
  onHistory?: (key: string, history: SubagentHistoryResponse) => void;
}) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const subagentsRef = useRef(subagents);
  const historiesRef = useRef(histories);
  useEffect(() => { subagentsRef.current = subagents; }, [subagents]);
  useEffect(() => { historiesRef.current = histories; }, [histories]);

  const requestHistory = useCallback(async (agent: SubAgentInfo) => {
    if (!sessionId || !window.ccNexusDesktop?.loadSubagentHistory || !onHistory) return;
    const key = agent.id || agent.agentId || agent.name;
    try {
      const response = await window.ccNexusDesktop.loadSubagentHistory({
        sessionId,
        agentId: agent.agentId,
        description: agent.description || agent.prompt || agent.name,
        toolUseId: agent.toolUseId || agent.id,
      });
      onHistory(key, response);
    } catch (error) {
      onHistory(key, {
        success: false,
        sessionId,
        toolUseId: agent.toolUseId || agent.id,
        agentId: agent.agentId,
        error: error instanceof Error ? error.message : 'Unable to load subagent history',
      });
    }
  }, [onHistory, sessionId]);

  useEffect(() => {
    if (!expandedId) return;
    const agent = subagentsRef.current.find(item => item.id === expandedId);
    if (!agent || !sessionId) return;
    const key = agent.id || agent.agentId || agent.name;
    if (!historiesRef.current[key]) void requestHistory(agent);
    if (!isStreaming || agent.status !== 'running') return;
    const timer = window.setInterval(() => {
      const current = subagentsRef.current.find(item => item.id === expandedId);
      if (current?.status === 'running') void requestHistory(current);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [expandedId, isStreaming, requestHistory, sessionId]);

  if (subagents.length === 0) {
    return <div className="status-panel-empty"><Bot size={18} /><span>{t('status.noSubagents')}</span></div>;
  }

  return (
    <div className="status-panel-subagent-list">
      {subagents.map((agent, index) => {
        const id = agent.id || `subagent-${index}`;
        const expanded = expandedId === id;
        const description = agent.description || agent.prompt || agent.name;
        const historyKey = agent.id || agent.agentId || agent.name;
        return (
          <div key={id} className={`status-subagent-wrapper status-${agent.status}`}>
            <button
              type="button"
              className="status-subagent-row"
              onClick={() => setExpandedId(current => current === id ? null : id)}
              aria-expanded={expanded}
            >
              <span className="status-subagent-icon">{subagentStatusIcon(agent.status)}</span>
              <span className="status-subagent-type">{agent.type || t('status.subagentType', { defaultValue: '子代理' })}</span>
              <span className="status-subagent-description" title={agent.prompt || description}>{description}</span>
              <span className="status-subagent-chevron">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
            </button>
            {expanded ? (
              <div className="status-subagent-details">
                <div className="status-subagent-detail-label">{statusText(agent.status, t)}</div>
                <SubagentProcessDetails
                  agent={agent}
                  history={histories[historyKey]}
                  canLoad={Boolean(sessionId && window.ccNexusDesktop?.loadSubagentHistory)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StatusFileChangesList({
  files,
  onUndoFile,
  onOpenFile,
  onDiscardAllFiles,
  onKeepAllFiles,
}: {
  files: StatusFileChange[];
  onUndoFile?: (filePath: string) => void;
  onOpenFile?: (filePath: string) => void;
  onDiscardAllFiles?: (filePaths: string[]) => void;
  onKeepAllFiles?: () => void;
}) {
  const { t } = useTranslation();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const paths = files.map(file => file.path);

  if (files.length === 0) {
    return <div className="status-panel-empty"><FileText size={18} /><span>{t('status.noChanges')}</span></div>;
  }

  return (
    <div className="status-file-changes-container">
      <div className="status-file-actions-bar">
        <button
          type="button"
          className="status-file-batch-btn danger"
          onClick={() => onDiscardAllFiles?.(paths)}
          disabled={!onDiscardAllFiles}
          title={t('status.discardAll', { defaultValue: '丢弃全部变更' })}
        >
          <Trash2 size={13} />
          <span>{t('status.discardAll', { defaultValue: '丢弃全部' })}</span>
        </button>
        <button
          type="button"
          className="status-file-batch-btn"
          onClick={() => onKeepAllFiles?.()}
          disabled={!onKeepAllFiles}
          title={t('status.keepAll', { defaultValue: '保留全部变更' })}
        >
          <CheckCheck size={13} />
          <span>{t('status.keepAll', { defaultValue: '保留全部' })}</span>
        </button>
      </div>

      <div className="status-file-changes-list">
        {files.map(file => {
          const expanded = expandedPath === file.path;
          const hasDiff = Boolean(file.operations?.length);
          const diffPreviews = expanded && hasDiff
            ? file.operations!.map(operation => computeDiff(operation.oldString, operation.newString))
            : [];
          const diffHtml = diffPreviews.filter(diff => !diff.truncated).map(diff => diff.html).join('\n');
          const diffTruncated = diffPreviews.some(diff => diff.truncated);
          const name = file.name || fileNameFromPath(file.path);
          return (
            <div key={file.path} className="status-file-change-wrapper">
              <div className="status-file-change-row">
                <span className={`status-file-change-kind ${file.status === 'A' ? 'added' : 'modified'}`}>{file.status || 'M'}</span>
                {name.match(/\.(js|jsx|ts|tsx|json|css|html|md|mjs|cjs)$/i) ? <FileCode2 size={15} /> : <FileText size={15} />}
                {onOpenFile ? (
                  <button type="button" className="status-file-change-name status-file-change-open" onClick={() => onOpenFile(file.path)} title={file.path}>{name}</button>
                ) : (
                  <span className="status-file-change-name" title={file.path}>{name}</span>
                )}
                {(file.additions > 0 || file.deletions > 0) ? (
                  <span className="status-file-change-stats">
                    {file.additions > 0 ? <span className="stat-add">+{file.additions}</span> : null}
                    {file.deletions > 0 ? <span className="stat-del">-{file.deletions}</span> : null}
                  </span>
                ) : null}
                <div className="status-file-change-actions">
                  {hasDiff ? (
                    <button
                      type="button"
                      className={`status-file-action-btn ${expanded ? 'active' : ''}`}
                      onClick={() => setExpandedPath(current => current === file.path ? null : file.path)}
                      title={t('status.showDiff', { defaultValue: '查看变更' })}
                      aria-label={t('status.showDiff', { defaultValue: '查看变更' })}
                    ><FileText size={13} /></button>
                  ) : null}
                  {onUndoFile ? (
                    <button
                      type="button"
                      className="status-file-action-btn undo"
                      onClick={() => onUndoFile(file.path)}
                      title={t('status.undoFile')}
                      aria-label={t('status.undoFile')}
                    ><RotateCcw size={13} /></button>
                  ) : null}
                </div>
              </div>
              {expanded && (diffHtml || diffTruncated) ? (
                <div className="status-file-diff">
                  {diffTruncated ? <div className="status-file-diff-summary">{t('status.diffTooLarge', { defaultValue: '变更过大，已隐藏预览；点击文件名打开编辑器查看。' })}</div> : null}
                  {diffHtml ? <div dangerouslySetInnerHTML={{ __html: diffHtml }} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StatusPanel({
  status,
  onUndoFile,
  onOpenFile,
  onDiscardAllFiles,
  onKeepAllFiles,
  subagentHistories = {},
  onSubagentHistory,
  sessionId,
  isStreaming = false,
}: Props) {
  const { t } = useTranslation();
  const [openTab, setOpenTab] = useState<StatusTab | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tasks = useMemo(() => normalizeTasks(status.tasks), [status.tasks]);
  const subagents = status.subagents || [];
  const files = useMemo(() => (status.edits?.files || []).map(normalizeFileChange), [status.edits?.files]);
  const completedTasks = status.tasks?.done ?? tasks.filter(task => task.status === 'completed').length;
  const totalTasks = Math.max(status.tasks?.total ?? 0, tasks.length);
  const completedSubagents = subagents.filter(agent => agent.status === 'completed').length;
  const runningSubagents = subagents.some(agent => agent.status === 'running');

  useEffect(() => {
    if (!openTab) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpenTab(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenTab(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openTab]);

  const toggleTab = (tab: StatusTab) => setOpenTab(current => current === tab ? null : tab);

  return (
    <div className="status-panel" ref={panelRef}>
      <div className="status-panel-tabs" role="tablist">
        <button type="button" role="tab" className={'status-panel-tab ' + (openTab === 'tasks' ? 'active' : '')} onClick={() => toggleTab('tasks')} aria-expanded={openTab === 'tasks'} aria-selected={openTab === 'tasks'}>
          <ListChecks size={15} /><span className="tab-label">{t('status.tasks')}</span><span className="tab-progress">{completedTasks}/{totalTasks}</span>
        </button>
        <button type="button" role="tab" className={'status-panel-tab ' + (openTab === 'subagents' ? 'active' : '')} onClick={() => toggleTab('subagents')} aria-expanded={openTab === 'subagents'} aria-selected={openTab === 'subagents'}>
          <Bot size={15} /><span className="tab-label">{t('status.subagents')}</span><span className="tab-progress">{completedSubagents}/{subagents.length}</span>{runningSubagents ? <Loader2 size={12} className="status-panel-spin" /> : null}
        </button>
        <button type="button" role="tab" className={'status-panel-tab ' + (openTab === 'edits' ? 'active' : '')} onClick={() => toggleTab('edits')} aria-expanded={openTab === 'edits'} aria-selected={openTab === 'edits'}>
          <Pencil size={15} /><span className="tab-label">{t('status.edits')}</span><span className="tab-stats"><span className="stat-add">+{status.edits?.additions || 0}</span><span className="stat-del">-{status.edits?.deletions || 0}</span></span>
        </button>
      </div>

      {openTab ? (
        <div className="status-panel-popover" role="dialog" aria-label={openTab}>
          {openTab === 'tasks' ? <StatusTaskList tasks={tasks} /> : null}
          {openTab === 'subagents' ? <StatusSubagentList subagents={subagents} histories={subagentHistories} sessionId={sessionId} isStreaming={isStreaming} onHistory={onSubagentHistory} /> : null}
          {openTab === 'edits' ? <StatusFileChangesList files={files} onUndoFile={onUndoFile} onOpenFile={onOpenFile} onDiscardAllFiles={onDiscardAllFiles} onKeepAllFiles={onKeepAllFiles} /> : null}
        </div>
      ) : null}
    </div>
  );
}
