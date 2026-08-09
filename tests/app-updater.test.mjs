import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createAppUpdater, UPDATE_STATUSES } from '../desktop/update/appUpdater.js';

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = 0;
    this.checkImplementation = async () => undefined;
    this.downloadImplementation = async () => undefined;
  }

  checkForUpdates() {
    this.checkCalls += 1;
    return this.checkImplementation();
  }

  downloadUpdate() {
    this.downloadCalls += 1;
    return this.downloadImplementation();
  }

  quitAndInstall() {
    this.installCalls += 1;
  }
}

function createService(options = {}) {
  const updater = options.autoUpdater || new FakeUpdater();
  const emitted = [];
  const service = createAppUpdater({
    autoUpdater: updater,
    isPackaged: true,
    currentVersion: '2.0.0',
    emit: state => emitted.push(state),
    now: () => options.now ?? 10_000,
    checkCooldownMs: options.checkCooldownMs ?? 60_000,
    ...options,
  });
  return { emitted, service, updater };
}

test('development mode never contacts the update service', async () => {
  const updater = new FakeUpdater();
  const service = createAppUpdater({
    autoUpdater: updater,
    isPackaged: false,
    currentVersion: '2.0.0',
  });

  service.initialize();
  const state = await service.checkForUpdates();

  assert.equal(updater.checkCalls, 0);
  assert.equal(state.status, UPDATE_STATUSES.IDLE);
  assert.equal(state.isPackaged, false);
});

test('updater events become stable state snapshots and dispose removes listeners', () => {
  const { emitted, service, updater } = createService();

  service.initialize();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);

  updater.emit('checking-for-update');
  assert.equal(service.getState().status, UPDATE_STATUSES.CHECKING);

  updater.emit('update-available', {
    version: '2.0.1',
    releaseName: 'Stable release',
    releaseNotes: [{ note: 'Fixes update flow' }, { note: 'Keeps user data' }],
  });
  assert.deepEqual(service.getState(), {
    status: UPDATE_STATUSES.AVAILABLE,
    isPackaged: true,
    currentVersion: '2.0.0',
    targetVersion: '2.0.1',
    releaseName: 'Stable release',
    releaseNotes: 'Fixes update flow\n\nKeeps user data',
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    error: null,
    lastCheckedAt: 10_000,
  });

  updater.emit('download-progress', {
    percent: 42.5,
    bytesPerSecond: 2048,
    transferred: 4096,
    total: 8192,
  });
  assert.equal(service.getState().status, UPDATE_STATUSES.DOWNLOADING);
  assert.equal(service.getState().percent, 42.5);
  assert.equal(service.getState().bytesPerSecond, 2048);

  updater.emit('update-downloaded', { version: '2.0.1' });
  assert.equal(service.getState().status, UPDATE_STATUSES.DOWNLOADED);
  assert.equal(service.getState().percent, 100);
  assert.equal(emitted.length >= 4, true);

  service.dispose();
  const emittedBeforeDisposedEvent = emitted.length;
  updater.emit('update-available', { version: '2.0.2' });
  assert.equal(emitted.length, emittedBeforeDisposedEvent);
});

test('concurrent checks share one request and cooldown returns the cached state', async () => {
  let now = 10_000;
  const pendingChecks = [];
  const { service, updater } = createService({
    now: () => now,
    checkCooldownMs: 1_000,
  });
  updater.checkImplementation = () => new Promise(resolve => pendingChecks.push(resolve));

  const first = service.checkForUpdates();
  const second = service.checkForUpdates();
  await Promise.resolve();
  assert.equal(updater.checkCalls, 1);

  pendingChecks.shift()();
  await Promise.all([first, second]);
  updater.emit('update-not-available', { version: '2.0.0' });

  now = 10_500;
  await service.checkForUpdates();
  assert.equal(updater.checkCalls, 1);

  now = 11_001;
  const third = service.checkForUpdates();
  await Promise.resolve();
  assert.equal(updater.checkCalls, 2);
  pendingChecks.shift()();
  await third;
});

test('download and install only run in the valid state order', async () => {
  const { service, updater } = createService();

  service.initialize();
  await service.downloadUpdate();
  assert.equal(updater.downloadCalls, 0);

  updater.emit('update-available', { version: '2.0.1' });
  const firstDownload = service.downloadUpdate();
  const secondDownload = service.downloadUpdate();
  await Promise.resolve();
  await Promise.all([firstDownload, secondDownload]);
  assert.equal(updater.downloadCalls, 1);
  assert.equal(updater.installCalls, 0);

  updater.emit('update-downloaded', { version: '2.0.1' });
  await service.installUpdate();
  assert.equal(updater.installCalls, 1);
});

test('failed checks enter error and can be retried without waiting for cooldown', async () => {
  let attempt = 0;
  const { service, updater } = createService({ checkCooldownMs: 60_000 });
  updater.checkImplementation = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('network unavailable');
    updater.emit('update-not-available', { version: '2.0.0' });
  };

  const first = await service.checkForUpdates();
  assert.equal(first.status, UPDATE_STATUSES.ERROR);
  assert.equal(first.error, 'network unavailable');

  const second = await service.checkForUpdates();
  assert.equal(updater.checkCalls, 2);
  assert.equal(second.status, UPDATE_STATUSES.NOT_AVAILABLE);
  assert.equal(second.error, null);
});
