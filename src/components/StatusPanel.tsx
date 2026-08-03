import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { StatusData, StatusFileChange, StatusTaskItem, SubAgentInfo } from '../types';
import { computeDiff } from '../utils/diff';

type StatusTab = 'tasks' | 'subagents' | 'edits';

interface Props {
  status: StatusData;
  onUndoFile?: (filePath: string) => void;
  onDiscardAllFiles?: (filePaths: string[]) => void;
  onKeepAllFiles?: (filePaths: string[]) => void;
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

function StatusSubagentList({ subagents }: { subagents: SubAgentInfo[] }) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (subagents.length === 0) {
    return <div className="status-panel-empty"><Bot size={18} /><span>{t('status.noSubagents')}</span></div>;
  }

  return (
    <div className="status-panel-subagent-list">
      {subagents.map((agent, index) => {
        const id = agent.id || `subagent-${index}`;
        const expanded = expandedId === id;
        const description = agent.description || agent.prompt || agent.name;
        const stats = [
          agent.totalDurationMs != null ? `${Math.round(agent.totalDurationMs / 1000)}s` : '',
          agent.totalTokens != null ? `${agent.totalTokens.toLocaleString()} tokens` : '',
          agent.totalToolUseCount != null ? `${agent.totalToolUseCount} tools` : '',
        ].filter(Boolean).join(' · ');

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
              <span className="status-subagent-description" title={description}>{description}</span>
              <span className="status-subagent-chevron">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
            </button>
            {expanded && (
              <div className="status-subagent-details">
                <div className="status-subagent-detail-label">{statusText(agent.status, t)}{stats ? ` · ${stats}` : ''}</div>
                {agent.resultText ? <div className="status-subagent-result">{agent.resultText}</div> : null}
                {!agent.resultText && agent.status === 'running' ? (
                  <div className="status-subagent-result muted">{t('status.subagentRunning', { defaultValue: '正在执行，详情会随进度更新' })}</div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusFileChangesList({
  files,
  onUndoFile,
  onDiscardAllFiles,
  onKeepAllFiles,
}: {
  files: StatusFileChange[];
  onUndoFile?: (filePath: string) => void;
  onDiscardAllFiles?: (filePaths: string[]) => void;
  onKeepAllFiles?: (filePaths: string[]) => void;
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
          onClick={() => onKeepAllFiles?.(paths)}
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
          const diffHtml = hasDiff
            ? file.operations!.map(operation => computeDiff(operation.oldString, operation.newString).html).join('\n')
            : '';
          return (
            <div key={file.path} className="status-file-change-wrapper">
              <div className="status-file-change-row">
                <span className={`status-file-change-kind ${file.status === 'A' ? 'added' : 'modified'}`}>
                  {file.status || 'M'}
                </span>
                {file.name.match(/\.(js|jsx|ts|tsx|json|css|html|md|mjs|cjs)$/i) ? <FileCode2 size={15} /> : <FileText size={15} />}
                <span className="status-file-change-name" title={file.path}>{file.name}</span>
                {(file.additions > 0 || file.deletions > 0) && (
                  <span className="status-file-change-stats">
                    {file.additions > 0 ? <span className="stat-add">+{file.additions}</span> : null}
                    {file.deletions > 0 ? <span className="stat-del">-{file.deletions}</span> : null}
                  </span>
                )}
                <div className="status-file-change-actions">
                  {hasDiff ? (
                    <button
                      type="button"
                      className={`status-file-action-btn ${expanded ? 'active' : ''}`}
                      onClick={() => setExpandedPath(current => current === file.path ? null : file.path)}
                      title={t('status.showDiff', { defaultValue: '查看变更' })}
                      aria-label={t('status.showDiff', { defaultValue: '查看变更' })}
                    >
                      <FileText size={13} />
                    </button>
                  ) : null}
                  {onUndoFile ? (
                    <button
                      type="button"
                      className="status-file-action-btn undo"
                      onClick={() => onUndoFile(file.path)}
                      title={t('status.undoFile')}
                      aria-label={t('status.undoFile')}
                    >
                      <RotateCcw size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
              {expanded && diffHtml ? (
                <div className="status-file-diff" dangerouslySetInnerHTML={{ __html: diffHtml }} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StatusPanel({ status, onUndoFile, onDiscardAllFiles, onKeepAllFiles }: Props) {
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
        <button
          type="button"
          role="tab"
          className={'status-panel-tab ' + (openTab === 'tasks' ? 'active' : '')}
          onClick={() => toggleTab('tasks')}
          aria-expanded={openTab === 'tasks'}
          aria-selected={openTab === 'tasks'}
        >
          <ListChecks size={15} />
          <span className="tab-label">{t('status.tasks')}</span>
          <span className="tab-progress">{completedTasks}/{totalTasks}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={'status-panel-tab ' + (openTab === 'subagents' ? 'active' : '')}
          onClick={() => toggleTab('subagents')}
          aria-expanded={openTab === 'subagents'}
          aria-selected={openTab === 'subagents'}
        >
          <Bot size={15} />
          <span className="tab-label">{t('status.subagents')}</span>
          <span className="tab-progress">{completedSubagents}/{subagents.length}</span>
          {runningSubagents ? <Loader2 size={12} className="status-panel-spin" /> : null}
        </button>
        <button
          type="button"
          role="tab"
          className={'status-panel-tab ' + (openTab === 'edits' ? 'active' : '')}
          onClick={() => toggleTab('edits')}
          aria-expanded={openTab === 'edits'}
          aria-selected={openTab === 'edits'}
        >
          <Pencil size={15} />
          <span className="tab-label">{t('status.edits')}</span>
          <span className="tab-stats">
            <span className="stat-add">+{status.edits?.additions || 0}</span>
            <span className="stat-del">-{status.edits?.deletions || 0}</span>
          </span>
        </button>
      </div>

      {openTab ? (
        <div className="status-panel-popover" role="dialog" aria-label={openTab}>
          {openTab === 'tasks' ? <StatusTaskList tasks={tasks} /> : null}
          {openTab === 'subagents' ? <StatusSubagentList subagents={subagents} /> : null}
          {openTab === 'edits' ? (
            <StatusFileChangesList
              files={files}
              onUndoFile={onUndoFile}
              onDiscardAllFiles={onDiscardAllFiles}
              onKeepAllFiles={onKeepAllFiles}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
