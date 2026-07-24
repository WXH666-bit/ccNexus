import { Shield, Check, X, Clock } from 'lucide-react';
import type { PermissionRequest } from '../types';

interface Props {
  permission: PermissionRequest;
  onAllow: () => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export default function PermissionDialog({ permission, onAllow, onDeny, onAlwaysAllow }: Props) {
  const inputStr = Object.keys(permission.input).length > 0
    ? JSON.stringify(permission.input, null, 2)
    : '无参数';

  return (
    <div className="permission-overlay" onClick={onDeny}>
      <div className="permission-dialog" onClick={e => e.stopPropagation()}>
        <div className="permission-header">
          <Shield size={20} className="permission-icon" />
          <h3>权限请求</h3>
        </div>
        <div className="permission-body">
          <p className="permission-tool">工具：<strong>{permission.tool_name}</strong></p>
          <div className="permission-input">
            <pre>{inputStr}</pre>
          </div>
        </div>
        <div className="permission-actions">
          <button className="perm-btn deny-btn" onClick={onDeny}>
            <X size={14} /> 拒绝
          </button>
          <button className="perm-btn allow-btn" onClick={onAllow}>
            <Check size={14} /> 允许
          </button>
          <button className="perm-btn always-btn" onClick={onAlwaysAllow}>
            <Clock size={14} /> 始终允许
          </button>
        </div>
      </div>
    </div>
  );
}
