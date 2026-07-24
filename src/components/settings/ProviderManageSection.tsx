import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, Plus, Check } from 'lucide-react';

interface Provider {
  id: string;
  name: string;
  apiKey: string;
  active: boolean;
}

export default function ProviderManageSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([
    { id: 'anthropic', name: 'Anthropic', apiKey: 'sk-***', active: true },
  ]);

  const switchProvider = (id: string) => {
    setProviders(providers.map(p => ({ ...p, active: p.id === id })));
  };

  const addProvider = () => {
    const name = prompt('Provider name:');
    if (name) {
      setProviders([...providers, { 
        id: Date.now().toString(), 
        name, 
        apiKey: '', 
        active: false 
      }]);
    }
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.providers.title')}</h3>
      <p className="settings-desc">{t('settings.providers.desc')}</p>

      <div className="provider-list">
        {providers.map(provider => (
          <div key={provider.id} className={`provider-card ${provider.active ? 'active' : ''}`}>
            <div className="provider-info">
              <Server size={20} />
              <div>
                <h4>{provider.name}</h4>
                <span className="provider-key">{provider.apiKey}</span>
              </div>
            </div>
            <div className="provider-actions">
              {provider.active && (
                <span className="active-badge">
                  <Check size={12} />
                  {t('settings.providers.current')}
                </span>
              )}
              {!provider.active && (
                <button 
                  className="btn btn-secondary btn-sm"
                  onClick={() => switchProvider(provider.id)}
                >
                  {t('settings.providers.switch')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn-primary" onClick={addProvider}>
        <Plus size={14} />
        {t('settings.providers.add')}
      </button>
    </div>
  );
}
