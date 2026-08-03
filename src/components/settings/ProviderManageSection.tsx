import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getProviders, switchProvider } from '../../utils/desktopBridgeApi';

interface Provider {
  id: string;
  name: string;
  source?: string;
  settingsConfig?: { env?: Record<string, string> };
  base_url?: string;
}

interface ProviderResponse {
  providers?: Provider[];
  currentProviderId?: string | null;
}

export default function ProviderManageSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [currentProviderId, setCurrentProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getProviders() as ProviderResponse;
      setProviders(Array.isArray(result.providers) ? result.providers : []);
      setCurrentProviderId(result.currentProviderId || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const handleSwitch = async (providerId: string) => {
    setSwitchingId(providerId);
    setError('');
    try {
      await switchProvider(providerId);
      setCurrentProviderId(providerId);
      window.dispatchEvent(new CustomEvent('ccnexus:provider-changed', { detail: { providerId } }));
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <div className="settings-section-content">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.providers.title')}</h3>
          <p className="settings-desc">{t('settings.providers.desc')}</p>
        </div>
        <button className="icon-button" onClick={() => void loadProviders()} disabled={loading} title={t('common.refresh', { defaultValue: 'Refresh' })}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : error ? (
        <div className="empty-state"><p>{error}</p></div>
      ) : providers.length === 0 ? (
        <div className="empty-state">
          <Server size={42} className="empty-icon" />
          <p>{t('settings.providers.empty', { defaultValue: 'No providers found' })}</p>
        </div>
      ) : (
        <div className="provider-list">
          {providers.map(provider => {
            const active = provider.id === currentProviderId;
            const model = provider.settingsConfig?.env?.ANTHROPIC_MODEL
              || provider.settingsConfig?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL;
            return (
              <div key={provider.id} className={`provider-card ${active ? 'active' : ''}`}>
                <div className="provider-info">
                  <Server size={20} />
                  <div>
                    <h4>{provider.name}</h4>
                    <span className="provider-key">{model || provider.base_url || provider.source || provider.id}</span>
                  </div>
                </div>
                <div className="provider-actions">
                  {active ? (
                    <span className="active-badge"><Check size={12} />{t('settings.providers.current')}</span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => void handleSwitch(provider.id)} disabled={switchingId !== null}>
                      {switchingId === provider.id ? t('common.loading') : t('settings.providers.switch')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
