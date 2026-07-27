import { AtSign, Bot, Command, FileText, MessageSquareQuote } from 'lucide-react';

export type CompletionKind = 'file' | 'agent' | 'prompt' | 'command';

export interface CompletionItem {
  id: string;
  label: string;
  value: string;
  description?: string;
  kind: CompletionKind;
}

interface Props {
  items: CompletionItem[];
  onSelect: (item: CompletionItem) => void;
}

function iconForKind(kind: CompletionKind) {
  if (kind === 'file') return <AtSign size={14} />;
  if (kind === 'agent') return <Bot size={14} />;
  if (kind === 'prompt') return <MessageSquareQuote size={14} />;
  return <Command size={14} />;
}

export default function CompletionDropdown({ items, onSelect }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="completion-dropdown chat-completion-dropdown">
      {items.map(item => (
        <button
          key={`${item.kind}-${item.id}`}
          type="button"
          className="dropdown-item chat-completion-item"
          onMouseDown={event => {
            event.preventDefault();
            onSelect(item);
          }}
        >
          <span className="completion-kind-icon">{iconForKind(item.kind)}</span>
          <span className="completion-main">
            <span className="completion-label">{item.label}</span>
            {item.description && <span className="dropdown-desc">{item.description}</span>}
          </span>
          {item.kind === 'file' && <FileText size={12} className="completion-tail-icon" />}
        </button>
      ))}
    </div>
  );
}
