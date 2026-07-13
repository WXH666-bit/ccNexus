# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run dev      # Start dev server + Electron app (hot reload)
npm run build    # Production build (main/preload/renderer)
npm run preview  # Preview production build
npm run package  # Package with electron-builder
```

## Architecture

ccNexus is an Electron + React desktop app that wraps Claude Code CLI with a GUI, adding file browsing, file preview, and Git integration.

### Three-layer Electron architecture

```
src/main/       → Electron main process (Node.js)
  index.ts          Entry: creates BrowserWindow, registers IPC handlers
  ipc-handlers.ts   All ipcMain.handle() registrations (fs, git, claude)
  fs/fs-service.ts  File tree builder + file reader
  claude/claude-process.ts  Claude Code subprocess manager
src/preload/    → contextBridge (security boundary between main & renderer)
  index.ts          Exposes window.electronAPI to renderer
  index.d.ts        TypeScript types for the API
src/renderer/   → React UI (Vite + Tailwind CSS)
  App.tsx / main.tsx
  components/layout/  AppShell, Toolbar
  components/chat/    ChatPanel, PermissionDialog
  components/files/   FileTree, FilePreview
  components/git/     GitPanel, GitStatusList, GitCommitForm, GitBranchBar
```

### IPC Data Flow

All communication between main and renderer goes through `contextBridge`:

```
Renderer: window.electronAPI.fs.getTree()
  → ipcRenderer.invoke('fs:tree')
    → ipcMain.handle('fs:tree') in ipc-handlers.ts
      → fs-service.ts → fs.readdirSync()
    ← result
  ← Promise resolves
```

Same pattern for all fs, git, and claude operations.

### Claude Code Integration

Uses `child_process.spawn` (NOT `node-pty`) — zero native dependencies:

- **Session start**: generates a UUID session ID, sets status to running
- **Each message**: spawns `claude --print "<message>" --session-id <uuid>` as a new process
- **Output**: stdout chunks are forwarded to renderer via `claude:output` IPC push events
- **Session continuity**: `--session-id` preserves conversation context across process calls

This design avoids node-pty's VS Build Tools requirement on Windows. Each message is a separate process invocation, not a long-running PTY session.

### ESM Caveat

The project uses `"type": "module"` in package.json. In main process code, `__dirname` is NOT available. Use:

```typescript
import { fileURLToPath } from 'url'
import { dirname } from 'path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
```

The preload output is `.mjs` (not `.js`) due to ESM mode — make sure `preload` path in BrowserWindow config ends with `.mjs`.
