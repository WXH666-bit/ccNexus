import { ChevronDown, Layers, Paperclip, RotateCcw, X } from 'lucide-react';
import TokenIndicator from './TokenIndicator';

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
      </div>

      {attachments.length > 0 ? (
        attachments.map((attachment, index) => (
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
        ))
      ) : (
        <button type="button" className="context-file-placeholder" title="文件上下文">
          <span className="context-file-icon" />
          <span className="placeholder-text">文件上下文</span>
        </button>
      )}

      <div className="context-tools-right">
        <button
          type="button"
          className={`context-tool-btn status-panel-toggle ${showStatusPanel ? 'expanded' : 'collapsed'}`}
          onClick={event => {
            event.stopPropagation();
            onToggleStatusPanel();
          }}
          title={showStatusPanel ? '收起状态面板' : '展开状态面板'}
        >
          {showStatusPanel ? <ChevronDown size={16} /> : <Layers size={16} />}
        </button>
        <button type="button" className="context-tool-btn" title="回溯">
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
}
