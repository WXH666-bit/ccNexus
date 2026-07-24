import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

interface ToolPermission {
  name: string;
  allowed: boolean;
}

export default function PermissionsSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState('auto');
  const [tools, setTools] = useState<ToolPermission[]>([
    { name: 'EditTool', allowed: true },
    { name: 'BashTool', allowed: false },
    { name: 'ReadTool', allowed: true },
  ]);

  const addTool = () => {
    const name = prompt('Enter tool name:');
    if (name) {
      setTools([...tools, { name, allowed: false }]);
    }
  };

  const toggleTool = (index: number) => {
    const newTools = [...tools];
    newTools[index].allowed = !newTools[index].allowed;
    setTools(newTools);
  };

  const removeTool = (index: number) => {
    setTools(tools.filter((_, i) => i !== index));
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.permissions.title')}</h3>
      <p className="settings-desc">{t('settings.permissions.desc')}</p>

      <div className="setting-group">
        <label>{t('settings.permissions.mode')}</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="auto">{t('settings.permissions.modes.auto')}</option>
          <option value="plan">{t('settings.permissions.modes.plan')}</option>
          <option value="acceptEdits">{t('settings.permissions.modes.acceptEdits')}</option>
        </select>
      </div>

      <div className="setting-group">
        <label>{t('settings.permissions.whitelist')}</label>
        <div className="tool-permission-list">
          {tools.map((tool, idx) => (
            <div key={idx} className="tool-permission-item">
              <span className="tool-name">{tool.name}</span>
              <div className="tool-actions">
                <label className="toggle">
                  <input 
                    type="checkbox" 
                    checked={tool.allowed} 
                    onChange={() => toggleTool(idx)} 
                  />
                  <span className="toggle-slider"></span>
                </label>
                <button className="icon-btn danger" onClick={() => removeTool(idx)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-secondary" onClick={addTool}>
          <Plus size={14} />
          {t('settings.permissions.addTool')}
        </button>
      </div>
    </div>
  );
}
