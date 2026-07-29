interface Props {
  percentage: number;
  size?: number;
  usedTokens?: number;
  maxTokens?: number;
}

function formatTokens(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value >= 1_000) {
    const kValue = value / 1_000;
    return Number.isInteger(kValue) ? `${kValue}k` : `${kValue.toFixed(1)}k`;
  }
  return String(value);
}

function formatPercentageLabel(safePercentage: number) {
  if (safePercentage <= 0) return '0%';
  if (safePercentage < 1) return '<1%';
  if (safePercentage < 10) return `${(Math.round(safePercentage * 10) / 10).toFixed(1)}%`;
  return `${Math.round(safePercentage)}%`;
}

export default function TokenIndicator({
  percentage,
  size = 14,
  usedTokens,
  maxTokens,
}: Props) {
  const safePercentage = Math.max(0, Math.min(100, percentage));
  const radius = (size - 3) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - safePercentage / 100);
  const labelPercentage = formatPercentageLabel(safePercentage);
  const tooltipPercentage = `${(Math.round(safePercentage * 10) / 10).toFixed(1)}%`;
  const usedText = formatTokens(usedTokens);
  const maxText = formatTokens(maxTokens);
  const tooltip = usedText && maxText
    ? `${tooltipPercentage} · ${usedText} / ${maxText} 上下文`
    : `上下文用量 ${tooltipPercentage}`;

  return (
    <div className="token-indicator" title={tooltip}>
      <div className="token-indicator-wrap">
        <svg
          className="token-indicator-ring"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle className="token-indicator-bg" cx={center} cy={center} r={radius} />
          <circle
            className="token-indicator-fill"
            cx={center}
            cy={center}
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
          />
        </svg>
      </div>
      <span className="token-percentage-label">{labelPercentage}</span>
    </div>
  );
}
