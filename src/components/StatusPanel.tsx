import { useState } from 'react';
import { ListChecks, Bot, Pencil, X, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusData } from '../types';

interface Props {
  status: StatusData;
  onUndoFile?: (filePath: string) => void;
}

export default function StatusPanel({ status, onUndoFile }: Props) {
  const { t } = useTranslation();
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  return (
    <div className="status-panel">
      <div className="status-item" onClick={() => setOpenPanel(openPanel === 'tasks' ? null : 'tasks')}>
        <ListChecks size={14} />
        <span className="status-item-label">{t('status.tasks')}</span>
        <span className="status-item-count">
          {status.tasks ? `${status.tasks.done}/${status.tasks.total}` : '0/0'}
        </span>
      </div>
      <div className="status-item" onClick={() => setOpenPanel(openPanel === 'subagents' ? null : 'subagents')}>
        <Bot size={14} />
        <span className="status-item-label">{t('status.subagents')}</span>
        <span className="status-item-count">{status.subagents ? status.subagents.length : 0}</span>
      </div>
      <div className="status-item" onClick={() => setOpenPanel(openPanel === 'edits' ? null : 'edits')}>
        <Pencil size={14} />
        <span className="status-item-label">{t('status.edits')}</span>
        <span className="status-item-count">
          <span className="stat-add">+{status.edits?.additions || 0}</span>{' '}
          <span className="stat-del">-{status.edits?.deletions || 0}</span>
        </span>
      </div>

      {openPanel && (
        <div className="status-popup">
          <div className="status-popup-header">
            <span>{openPanel === 'tasks' ? t('status.tasksList') : openPanel === 'subagents' ? t('status.subagentsList') : t('status.fileChanges')}</span>
            <button onClick={() => setOpenPanel(null)}><X size={14} /></button>
          </div>
          <div className="status-popup-body">
            {openPanel === 'tasks' && (
              status.tasks?.items?.length ? (
                status.tasks.items.map((item, i) => (
                  <div key={i} className="popup-item">{item}</div>
                ))
              ) : (
                <div className="empty-state">{t('status.noTasks')}</div>
              )
            )}
            {openPanel === 'subagents' && (
              status.subagents?.length ? (
                status.subagents.map((sa, i) => (
                  <div key={i} className="popup-item subagent-item">
                    <span className={`status-dot ${sa.status === 'running' ? 'running' : sa.status === 'completed' ? 'success' : sa.status === 'error' ? 'error' : ''}`} />
                    <span className="subagent-name">{sa.name}</span>
                    <span className="subagent-status">{sa.status}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state">{t('status.noSubagents')}</div>
              )
            )}
            {openPanel === 'edits' && (
              status.edits?.files?.length ? (
                status.edits.files.map((f, i) => (
                  <div key={i} className="popup-item edit-item">
                    <span className="file-link">{f}</span>
                    {onUndoFile && (
                      <button
                        className="undo-file-btn"
                        onClick={(e) => { e.stopPropagation(); onUndoFile(f); }}
                        title={t('status.undoFile')}
                      >
                        <Undo2 size={12} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty-state">{t('status.noChanges')}</div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
