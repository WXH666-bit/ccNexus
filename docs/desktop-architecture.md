# Desktop Architecture

ccNexus is moving toward a desktop-first runtime while keeping the Web UI as the renderer layer.

- `desktop/main.js` owns the Electron app window.
- In development, the desktop host loads `CCNEXUS_WEB_URL` or `http://localhost:5000/chat`.
- In packaged mode, the desktop host loads `dist/index.html` with the `#/chat` route.
- `desktop/preload.cjs` exposes the narrow `window.ccNexusDesktop` IPC API. The UI does not get Node access.
- The preload IPC API includes runtime info, project files, local configuration, sessions, chat commands, chat events, process management, and opening a project directory through the native system dialog.
- `desktop/runtime/daemonBridge.js` mirrors ccgui's long-running daemon bridge pattern with NDJSON requests over stdin/stdout.
- `desktop/runtime/processRegistry.js` owns daemon/channel process snapshots, stop, and restart behavior.
- `desktop/runtime/chatController.js` owns the desktop chat event stream, permission prompts, active query registration, abort handling, and session persistence.
- `desktop/daemon/ccnexus-daemon.js` runs the Claude Agent SDK query process and asks the host for tool permission through the bridge.
- `server/index.js` remains available for pure browser development, but `desktop:dev` does not start it. Desktop mode uses Vite only for the retained Web UI renderer and sends app behavior through preload IPC.
- `electron-builder` is configured for Windows packaging through `desktop:pack` and `desktop:dist`.

The remaining cleanup is to keep reducing pure-browser fallback code once desktop parity is stable.
