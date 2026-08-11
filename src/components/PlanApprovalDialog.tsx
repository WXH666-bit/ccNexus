import { ClipboardCheck, Check, X, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { PlanApprovalRequest } from '../types';

interface Props {
  plan: PlanApprovalRequest;
  onApprove: (feedback?: string) => void;
  onReject: (feedback: string) => void;
}

export default function PlanApprovalDialog({ plan, onApprove, onReject }: Props) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const legacySteps = plan.steps || [];
  const planText = plan.plan.trim();

  return (
    <div className="permission-overlay">
      <div className="plan-dialog" onClick={e => e.stopPropagation()}>
        <div className="plan-header">
          <ClipboardCheck size={20} className="plan-icon" />
          <h3>{plan.title || '计划审批'}</h3>
        </div>
        <div className="plan-body">
          {plan.summary && <p className="plan-summary">{plan.summary}</p>}
          {planText && <pre className="plan-markdown">{planText}</pre>}
          {legacySteps.length > 0 && (
            <div className="plan-steps">
              {legacySteps.map((step, i) => (
                <div key={i} className="plan-step">
                  <span className="plan-step-num">{i + 1}</span>
                  <span className="plan-step-text">{step}</span>
                </div>
              ))}
            </div>
          )}
          {plan.allowedPrompts.length > 0 && (
            <div className="plan-allowed-prompts">
              <div className="plan-allowed-prompts-title">允许的操作</div>
              {plan.allowedPrompts.map((item, index) => (
                <div className="plan-allowed-prompt" key={`${item.tool}-${index}`}>
                  <code>{item.tool}</code>
                  <span>{item.prompt}</span>
                </div>
              ))}
            </div>
          )}
          {showFeedback && (
            <div className="plan-feedback">
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="输入修改意见（可选）..."
                className="plan-feedback-input"
                rows={3}
              />
            </div>
          )}
        </div>
        <div className="plan-actions">
          <button
            className="perm-btn deny-btn"
            onClick={() => {
              if (!showFeedback) {
                setShowFeedback(true);
              } else {
                onReject(feedback);
              }
            }}
          >
            <X size={14} /> {showFeedback ? '提交拒绝' : '拒绝'}
          </button>
          <button className="perm-btn allow-btn" onClick={() => onApprove()}>
            <Check size={14} /> 批准执行
          </button>
        </div>
      </div>
    </div>
  );
}
