function queryProcess(query) {
  if (!query || typeof query !== 'object') return null;
  for (const key of ['process', 'childProcess', 'subprocess']) {
    const candidate = query[key];
    if (candidate && typeof candidate.pid === 'number') return candidate;
  }
  return null;
}

export class DesktopProcessRegistry {
  constructor(options = {}) {
    this.provider = options.provider || 'claude';
    this.cwd = options.cwd || process.cwd();
    this.sessionDaemons = new Map();
    this.channels = new Map();
    this.nextDaemonTabIndex = 1;
  }

  setCwd(nextCwd) {
    this.cwd = nextCwd;
  }

  ensureSessionDaemon({ sessionId, title, bridge = null }) {
    if (!sessionId) return null;
    const existing = this.sessionDaemons.get(sessionId);
    if (existing) {
      if (title && !existing.title) existing.title = title;
      if (bridge && !existing.bridge) existing.bridge = bridge;
      return existing;
    }

    const processRef = bridge?.getProcessForInspection?.() || null;
    const daemon = {
      id: `daemon-${processRef?.pid || process.pid}-${sessionId}`,
      kind: 'DAEMON',
      provider: this.provider,
      pid: processRef?.pid || process.pid,
      alive: true,
      startedAt: Date.now(),
      sessionId,
      tabName: `AI${this.nextDaemonTabIndex++}`,
      title: title || '',
      command: processRef?.spawnargs?.join(' ') || process.argv.join(' '),
      bridge,
    };
    this.sessionDaemons.set(sessionId, daemon);
    return daemon;
  }

  removeSessionDaemon(sessionId) {
    if (!sessionId) return;
    this.sessionDaemons.delete(sessionId);
  }

  adoptSessionDaemon({ fromSessionId, toSessionId, title }) {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return null;
    const daemon = this.sessionDaemons.get(fromSessionId);
    if (!daemon) return this.sessionDaemons.get(toSessionId) || null;

    this.sessionDaemons.delete(fromSessionId);
    const pid = daemon.bridge?.getProcessForInspection?.()?.pid || daemon.pid;
    daemon.sessionId = toSessionId;
    daemon.id = `daemon-${pid}-${toSessionId}`;
    daemon.pid = pid;
    if (title) daemon.title = title;
    this.sessionDaemons.set(toSessionId, daemon);

    const channel = this.channels.get(fromSessionId);
    if (channel) {
      this.channels.delete(fromSessionId);
      channel.sessionId = toSessionId;
      this.channels.set(toSessionId, channel);
    }

    return daemon;
  }

  registerChannel({ sessionId, query }) {
    if (!sessionId || !query) return;
    this.channels.set(sessionId, {
      sessionId,
      query,
      processRef: queryProcess(query),
      startedAt: Date.now(),
    });
  }

  unregisterChannel({ sessionId, query }) {
    if (!sessionId) return;
    const existing = this.channels.get(sessionId);
    if (!query || existing?.query === query) {
      this.channels.delete(sessionId);
    }
  }

  buildProcessSnapshot() {
    const snapshotAt = Date.now();
    const processes = [];

    for (const [sessionId, daemon] of this.sessionDaemons.entries()) {
      const processRef = daemon.bridge?.getProcessForInspection?.() || null;
      const pid = processRef?.pid || daemon.pid;
      const uptimeMs = Math.max(0, snapshotAt - daemon.startedAt);
      processes.push({
        ...daemon,
        bridge: undefined,
        pid,
        alive: processRef ? !processRef.killed : daemon.alive,
        uptime: uptimeMs,
        uptimeMs,
        heapUsed: process.memoryUsage().heapUsed,
        activeRequestCount: daemon.bridge?.activeRequestCount ?? (this.channels.has(sessionId) ? 1 : 0),
        orphan: false,
      });
    }

    for (const [sessionId, channel] of this.channels.entries()) {
      const processRef = channel.processRef || queryProcess(channel.query);
      if (!processRef) continue;
      const uptimeMs = Math.max(0, snapshotAt - channel.startedAt);
      processes.push({
        id: `channel-${sessionId}-${processRef.pid}`,
        kind: 'CHANNEL',
        provider: this.provider,
        pid: processRef.pid,
        alive: !processRef.killed,
        sessionId,
        channelId: sessionId,
        tabName: this.sessionDaemons.get(sessionId)?.tabName,
        startedAt: channel.startedAt,
        startTime: channel.startedAt,
        uptime: uptimeMs,
        uptimeMs,
        activeRequestCount: 1,
        orphan: false,
      });
    }

    const totals = processes.reduce((acc, item) => {
      if (item.kind === 'DAEMON') acc.daemon += 1;
      if (item.kind === 'CHANNEL') acc.channel += 1;
      if (item.kind === 'ORPHAN') acc.orphan += 1;
      acc.all += 1;
      return acc;
    }, { daemon: 0, channel: 0, orphan: 0, all: 0 });

    return { snapshotAt, totals, processes };
  }

  findOwnedProcess({ pid, id }) {
    return this.buildProcessSnapshot().processes.find((item) => (
      (id ? item.id === id : true) && (pid ? item.pid === pid : true)
    )) || null;
  }

  stopProcess({ pid, id }) {
    const owned = this.findOwnedProcess({ pid, id });
    if (!owned) return { ok: false, status: 404, error: 'Process not found' };

    if (owned.kind === 'CHANNEL') {
      const channel = this.channels.get(owned.sessionId);
      const processRef = channel?.processRef || queryProcess(channel?.query);
      if (!processRef || processRef.pid !== owned.pid) {
        return { ok: false, status: 404, error: 'Process not found' };
      }
      try { channel.query?.interrupt?.(); } catch { /* ignore */ }
      try { channel.query?.close?.(); } catch { /* ignore */ }
      processRef.kill('SIGTERM');
      setTimeout(() => {
        if (!processRef.killed) processRef.kill('SIGKILL');
      }, 5000);
      this.unregisterChannel({ sessionId: owned.sessionId, query: channel.query });
      return { ok: true, success: true, pid: owned.pid, id: owned.id, kind: owned.kind };
    }

    if (owned.kind === 'DAEMON') {
      const daemon = this.sessionDaemons.get(owned.sessionId);
      const channel = this.channels.get(owned.sessionId);
      if (channel) {
        try { channel.query?.interrupt?.(); } catch { /* ignore */ }
        try { channel.query?.close?.(); } catch { /* ignore */ }
        this.unregisterChannel({ sessionId: owned.sessionId, query: channel.query });
      }
      daemon?.bridge?.shutdown?.();
      this.removeSessionDaemon(owned.sessionId);
      return { ok: true, success: true, pid: owned.pid, id: owned.id, kind: owned.kind };
    }

    return { ok: false, status: 404, error: 'Process not found' };
  }

  restartDaemon({ pid, id }) {
    const owned = this.findOwnedProcess({ pid, id });
    if (!owned || owned.kind !== 'DAEMON') {
      return { ok: false, status: 404, error: 'Daemon process not found' };
    }

    const title = owned.title || 'Restarted daemon';
    const sessionId = owned.sessionId;
    this.stopProcess({ pid: owned.pid, id: owned.id });
    const daemon = this.ensureSessionDaemon({ sessionId, title });
    return { ok: true, success: true, restart: true, pid: daemon?.pid, id: daemon?.id };
  }

  shutdown() {
    for (const daemon of this.sessionDaemons.values()) {
      daemon.bridge?.shutdown?.();
    }
    this.sessionDaemons.clear();
    this.channels.clear();
  }
}
