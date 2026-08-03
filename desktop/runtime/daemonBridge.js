import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

function isBrokenPipeError(error) {
  return error?.code === 'EPIPE'
    || error?.code === 'ERR_STREAM_DESTROYED'
    || /EPIPE|closed|destroyed/i.test(error?.message || '');
}

export class DaemonBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.nodePath = options.nodePath || process.execPath;
    this.daemonScript = options.daemonScript;
    this.cwd = options.cwd || process.cwd();
    const electronNodeEnv = options.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {};
    this.env = { ...process.env, ...electronNodeEnv, ...(options.env || {}) };
    this.provider = options.provider || 'claude';

    this.daemonProcess = null;
    this.pendingRequests = new Map();
    this.activeRequestCount = 0;
    this.requestIdCounter = 0;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  start() {
    if (this.daemonProcess && !this.daemonProcess.killed) return this.readyPromise || Promise.resolve();
    if (!this.daemonScript) throw new Error('Daemon script path is required');

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.daemonProcess = spawn(this.nodePath, [this.daemonScript], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout = createInterface({ input: this.daemonProcess.stdout });
    stdout.on('line', (line) => this.handleLine(line));

    this.daemonProcess.stdin.on('error', (error) => {
      this.handlePipeError(error);
    });

    this.daemonProcess.stderr.on('data', (chunk) => {
      this.emit('stderr', chunk.toString());
    });

    this.daemonProcess.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.readyReject?.(new Error(`Daemon exited with code ${code ?? signal}`));
      this.readyResolve = null;
      this.readyReject = null;
      this.failPendingRequests(new Error(`Daemon exited with code ${code ?? signal}`));
      this.daemonProcess = null;
    });

    return this.readyPromise;
  }

  failPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      if (pending.reject) pending.reject(error);
      else pending.onExit?.(error);
    }
    this.pendingRequests.clear();
    this.activeRequestCount = 0;
  }

  handlePipeError(error) {
    const pipeError = error instanceof Error ? error : new Error(String(error || 'Daemon pipe closed'));
    this.readyReject?.(pipeError);
    this.readyResolve = null;
    this.readyReject = null;
    this.failPendingRequests(pipeError);
    if (!isBrokenPipeError(pipeError)) {
      this.emit('stdin_error', pipeError);
    }
    return isBrokenPipeError(pipeError);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit('line', line);
      return;
    }

    if (message.type === 'daemon' && message.event === 'ready') {
      this.readyResolve?.(message);
      return;
    }

    if (message.id && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending.onMessage) {
        pending.onMessage(message);
        if (message.done) {
          this.pendingRequests.delete(message.id);
          if (pending.countsAsActive) this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
        }
        return;
      }
      pending.messages.push(message);
      if (message.done) {
        this.pendingRequests.delete(message.id);
        if (pending.countsAsActive) this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
        if (message.success === false) {
          pending.reject(new Error(message.error || 'Daemon command failed'));
        } else {
          pending.resolve(pending.messages);
        }
      }
      return;
    }

    this.emit('message', message);
  }

  writeCommand(command) {
    if (!this.daemonProcess || this.daemonProcess.killed) {
      throw new Error('Daemon is not running');
    }
    if (this.daemonProcess.stdin.destroyed || this.daemonProcess.stdin.writableEnded) {
      this.handlePipeError(Object.assign(new Error('Daemon pipe closed'), { code: 'EPIPE' }));
      return false;
    }
    try {
      this.daemonProcess.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) this.handlePipeError(error);
      });
      return true;
    } catch (error) {
      if (this.handlePipeError(error)) return false;
      throw error;
    }
  }

  async sendCommand(method, params = {}, options = {}) {
    await this.start();
    const id = `req-${++this.requestIdCounter}`;
    const countsAsActive = options.countsAsActive ?? !['heartbeat', 'status', 'shutdown'].includes(method);
    if (countsAsActive) this.activeRequestCount += 1;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, messages: [], countsAsActive });
      if (!this.writeCommand({ id, method, params })) {
        this.pendingRequests.delete(id);
        if (countsAsActive) this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
        reject(new Error('Daemon pipe closed'));
      }
    });
  }

  async streamCommand(method, params = {}, options = {}) {
    await this.start();
    const id = `req-${++this.requestIdCounter}`;
    const countsAsActive = options.countsAsActive ?? true;
    if (countsAsActive) this.activeRequestCount += 1;

    const queue = [];
    const waiters = [];
    let finished = false;
    let failure = null;

    const push = (value) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
      } else {
        queue.push(value);
      }
    };

    const finish = (err = null) => {
      finished = true;
      failure = err;
      while (waiters.length) {
        const waiter = waiters.shift();
        if (failure) waiter.reject(failure);
        else waiter.resolve({ value: undefined, done: true });
      }
    };

    const onMessage = (message) => {
      if (message.type === 'permission_request') {
        Promise.resolve(options.onPermissionRequest?.(message))
          .then((decision) => {
            const command = { method: 'permission_response' };
            this.writeCommand({
              method: command.method,
              params: {
                requestId: message.requestId,
                decision: decision || { behavior: 'deny', message: 'No permission handler available' },
              },
            });
          })
          .catch((err) => {
            this.writeCommand({
              method: 'permission_response',
              params: {
                requestId: message.requestId,
                decision: { behavior: 'deny', message: err.message },
              },
            });
          });
        return;
      }

      if (message.done) {
        finish(message.success === false ? new Error(message.error || 'Daemon command failed') : null);
        return;
      }

      if (message.type === 'sdk_event') {
        push(message.event);
        return;
      }

      push(message);
    };

    this.pendingRequests.set(id, { onMessage, onExit: finish, countsAsActive });
    if (!this.writeCommand({ id, method, params })) {
      this.pendingRequests.delete(id);
      if (countsAsActive) this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
      throw new Error('Daemon pipe closed');
    }

    return {
      requestId: id,
      interrupt: () => this.abort(id),
      close: () => this.abort(id),
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (failure) return Promise.reject(failure);
            if (finished) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
          },
        };
      },
    };
  }

  heartbeat() {
    const command = { method: 'heartbeat' };
    return this.sendCommand(command.method, {}, { countsAsActive: false });
  }

  status() {
    return this.sendCommand('status', {}, { countsAsActive: false });
  }

  async getContextUsage(options = {}) {
    const messages = await this.sendCommand('context_usage', { options });
    const response = messages[messages.length - 1];
    if (!response || response.result === undefined) {
      throw new Error('Context usage response was empty');
    }
    return response.result;
  }

  abort(requestId) {
    return this.sendCommand('abort', { requestId }, { countsAsActive: false });
  }

  async shutdown() {
    if (!this.daemonProcess) return;
    try {
      const command = { method: 'shutdown' };
      await this.sendCommand(command.method, {}, { countsAsActive: false });
    } catch {
      // The process may already be gone.
    }
    if (this.daemonProcess && !this.daemonProcess.killed) {
      this.daemonProcess.kill('SIGTERM');
    }
  }

  getProcessForInspection() {
    return this.daemonProcess;
  }
}
