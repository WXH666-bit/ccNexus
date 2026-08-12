import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Download, RotateCw } from 'lucide-react';
import RefreshIcon from '../RefreshIcon';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  onUpdateStatus,
} from '../../utils/desktopBridgeApi';
import { formatUpdateError } from '../../utils/updateError';

const INITIAL_UPDATE_STATE: AppUpdateState = {
  status: 'idle',
  isPackaged: false,
  currentVersion: '',
  targetVersion: null,
  releaseName: null,
  releaseNotes: null,
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: null,
  lastCheckedAt: null,
};

const STATUS_LABELS: Record<AppUpdateStatus, string> = {
  idle: 'settings.update.check',
  checking: 'settings.update.checking',
  'not-available': 'settings.update.notAvailable',
  available: 'settings.update.available',
  downloading: 'settings.update.downloading',
  downloaded: 'settings.update.downloaded',
  error: 'settings.update.error',
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function AppUpdateSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<AppUpdateState>(INITIAL_UPDATE_STATE);
  const [busy, setBusy] = useState(false);
  const desktopBridgeAvailable = typeof window !== 'undefined' && Boolean(window.ccNexusDesktop);
  const presentState = (nextState: AppUpdateState): AppUpdateState => ({
    ...nextState,
    error: nextState.error ? formatUpdateError(nextState.error, key => t(key)) : null,
  });

  useEffect(() => {
    if (!desktopBridgeAvailable) return;

    let active = true;
    const unsubscribe = onUpdateStatus(nextState => {
      if (active) setState(presentState(nextState));
    });

    void getUpdateState()
      .then(nextState => {
        if (active) setState(presentState(nextState));
      })
      .catch(error => {
        if (active) {
          setState(previous => ({
            ...previous,
            status: 'error',
            error: formatUpdateError(error, key => t(key)),
          }));
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktopBridgeAvailable, t]);

  const runAction = async (action: () => Promise<AppUpdateState>) => {
    if (busy) return;
    setBusy(true);
    try {
      setState(presentState(await action()));
    } catch (error) {
      setState(previous => ({
        ...previous,
        status: 'error',
        error: formatUpdateError(error, key => t(key)),
      }));
    } finally {
      setBusy(false);
    }
  };

  const progress = Math.min(100, Math.max(0, Number.isFinite(state.percent) ? state.percent : 0));
  const isDownloading = state.status === 'downloading';
  const isChecking = state.status === 'checking';
  const statusLabel = state.isPackaged
    ? t(STATUS_LABELS[state.status])
    : t('settings.update.developmentStatus');

  if (!desktopBridgeAvailable) return null;

  return (
    <section className="app-update-card" aria-labelledby="app-update-title">
      <div className="app-update-header">
        <div className="app-update-heading">
          <span className="app-update-icon" aria-hidden="true">
            <RefreshIcon size={16} spinning={isChecking || isDownloading} />
          </span>
          <div>
            <div className="app-update-title" id="app-update-title">
              <span>{t('settings.update.title')}</span>
            </div>
            {state.isPackaged && (
              <p className="app-update-description">
                {t('settings.update.stable')}
              </p>
            )}
          </div>
        </div>
        <span className={`app-update-status status-${state.status}`}>
          {statusLabel}
        </span>
      </div>

      <div className="app-update-summary">
        <div className="app-update-versions">
          <div className="app-update-version">
          <span>{t('settings.update.currentVersion')}</span>
          <strong>{state.currentVersion || '—'}</strong>
          </div>
          {state.targetVersion && (
            <div className="app-update-version app-update-version-target">
            <span>{t('settings.update.latestVersion')}</span>
            <strong>{state.targetVersion}</strong>
            </div>
          )}
        </div>

        <div className="app-update-actions">
          {state.isPackaged && state.status === 'available' && (
            <button className="app-update-action" disabled={busy} onClick={() => void runAction(downloadUpdate)}>
              <Download size={14} aria-hidden="true" />
              {t('settings.update.download')}
            </button>
          )}

          {state.isPackaged && state.status === 'downloaded' && (
            <button className="app-update-action" disabled={busy} onClick={() => void runAction(installUpdate)}>
              <RotateCw size={14} aria-hidden="true" />
              {t('settings.update.install')}
            </button>
          )}

          {state.isPackaged && !isChecking && !isDownloading && state.status !== 'available' && state.status !== 'downloaded' && (
            <button className="app-update-action app-update-action-secondary" disabled={busy} onClick={() => void runAction(checkForUpdates)}>
              <RefreshIcon size={14} spinning={busy} aria-hidden="true" />
              {state.status === 'error' ? t('settings.update.retry') : t('settings.update.check')}
            </button>
          )}
        </div>
      </div>

      {state.releaseName && <div className="app-update-release-name">{state.releaseName}</div>}

      {state.releaseNotes && (
        <div className="app-update-notes">
          <div className="app-update-notes-label">{t('settings.update.releaseNotes')}</div>
          <div className="app-update-notes-body">{state.releaseNotes}</div>
        </div>
      )}

      {isDownloading && (
        <div className="app-update-progress" aria-live="polite">
          <div className="app-update-progress-heading">
            <span>{t('settings.update.progress')}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
          <div className="app-update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="app-update-progress-details">
            <span>{formatBytes(state.transferred)} / {formatBytes(state.total)}</span>
            <span>{t('settings.update.speed')}: {formatBytes(state.bytesPerSecond)}/s</span>
          </div>
        </div>
      )}

      {state.error && (
        <div className="app-update-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      )}

    </section>
  );
}
