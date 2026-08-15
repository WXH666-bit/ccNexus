import { ChevronDown, ChevronUp, Paperclip, RotateCcw, X } from 'lucide-react';
import TokenIndicator from './TokenIndicator';
import QueueOrb from '../QueueOrb';
import type { QueuedChatMessage } from '../../utils/abortWindowState.js';

interface Attachment {
  type: string;
  name: string;
  data: string;
}

interface Props {
  attachments: Attachment[];
  percentage: number;
  usedTokens?: number;
  maxTokens?: number;
  showStatusPanel: boolean;
  onToggleStatusPanel: () => void;
  onPickFiles: (files: FileList) => void;
  onRemoveAttachment: (index: number) => void;
  queue: QueuedChatMessage[];
  onRemoveQueued: (id: string) => void;
  onUpdateQueued: (id: string, text: string) => void;
  onClearQueued: () => void;
}

export default function ContextBar({
  attachments,
  percentage,
  usedTokens,
  maxTokens,
  showStatusPanel,
  onToggleStatusPanel,
  onPickFiles,
  onRemoveAttachment,
  queue,
  onRemoveQueued,
  onUpdateQueued,
  onClearQueued,
}: Props) {
  return (
    <div className="context-bar">
      <div className="context-tools">
        <label className="context-tool-btn" title="添加附件">
          <Paperclip size={16} />
          <input
            type="file"
            multiple
            className="hidden-file-input"
            onChange={event => {
              if (event.target.files) onPickFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <div className="context-token-indicator">
          <TokenIndicator
            percentage={percentage}
            usedTokens={usedTokens}
            maxTokens={maxTokens}
            size={14}
          />
        </div>
        <div className="context-tool-divider" />
        <QueueOrb queue={queue} onRemove={onRemoveQueued} onUpdate={onUpdateQueued} onClear={onClearQueued} />
      </div>

      {attachments.length > 0 && attachments.map((attachment, index) => (
        <span key={`${attachment.name}-${index}`} className="context-item attachment-chip">
          <span className="context-text">{attachment.name}</span>
          <button
            type="button"
            className="context-close-btn"
            onClick={event => {
              event.stopPropagation();
              onRemoveAttachment(index);
            }}
            title="移除附件"
          >
            <X size={12} />
          </button>
        </span>
      ))}

      <div className="context-tools-right">
        <button
          type="button"
          className={`context-tool-btn status-panel-toggle-button ${showStatusPanel ? 'expanded' : 'collapsed'}`}
          onClick={event => {
            event.stopPropagation();
            onToggleStatusPanel();
          }}
          aria-label={showStatusPanel ? '收起状态面板' : '展开状态面板'}
          aria-expanded={showStatusPanel}
          title={showStatusPanel ? '收起状态面板' : '展开状态面板'}
        >
          {showStatusPanel ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button type="button" className="context-tool-btn" title="回溯">
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
}
