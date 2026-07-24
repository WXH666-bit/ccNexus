import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UsageStats } from '../types';

interface ContextUsageDialogProps {
  usage: UsageStats | null;
  onClose: () => void;
}

const ContextUsageDialog: React.FC<ContextUsageDialogProps> = ({ usage, onClose }) => {
  const { t } = useTranslation();

  if (!usage) return null;

  // 计算各部分占比
  const totalTokens = usage.input_tokens + usage.output_tokens;
  const maxTokens = 200000; // Claude 上下文窗口
  const usagePercent = Math.min((totalTokens / maxTokens) * 100, 100);

  // 模拟分项统计（实际应从后端获取）
  // TODO: 后端需要提供分项统计接口
  const breakdown = [
    {
      label: t('contextUsage.systemPrompt'),
      tokens: Math.floor(usage.input_tokens * 0.3),
      color: '#3b82f6',
    },
    {
      label: t('contextUsage.toolDefinitions'),
      tokens: Math.floor(usage.input_tokens * 0.2),
      color: '#8b5cf6',
    },
    {
      label: t('contextUsage.messageHistory'),
      tokens: Math.floor(usage.input_tokens * 0.4),
      color: '#10b981',
    },
    {
      label: t('contextUsage.memory'),
      tokens: Math.floor(usage.input_tokens * 0.1),
      color: '#f59e0b',
    },
  ];

  return (
    <div className="context-usage-dialog-overlay" onClick={onClose}>
      <div className="context-usage-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{t('contextUsage.title')}</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="dialog-content">
          {/* 总览 */}
          <div className="usage-overview">
            <div className="usage-total">
              <span className="label">{t('contextUsage.totalUsage')}</span>
              <span className="value">{totalTokens.toLocaleString()} / {maxTokens.toLocaleString()}</span>
            </div>
            <div className="usage-progress">
              <div
                className="progress-bar"
                style={{
                  width: `${usagePercent}%`,
                  backgroundColor: usagePercent > 80 ? '#ef4444' : usagePercent > 60 ? '#f59e0b' : '#10b981',
                }}
              />
            </div>
            <div className="usage-percent">{usagePercent.toFixed(1)}%</div>
          </div>

          {/* 分项明细 */}
          <div className="usage-breakdown">
            <h4>{t('contextUsage.breakdown')}</h4>
            {breakdown.map((item, index) => {
              const percent = (item.tokens / usage.input_tokens) * 100;
              return (
                <div key={index} className="breakdown-item">
                  <div className="breakdown-header">
                    <span className="breakdown-label" style={{ color: item.color }}>
                      {item.label}
                    </span>
                    <span className="breakdown-value">
                      {item.tokens.toLocaleString()} ({percent.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="breakdown-progress">
                    <div
                      className="breakdown-bar"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 输出统计 */}
          <div className="usage-output">
            <div className="output-item">
              <span className="label">{t('contextUsage.outputTokens')}</span>
              <span className="value">{usage.output_tokens.toLocaleString()}</span>
            </div>
            {(usage.cache_read_input_tokens ?? 0) > 0 && (
              <div className="output-item">
                <span className="label">{t('contextUsage.cacheRead')}</span>
                <span className="value">{(usage.cache_read_input_tokens ?? 0).toLocaleString()}</span>
              </div>
            )}
            {(usage.cache_creation_input_tokens ?? 0) > 0 && (
              <div className="output-item">
                <span className="label">{t('contextUsage.cacheCreation')}</span>
                <span className="value">{(usage.cache_creation_input_tokens ?? 0).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContextUsageDialog;
