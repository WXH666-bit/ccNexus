import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getProviders } from '../../utils/desktopBridgeApi';

interface ProviderResponse {
  currentProviderId?: string | null;
  currentEnv?: Record<string, string | undefined>;
}

function maskValue(key: string, value: string) {
  if (!value) return '(empty)';
  if (!/(KEY|TOKEN|SECRET|PASSWORD|AUTH)/i.test(key)) return value;
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export default function EnvVarEditor() {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState<string | null>(null);
  const [env, setEnv] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEnvironment = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getProviders() as ProviderResponse;
      setProviderId(result.currentProviderId || null);
      setEnv(result.currentEnv || {});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEnvironment();
  }, [loadEnvironment]);

  const entries = Object.entries(env).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="settings-section-content">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.env.title')}</h3>
          <p className="settings-desc">{t('settings.env.desc')} 当前仅展示生效环境，不会写入 Claude Code 配置。</p>
        </div>
        <button className="icon-button" onClick={() => void loadEnvironment()} disabled={loading} title="刷新">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : error ? (
        <div className="empty-state"><p>{error}</p></div>
      ) : (
        <>
          <div className="settings-info-note"><KeyRound size={15} /> 当前供应商：{providerId || '未选择'}</div>
          <div className="env-var-list">
            {entries.length === 0 ? (
              <div className="empty-state"><p>当前供应商没有额外环境变量</p></div>
            ) : entries.map(([key, value]) => (
              <div key={key} className="env-var-item env-var-item-readonly">
                <span className="env-key">{key}</span>
                <code className="env-value">{maskValue(key, value || '')}</code>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
