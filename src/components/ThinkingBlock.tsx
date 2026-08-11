import { renderMarkdown } from '../utils/markdown';

interface ThinkingBlockProps {
  thinking: string;
  isExpanded: boolean;
  isStreamingLatest: boolean;
  onToggle: () => void;
}

export default function ThinkingBlock({
  thinking,
  isExpanded,
  isStreamingLatest,
  onToggle,
}: ThinkingBlockProps) {
  const title = isStreamingLatest ? '思考过程' : '思考';
  const normalizedThinking = typeof thinking === 'string' ? thinking.trim() : '';
  if (!normalizedThinking) return null;
  const rendered = renderMarkdown(normalizedThinking);

  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={onToggle}>
        <span className="thinking-title">{title}</span>
        <span className="thinking-icon">{isExpanded ? '▼' : '▶'}</span>
      </div>
      <div
        className="thinking-content"
        style={isExpanded ? { display: 'block' } : { display: 'none' }}
      >
        <div className="markdown-content" dangerouslySetInnerHTML={{ __html: rendered }} />
      </div>
    </div>
  );
}
