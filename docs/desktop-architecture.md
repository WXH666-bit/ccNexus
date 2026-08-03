# Desktop Architecture

ccNexus is a desktop-only Electron application. The React/Vite code remains as
the renderer implementation, but it is loaded and controlled by Electron rather
than exposed as a standalone web product.

- `desktop/main.js` owns the Electron window and application lifecycle.
- During development, Electron loads `http://127.0.0.1:5000/chat` from the local
  Vite renderer server. Packaged builds load `dist/index.html`.
- `desktop/preload.cjs` exposes the narrow `window.ccNexusDesktop` IPC API. The
  renderer does not receive Node access and does not call HTTP endpoints.
- The preload API covers runtime information, project files, read-only local
  configuration, sessions, chat commands/events, process management, and native
  project-directory selection.
- `desktop/runtime/daemonBridge.js` follows ccgui's long-running daemon bridge
  pattern with NDJSON requests over stdin/stdout.
- `desktop/runtime/processRegistry.js` owns daemon/channel process snapshots,
  stop, and restart behavior.
- `desktop/runtime/chatController.js` owns chat events, permission prompts,
  active query registration, abort handling, and session persistence.
- `desktop/daemon/ccnexus-daemon.js` runs the Claude Agent SDK query process and
  asks the host for tool permission through the bridge.
- `server/` contains shared Claude/session/protocol helpers needed by the
  desktop runtime. It is not a web server entry point.
- `electron-builder` packages the app through `desktop:pack` and `desktop:dist`.

All renderer capabilities go through preload IPC. There is no browser fallback,
Express broker, WebSocket broker, or standalone web runtime.
