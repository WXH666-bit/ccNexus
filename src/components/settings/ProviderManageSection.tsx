import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Server, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RefreshIcon from '../RefreshIcon';
import { getProviders, switchProvider } from '../../utils/desktopBridgeApi';

const LOCAL_SETTINGS_ID = '__local_settings_json__';
const CLI_LOGIN_ID = '__cli_login__';

interface Provider {
  id: string;
  name: string;
  isActive?: boolean;
  isLocalProvider?: boolean;
  isCliLoginProvider?: boolean;
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
      const result = await switchProvider(providerId);
      setCurrentProviderId(result.provider?.id || providerId);
      window.dispatchEvent(new CustomEvent('ccnexus:provider-changed', {
        detail: { providerId: result.provider?.id || providerId },
      }));
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    } finally {
      setSwitchingId(null);
    }
  };

  const localProvider = providers.find(provider => provider.id === LOCAL_SETTINGS_ID)
    || { id: LOCAL_SETTINGS_ID, name: t('settings.providers.localSettings'), isLocalProvider: true };
  const cliProvider = providers.find(provider => provider.id === CLI_LOGIN_ID)
    || { id: CLI_LOGIN_ID, name: t('settings.providers.cliLogin'), isCliLoginProvider: true };

  return (
    <div className="settings-section-content provider-management">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.providers.title')}</h3>
          <p className="settings-desc">{t('settings.providers.desc')}</p>
        </div>
        <button
          className="icon-button"
          onClick={() => void loadProviders()}
          disabled={loading}
          title={t('common.refresh', { defaultValue: 'Refresh' })}
        >
          <RefreshIcon size={16} spinning={loading} />
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : (
        <>
          {error && <div className="provider-error" role="alert">{error}</div>}
          <div className="provider-special-list">
            <SpecialProviderCard
              provider={localProvider}
              active={currentProviderId === LOCAL_SETTINGS_ID}
              icon={<Server size={19} />}
              title={t('settings.providers.localSettings')}
              description={t('settings.providers.localSettingsDesc')}
              actionLabel={t('settings.providers.use')}
              currentLabel={t('settings.providers.current')}
              disabled={switchingId !== null}
              switching={switchingId === LOCAL_SETTINGS_ID}
              onSwitch={() => void handleSwitch(LOCAL_SETTINGS_ID)}
            />
            <SpecialProviderCard
              provider={cliProvider}
              active={currentProviderId === CLI_LOGIN_ID}
              icon={<Terminal size={19} />}
              title={t('settings.providers.cliLogin')}
              description={t('settings.providers.cliLoginDesc')}
              actionLabel={t('settings.providers.authorize')}
              currentLabel={t('settings.providers.current')}
              disabled={switchingId !== null}
              switching={switchingId === CLI_LOGIN_ID}
              onSwitch={() => void handleSwitch(CLI_LOGIN_ID)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SpecialProviderCard({
  provider,
  active,
  icon,
  title,
  description,
  actionLabel,
  currentLabel,
  disabled,
  switching,
  onSwitch,
}: {
  provider: Provider;
  active: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  currentLabel: string;
  disabled: boolean;
  switching: boolean;
  onSwitch: () => void;
}) {
  return (
    <div className={`provider-special-card ${active ? 'active' : ''}`}>
      <div className="provider-special-icon">{icon}</div>
      <div className="provider-special-copy">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      {active ? (
        <span className="active-badge"><Check size={12} />{currentLabel}</span>
      ) : (
        <button className="provider-secondary-button" onClick={onSwitch} disabled={disabled}>
          {switching ? '...' : actionLabel}
        </button>
      )}
      {provider.id === LOCAL_SETTINGS_ID && <span className="provider-readonly-label">settings.json</span>}
    </div>
  );
}
