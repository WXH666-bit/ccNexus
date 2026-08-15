import { AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, confirmText = '确认', cancelText = '取消', danger = false, onConfirm, onCancel,
}: Props) {
  return (
    <div className="permission-overlay full-access-confirm-overlay" onClick={onCancel}>
      <div
        className="permission-dialog full-access-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="permission-header full-access-confirm-header">
          <AlertTriangle size={20} className="full-access-confirm-icon" />
          <h3 id="confirm-dialog-title">{title}</h3>
        </div>
        <div className="permission-body full-access-confirm-body">
          <p>{message}</p>
        </div>
        <div className="permission-actions">
          <button type="button" className="perm-btn deny-btn" onClick={onCancel} autoFocus>
            {cancelText}
          </button>
          <button
            type="button"
            className={`perm-btn ${danger ? 'confirm-danger-btn' : 'full-access-confirm-btn'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
