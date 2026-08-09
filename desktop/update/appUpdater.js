export const UPDATE_STATUSES = Object.freeze({
  IDLE: 'idle',
  CHECKING: 'checking',
  NOT_AVAILABLE: 'not-available',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  ERROR: 'error',
});

const UPDATE_EVENTS = [
  'checking-for-update',
  'update-not-available',
  'update-available',
  'download-progress',
  'update-downloaded',
  'error',
];

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNullableString(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeReleaseNotes(notes) {
  if (notes === undefined || notes === null || notes === '') return null;
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    const values = notes
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item.note === 'string') return item.note;
        return '';
      })
      .filter(Boolean);
    return values.length ? values.join('\n\n') : null;
  }
  return String(notes);
}

function updateInfoState(updateInfo = {}) {
  return {
    targetVersion: toNullableString(updateInfo.version),
    releaseName: toNullableString(updateInfo.releaseName),
    releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes),
  };
}

function errorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error || 'Update failed');
}

export function createAppUpdater({
  autoUpdater,
  isPackaged = false,
  currentVersion = '',
  emit = () => {},
  now = () => Date.now(),
  checkCooldownMs = 60_000,
} = {}) {
  if (!autoUpdater || typeof autoUpdater.on !== 'function') {
    throw new TypeError('autoUpdater with event support is required');
  }

  const packaged = Boolean(isPackaged);
  let state = {
    status: UPDATE_STATUSES.IDLE,
    isPackaged: packaged,
    currentVersion: String(currentVersion || ''),
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
  let initialized = false;
  let checkRequest = null;
  let downloadRequest = null;
  const listeners = new Map();

  function getState() {
    return { ...state };
  }

  function publish(patch) {
    state = { ...state, ...patch };
    emit(getState());
    return getState();
  }

  function publishError(error) {
    return publish({
      status: UPDATE_STATUSES.ERROR,
      error: errorMessage(error),
      lastCheckedAt: null,
    });
  }

  function bind(eventName, handler) {
    const listener = (...args) => handler(...args);
    listeners.set(eventName, listener);
    autoUpdater.on(eventName, listener);
  }

  function initialize() {
    if (initialized) return getState();

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    bind('checking-for-update', () => publish({
      status: UPDATE_STATUSES.CHECKING,
      error: null,
      lastCheckedAt: now(),
    }));
    bind('update-not-available', updateInfo => publish({
      ...updateInfoState(updateInfo),
      status: UPDATE_STATUSES.NOT_AVAILABLE,
      error: null,
    }));
    bind('update-available', updateInfo => publish({
      ...updateInfoState(updateInfo),
      status: UPDATE_STATUSES.AVAILABLE,
      error: null,
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    }));
    bind('download-progress', progress => publish({
      status: UPDATE_STATUSES.DOWNLOADING,
      percent: toFiniteNumber(progress?.percent),
      bytesPerSecond: toFiniteNumber(progress?.bytesPerSecond),
      transferred: toFiniteNumber(progress?.transferred),
      total: toFiniteNumber(progress?.total),
      error: null,
    }));
    bind('update-downloaded', updateInfo => publish({
      ...updateInfoState(updateInfo),
      status: UPDATE_STATUSES.DOWNLOADED,
      percent: 100,
      error: null,
    }));
    bind('error', publishError);

    initialized = true;
    return getState();
  }

  function checkForUpdates() {
    if (!packaged) return Promise.resolve(getState());
    initialize();

    if (checkRequest) return checkRequest;

    const currentTime = now();
    if (state.lastCheckedAt !== null && currentTime - state.lastCheckedAt < checkCooldownMs) {
      return Promise.resolve(getState());
    }

    publish({
      status: UPDATE_STATUSES.CHECKING,
      error: null,
      lastCheckedAt: currentTime,
    });

    const request = Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch(error => publishError(error))
      .then(() => getState());
    const trackedRequest = request.finally(() => {
      if (checkRequest === trackedRequest) checkRequest = null;
    });
    checkRequest = trackedRequest;
    return trackedRequest;
  }

  function downloadUpdate() {
    if (!packaged || state.status !== UPDATE_STATUSES.AVAILABLE) {
      return Promise.resolve(getState());
    }
    initialize();
    if (downloadRequest) return downloadRequest;

    publish({
      status: UPDATE_STATUSES.DOWNLOADING,
      error: null,
    });

    const request = Promise.resolve()
      .then(() => autoUpdater.downloadUpdate())
      .catch(error => publishError(error))
      .then(() => getState());
    const trackedRequest = request.finally(() => {
      if (downloadRequest === trackedRequest) downloadRequest = null;
    });
    downloadRequest = trackedRequest;
    return trackedRequest;
  }

  function installUpdate() {
    if (!packaged || state.status !== UPDATE_STATUSES.DOWNLOADED) {
      return Promise.resolve(getState());
    }
    try {
      autoUpdater.quitAndInstall();
    } catch (error) {
      publishError(error);
    }
    return Promise.resolve(getState());
  }

  function dispose() {
    for (const [eventName, listener] of listeners) {
      if (typeof autoUpdater.removeListener === 'function') {
        autoUpdater.removeListener(eventName, listener);
      }
    }
    listeners.clear();
    initialized = false;
  }

  return {
    initialize,
    getState,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dispose,
    updateEvents: UPDATE_EVENTS,
  };
}
