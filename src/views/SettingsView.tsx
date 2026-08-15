import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Palette, Shield, Bot, Server, BarChart3, Globe,
  Code2, Zap, Settings as SettingsIcon, Sparkles, ChevronLeft, Eye
} from 'lucide-react';
import BasicConfigSection from '../components/settings/BasicConfigSection';
import PermissionsSection from '../components/settings/PermissionsSection';
import AgentSection from '../components/settings/AgentSection';
import ProviderManageSection from '../components/settings/ProviderManageSection';
import MCPSection from '../components/settings/MCPSection';
import SkillsSection from '../components/settings/SkillsSection';
import UsageStatistics from '../components/settings/UsageStatistics';
import EnvVarEditor from '../components/settings/EnvVarEditor';
import AppearanceSection from '../components/settings/AppearanceSection';
import PromptEnhancerSection from '../components/settings/PromptEnhancerSection';
import VisionAssistSection from '../components/settings/VisionAssistSection';

const sections = [
  { id: 'basic', labelKey: 'settings.sections.basic', icon: <Globe size={16} /> },
  { id: 'permissions', labelKey: 'settings.sections.permissions', icon: <Shield size={16} /> },
  { id: 'agents', labelKey: 'settings.sections.agents', icon: <Bot size={16} /> },
  { id: 'providers', labelKey: 'settings.sections.providers', icon: <Server size={16} /> },
  { id: 'mcp', labelKey: 'settings.sections.mcp', icon: <Code2 size={16} /> },
  { id: 'skills', labelKey: 'settings.sections.skills', icon: <Zap size={16} /> },
  { id: 'usage', labelKey: 'settings.sections.usage', icon: <BarChart3 size={16} /> },
  { id: 'env', labelKey: 'settings.sections.env', icon: <SettingsIcon size={16} /> },
  { id: 'appearance', labelKey: 'settings.sections.appearance', icon: <Palette size={16} /> },
  { id: 'prompt', labelKey: 'settings.sections.prompt', icon: <Sparkles size={16} /> },
  { id: 'vision', labelKey: 'settings.sections.vision', icon: <Eye size={16} /> },
];

export default function SettingsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('basic');

  const renderSection = () => {
    switch (activeSection) {
      case 'basic':
        return <BasicConfigSection />;
      case 'permissions':
        return <PermissionsSection />;
      case 'agents':
        return <AgentSection />;
      case 'providers':
        return <ProviderManageSection />;
      case 'mcp':
        return <MCPSection />;
      case 'skills':
        return <SkillsSection />;
      case 'usage':
        return <UsageStatistics />;
      case 'env':
        return <EnvVarEditor />;
      case 'appearance':
        return <AppearanceSection />;
      case 'prompt':
        return <PromptEnhancerSection />;
      case 'vision':
        return <VisionAssistSection />;
      default:
        return <BasicConfigSection />;
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-sidebar">
        <div className="settings-sidebar-header">
          <button className="view-back-btn" onClick={() => navigate('/chat')} title="Back to chat" aria-label="Back to chat">
            <ChevronLeft size={18} />
          </button>
          <h2>{t('settings.title')}</h2>
        </div>
        <nav>
          {sections.map(s => (
            <button
              key={s.id}
              className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.icon}
              <span>{t(s.labelKey)}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="settings-content">
        {renderSection()}
      </div>
    </div>
  );
}
