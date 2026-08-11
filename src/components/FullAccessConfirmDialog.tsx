import { AlertTriangle } from 'lucide-react';

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function FullAccessConfirmDialog({ onConfirm, onCancel }: Props) {
  return (
    <div className="permission-overlay full-access-confirm-overlay" onClick={onCancel}>
      <div
        className="permission-dialog full-access-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-access-confirm-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="permission-header full-access-confirm-header">
          <AlertTriangle size={20} className="full-access-confirm-icon" />
          <h3 id="full-access-confirm-title">确认启用完全访问模式？</h3>
        </div>
        <div className="permission-body full-access-confirm-body">
          <p>
            完全访问模式会跳过 Claude Code 的权限检查，模型可以直接执行文件修改、命令运行等操作。
          </p>
          <p className="full-access-confirm-note">请只在完全信任当前任务时使用。</p>
        </div>
        <div className="permission-actions">
          <button type="button" className="perm-btn deny-btn" onClick={onCancel} autoFocus>
            取消
          </button>
          <button type="button" className="perm-btn full-access-confirm-btn" onClick={onConfirm}>
            启用完全访问
          </button>
        </div>
      </div>
    </div>
  );
}
