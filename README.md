# ccNexus

ccNexus is a Windows Electron desktop client for Claude Code. Its chat, history,
project files, process management, provider settings, permissions, and usage
display are implemented in the desktop runtime and follow the ccgui patterns.

## Architecture

- `desktop/main.js` owns the Electron window and application lifecycle.
- `desktop/preload.cjs` exposes the narrow `window.ccNexusDesktop` IPC API.
- `desktop/runtime/` owns sessions, files, providers, processes, and chat control.
- `desktop/daemon/` runs the Claude Agent SDK query process.
- `src/` is the React/Vite renderer loaded by Electron; it has no Node access.
- `server/` contains shared Claude/session/protocol helpers used by the desktop runtime.
- `_ccgui/` is the local reference implementation for behavior and data flow.

There is no standalone browser UI, Express broker, or WebSocket broker. Vite is
used only as the local renderer server during Electron development.

## Requirements

- Node.js 20 or newer
- Claude Code CLI installed and authenticated
- pnpm

## Development

```bash
pnpm install
pnpm desktop:dev
```

For a renderer-only host without Electron:

```bash
pnpm desktop:host
```

## Verification and packaging

```bash
npm run build
pnpm desktop:pack
pnpm desktop:dist
```

`desktop:pack` creates an unpacked Windows application. `desktop:dist` creates
the distributable installer/output configured by electron-builder.

## Project rules

- Never write Claude Code configuration files. Runtime configuration is read-only.
- Keep the desktop IPC boundary narrow; renderer code must call preload APIs.
- When behavior is changed, inspect and follow the corresponding ccgui flow first.
