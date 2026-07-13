# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run dev      # dev server + Electron (hot reload)
npm run build    # production build
```

## Architecture

ccNexus is an Electron + React desktop GUI wrapper for Claude Code CLI, with file browsing, preview, and Git integration.

### Layers

```
src/main/       → Electron main process (Node.js) — IPC handlers, services
src/preload/    → contextBridge — security boundary
src/renderer/   → React + Vite + Tailwind CSS + Zustand
```

### Claude Code Integration

- Uses `child_process.spawn` (NOT `node-pty`) — zero native deps
- Each user message spawns `claude --print "<msg>" --session-id <uuid> --verbose`
- Session continuity via `--session-id`, creates new UUID per session
- Configurable Claude binary path stored in `~/.ccNexus/config.json`
- Settings read/write from `~/.claude/settings.json`

### Key Files

| File | Purpose |
|------|---------|
| `src/main/ipc-handlers.ts` | All IPC registrations (claude, fs, git, settings, dialog) |
| `src/main/claude/claude-process.ts` | Claude Code spawn + output parsing |
| `src/main/claude/session-store.ts` | Session persistence to `~/.ccNexus/sessions.json` |
| `src/main/claude/config-store.ts` | ccNexus config + Claude settings I/O |
| `src/main/fs/fs-service.ts` | File tree builder (recursive, skips node_modules/.git) |
| `src/preload/index.ts` | `contextBridge.exposeInMainWorld('electronAPI', ...)` |
| `src/renderer/App.tsx` | Root: WelcomeScreen until project selected, then AppShell |
| `src/renderer/components/layout/AppShell.tsx` | Main layout: Toolbar + sidebar + chat + git |
| `src/renderer/components/chat/ChatPanel.tsx` | Chat messages + input + model/permission selectors + attachments |
| `src/renderer/stores/ui-store.ts` | Font size state (Zustand, persisted to localStorage) |

### Data Flow

```
Renderer: window.electronAPI.fs.getTree(projectPath)
  → ipcRenderer.invoke('fs:tree')
    → ipcMain.handle('fs:tree') in ipc-handlers.ts
      → fs-service.ts
    ← result
  ← Promise
```

Same request-response pattern for all IPC. Push events (e.g., `claude:output`) use `webContents.send()` → `ipcRenderer.on()`.

### ESM

`package.json` has `"type": "module"`. In main process, `__dirname` is not available — use:

```ts
import { fileURLToPath } from 'url'
import { dirname } from 'path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
```

Preload output is `.mjs` — BrowserWindow preload path must end with `.mjs`.
