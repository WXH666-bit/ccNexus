import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, Server } from 'lucide-react';
import { getProviders, switchProvider } from '../utils/desktopBridgeApi';

interface Provider {
  id: string;
  name: string;
  base_url?: string;
  api_key?: string;
  model_mapping?: string | Record<string, string>;
}

interface ProviderSelectProps {
  currentProviderId?: string;
  onProviderChange?: (providerId: string) => void;
}

export default function ProviderSelect({ currentProviderId, onProviderChange }: ProviderSelectProps) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const data = await getProviders();
      setProviders(data.providers || []);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (providerId: string) => {
    try {
      await switchProvider(providerId);
      onProviderChange?.(providerId);
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to switch provider:', err);
    }
  };

  const currentProvider = providers.find(p => p.id === currentProviderId || p.name === currentProviderId);

  return (
    <div className="provider-select">
      <button
        className="provider-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        title={t('chat.provider.select')}
      >
        <Server size={14} />
        <span className="provider-name">
          {currentProvider?.name || t('chat.provider.default')}
        </span>
        <ChevronDown size={14} className={isOpen ? 'rotate' : ''} />
      </button>

      {isOpen && (
        <div className="provider-select-dropdown">
          {providers.length === 0 ? (
            <div className="provider-empty">
              {t('chat.provider.empty')}
            </div>
          ) : (
            providers.map(provider => (
              <button
                key={provider.id}
                className={`provider-option ${provider.id === currentProviderId ? 'active' : ''}`}
                onClick={() => handleSelect(provider.id)}
              >
                <span className="provider-option-name">{provider.name}</span>
                {provider.id === currentProviderId && <Check size={14} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
