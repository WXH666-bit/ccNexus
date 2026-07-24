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

  return (
    <div className="permission-overlay">
      <div className="plan-dialog" onClick={e => e.stopPropagation()}>
        <div className="plan-header">
          <ClipboardCheck size={20} className="plan-icon" />
          <h3>{plan.title || '计划审批'}</h3>
        </div>
        <div className="plan-body">
          {plan.summary && <p className="plan-summary">{plan.summary}</p>}
          <div className="plan-steps">
            {plan.steps.map((step, i) => (
              <div key={i} className="plan-step">
                <span className="plan-step-num">{i + 1}</span>
                <span className="plan-step-text">{step}</span>
              </div>
            ))}
          </div>
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
