import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ContextUsageData {
  categories: Array<{
    name: string;
    tokens: number;
    color: string;
    isDeferred?: boolean;
  }>;
  gridRows: Array<Array<{
    color: string;
    isFilled: boolean;
    categoryName: string;
    tokens: number;
    percentage: number;
    squareFullness: number;
  }>>;
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  model: string;
  memoryFiles: Array<{ path: string; type: string; tokens: number }>;
  mcpTools: Array<{ name: string; serverName: string; tokens: number; isLoaded?: boolean }>;
  agents: Array<{ agentType: string; source: string; tokens: number }>;
  skills?: {
    totalSkills: number;
    includedSkills: number;
    tokens: number;
    skillFrontmatter: Array<{ name: string; source: string; tokens: number }>;
  };
  isAutoCompactEnabled: boolean;
  autoCompactThreshold?: number;
  apiUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  } | null;
  runtimeClassification?: 'cold' | 'warm';
  runtimeRetirementReason?: string;
}

interface ContextUsageDialogProps {
  isOpen: boolean;
  isLoading: boolean;
  data: ContextUsageData | null;
  error?: string;
  onClose: () => void;
}

const COLOR_MAP: Record<string, string> = {
  promptBorder: '#7c6ff7',
  inactive: '#6b7280',
  cyanForSubagents: '#22d3ee',
  permission: '#10b981',
  claude: '#d97706',
  warning: '#f59e0b',
  purpleForSubagents: '#a78bfa',
  success: '#22c55e',
  error: '#ef4444',
};

function resolveColor(value: string) {
  return COLOR_MAP[value] || (value.startsWith('#') ? value : '#6b7280');
}

function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

interface DetailsTableProps<T> {
  summary: string;
  headers: readonly [string, string, string];
  rows: readonly T[];
  rowKey: (row: T) => string;
  renderRow: (row: T) => readonly [ReactNode, ReactNode, ReactNode];
}

function DetailsTable<T>({ summary, headers, rows, rowKey, renderRow }: DetailsTableProps<T>) {
  return (
    <details className="context-usage-detail-section">
      <summary>{summary}</summary>
      <table className="context-usage-table">
        <thead><tr><th>{headers[0]}</th><th>{headers[1]}</th><th>{headers[2]}</th></tr></thead>
        <tbody>
          {rows.map(row => {
            const cells = renderRow(row);
            return <tr key={rowKey(row)}><td>{cells[0]}</td><td>{cells[1]}</td><td>{cells[2]}</td></tr>;
          })}
        </tbody>
      </table>
    </details>
  );
}

const ContextUsageDialog = memo(function ContextUsageDialog({
  isOpen,
  isLoading,
  data,
  error,
  onClose,
}: ContextUsageDialogProps) {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const translateCategory = useCallback((name: string) => {
    const keys: Record<string, string> = {
      'System prompt': 'contextUsage.categories.systemPrompt',
      'System tools': 'contextUsage.categories.systemTools',
      'MCP tools': 'contextUsage.categories.mcpTools',
      'Custom agents': 'contextUsage.categories.customAgents',
      'Memory files': 'contextUsage.categories.memoryFiles',
      Skills: 'contextUsage.categories.skills',
      Messages: 'contextUsage.categories.messages',
      'Autocompact buffer': 'contextUsage.categories.autoCompactBuffer',
      'Free space': 'contextUsage.categories.freeSpace',
    };
    return t(keys[name] || name, { defaultValue: name });
  }, [t]);

  const { visibleCategories, freeSpace, autoCompactBuffer } = useMemo(() => {
    const visible: NonNullable<ContextUsageData['categories']> = [];
    let freeSpace: ContextUsageData['categories'][number] | undefined;
    let autoCompactBuffer: ContextUsageData['categories'][number] | undefined;
    for (const category of data?.categories || []) {
      if (category.name === 'Free space') freeSpace = category;
      else if (category.name === 'Autocompact buffer') autoCompactBuffer = category;
      else if (category.tokens > 0) visible.push(category);
    }
    return { visibleCategories: visible, freeSpace, autoCompactBuffer };
  }, [data?.categories]);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const title = t('contextUsage.title', { defaultValue: 'Context Usage' });
  if (isLoading || (!data && !error)) {
    return (
      <div className="context-usage-overlay" onMouseDown={onClose}>
        <div className="context-usage-dialog context-usage-loading" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
          <div className="context-usage-header">
            <h3 className="context-usage-title">{title}</h3>
            <button ref={closeButtonRef} type="button" className="context-usage-close" onClick={onClose} title="关闭" aria-label="关闭"><X size={16} /></button>
          </div>
          <div className="context-usage-loading-body"><div className="context-usage-spinner" /><span>{t('contextUsage.loading', { defaultValue: 'Loading context usage...' })}</span></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="context-usage-overlay" onMouseDown={onClose}>
        <div className="context-usage-dialog context-usage-loading" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
          <div className="context-usage-header">
            <h3 className="context-usage-title">{title}</h3>
            <button ref={closeButtonRef} type="button" className="context-usage-close" onClick={onClose} title="关闭" aria-label="关闭"><X size={16} /></button>
          </div>
          <div className="context-usage-error">{error || 'Context usage is unavailable.'}</div>
        </div>
      </div>
    );
  }

  const {
    gridRows = [],
    totalTokens = 0,
    rawMaxTokens = data.maxTokens || 0,
    percentage = 0,
    model = '',
    memoryFiles = [],
    mcpTools = [],
    agents = [],
    skills,
    isAutoCompactEnabled = false,
    autoCompactThreshold,
  } = data;

  return (
    <div className="context-usage-overlay" onMouseDown={onClose}>
      <div className="context-usage-dialog" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <div className="context-usage-header">
          <h3 className="context-usage-title">{title}</h3>
          <button ref={closeButtonRef} type="button" className="context-usage-close" onClick={onClose} title="关闭" aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="context-usage-summary">
          <span className="context-usage-model">{model}</span>
          <span className="context-usage-tokens">{formatTokens(totalTokens)} / {formatTokens(rawMaxTokens)} ({Number(percentage).toFixed(1)}%)</span>
          {isAutoCompactEnabled && <span className="context-usage-autocompact">{autoCompactThreshold && rawMaxTokens > 0
            ? t('contextUsage.autoCompactEnabledWithThreshold', { threshold: Math.round((autoCompactThreshold / rawMaxTokens) * 100), defaultValue: 'Auto-compact: enabled ({{threshold}}%)' })
            : t('contextUsage.autoCompactEnabled', { defaultValue: 'Auto-compact: enabled' })}</span>}
        </div>
        {gridRows.length > 0 && (
          <div className="context-usage-grid">
            {gridRows.map((row, rowIndex) => <div key={`row-${rowIndex}`} className="context-usage-grid-row">
              {row.map((square, columnIndex) => {
                const filled = square.squareFullness >= 0.7;
                const isFreeSpace = square.categoryName === 'Free space';
                return <div
                  key={`${square.categoryName}-${rowIndex}-${columnIndex}`}
                  className={`context-usage-grid-cell ${isFreeSpace ? 'free-space' : filled ? 'filled' : 'partial'}`}
                  style={isFreeSpace ? undefined : { backgroundColor: resolveColor(square.color), opacity: filled ? 1 : 0.5 + square.squareFullness * 0.5 }}
                  title={`${translateCategory(square.categoryName)}: ${formatTokens(square.tokens)} (${square.percentage.toFixed(1)}%)`}
                />;
              })}
            </div>)}
          </div>
        )}
        <div className="context-usage-legend">
          {visibleCategories.map(category => <div key={`${category.name}-${category.color}`} className="context-usage-legend-item" title={`${translateCategory(category.name)}: ${formatTokens(category.tokens)}`}>
            <span className="context-usage-legend-dot" style={{ backgroundColor: resolveColor(category.color) }} />
            <span className="context-usage-legend-name">{translateCategory(category.name)}</span>
            <span className="context-usage-legend-tokens">{category.isDeferred ? 'N/A' : formatTokens(category.tokens)}</span>
          </div>)}
          {autoCompactBuffer && autoCompactBuffer.tokens > 0 && <div className="context-usage-legend-item">
            <span className="context-usage-legend-dot" style={{ backgroundColor: resolveColor(autoCompactBuffer.color), opacity: 0.5 }} />
            <span className="context-usage-legend-name">{translateCategory(autoCompactBuffer.name)}</span>
            <span className="context-usage-legend-tokens">{formatTokens(autoCompactBuffer.tokens)}</span>
          </div>}
          {freeSpace && freeSpace.tokens > 0 && <div className="context-usage-legend-item free-space-legend">
            <span className="context-usage-legend-dot free-space-dot" />
            <span className="context-usage-legend-name">{translateCategory(freeSpace.name)}</span>
            <span className="context-usage-legend-tokens">{formatTokens(freeSpace.tokens)}</span>
          </div>}
        </div>
        <div className="context-usage-details">
          {mcpTools.length > 0 && <DetailsTable summary={`MCP Tools (${mcpTools.length})`} headers={['Tool', 'Server', 'Tokens']} rows={mcpTools} rowKey={tool => `${tool.serverName}-${tool.name}`} renderRow={tool => [tool.name, tool.serverName, formatTokens(tool.tokens)]} />}
          {agents.length > 0 && <DetailsTable summary={`Agents (${agents.length})`} headers={['Agent', 'Source', 'Tokens']} rows={agents} rowKey={agent => `${agent.source}-${agent.agentType}`} renderRow={agent => [agent.agentType, agent.source, formatTokens(agent.tokens)]} />}
          {memoryFiles.length > 0 && <DetailsTable summary={`Memory Files (${memoryFiles.length})`} headers={['Type', 'Path', 'Tokens']} rows={memoryFiles} rowKey={file => `${file.type}-${file.path}`} renderRow={file => [file.type, <span title={file.path}>{file.path.length > 60 ? `...${file.path.slice(-57)}` : file.path}</span>, formatTokens(file.tokens)]} />}
          {skills && skills.skillFrontmatter.length > 0 && <DetailsTable summary={`Skills (${skills.includedSkills}/${skills.totalSkills})`} headers={['Skill', 'Source', 'Tokens']} rows={skills.skillFrontmatter} rowKey={skill => `${skill.source}-${skill.name}`} renderRow={skill => [skill.name, skill.source, formatTokens(skill.tokens)]} />}
        </div>
      </div>
    </div>
  );
});

export default ContextUsageDialog;
