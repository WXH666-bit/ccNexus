# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev: Vite (port 5000, HMR) + Express API (port 3456), run concurrently
npm run build    # Production build: Vite outputs to dist/
npm start        # Production: Express serves dist/ directly on PORT env (default 5000)
```

- Vite proxies `/api` and `/ws` to the Express backend in dev; in production Express handles everything.
- No test suite or linter is configured.

## Architecture

This is a **self-hosted web client for Claude Code** (recently migrated from Electron to Express + Vite). The backend wraps the `@anthropic-ai/claude-agent-sdk` `query()` function behind WebSocket; the frontend is a single-page chat UI styled after JetBrains CC GUI.

### Server (`server/index.js` — monolithic)

One file holds Express HTTP routes, WebSocket server, and all business logic:

- **SDK integration**: `sdkQuery({ prompt, options })` returns an async iterable. Events (`stream_event`, `assistant`, `user`, `result`, `tool_progress`, `system`) are forwarded as typed JSON over WebSocket.
- **Streaming**: `includePartialMessages: true` on the SDK options. `content_block_start` / `content_block_delta` events carry incremental text/thinking/input_json; the frontend accumulates them in `partialBlocksRef` and renders a streaming placeholder message.
- **Permission flow**: SDK `canUseTool` callback → `createPermissionHandler(ws)` → pending promise stored in `pendingPermissions` Map → WS `permission_request` → frontend `PermissionDialog` → WS `permission_response` → promise resolved with allow/deny. 5-minute timeout defaults to deny.
- **Session metadata**: `~/.ccnexus/sessions/_index.json` (lightweight list of `{id, title, updatedAt}`). The SDK owns conversation persistence; the backend only manages display metadata.
- **File edit + undo**: Before every `Edit`/`Write`/`MultiEdit` tool result, the backend snapshots the file's original content into `fileEditHistory[ sessionId ][ absPath ]`. `POST /api/files/undo` restores from snapshot. `undo_file` WS message does the same.
- **Provider switching**: Reads providers from `~/.cc-switch/data.db` (SQLite via sql.js) → writes `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, model aliases to `~/.claude/settings.json` env block. Model resolution chain: `ANTHROPIC_MODEL` > alias map (`ANTHROPIC_DEFAULT_SONNET_MODEL` etc.) > original model ID.
- **Session rewind**: `sessionMessages[ sessionId ]` array tracks every user + assistant message. Rewind truncates the array at a target index (both via HTTP `POST /api/sessions/:id/rewind` and WS `rewind`).
- **Path security**: `safePath()` resolves + verifies the result starts with `CWD`. All file-access endpoints use it.

### Frontend (React 19 + TypeScript 5 + Vite 6)

Three routes managed by `react-router-dom`:
- `/chat` / `/chat/:sessionId` — main chat interface (`ChatView`)
- `/history` — session list (`HistoryView`)
- `/settings` — 10-section settings panel with sidebar (`SettingsView`)

**ChatView (`src/views/ChatView.tsx`)** is the central state machine. It owns all state and dispatches based on `lastMessage.type` from the `useWebSocket` hook:

| WS message type | Effect |
|---|---|
| `stream_event` | Accumulates partial `ContentBlock` objects in `partialBlocksRef`, overwrites the last (streaming) message on every delta |
| `assistant` | Replaces streaming message with the complete message from the SDK |
| `permission` | Opens `PermissionDialog` modal |
| `tool_result` | Appends `tool_result` block to the streaming message's content |
| `result` | Finalizes streaming, clears partial state |
| `session_list`/`session_created`/`session_deleted` | Updates session state and optionally navigates |
| `plan_approval` | Opens `PlanApprovalDialog` |
| `ask_user_question` | Renders inline question card |
| `subagent_update` | Updates sub-agent status |

**Message queue**: When `isStreaming` is true, `handleSend` appends to `messageQueue` instead of sending immediately. On streaming completion, the queue auto-drains (one message per tick, 100ms delay). `ChatInputBox` passes a `queue` param to control this behavior.

**Tool blocks** (`src/components/toolBlocks/`) follow a consistent pattern: each receives a `ToolUseBlock`, renders an icon + collapsible header + expandable body. Same-type consecutive tool blocks are grouped by `AgentGroupBlock`.

**State that persists to localStorage**: `theme` (dark/light), `fontSize` (small/normal/large), `language` (zh/en), `showStatusPanel`.

### TypeScript types (`src/types.ts`)

All shared types live here: `ContentBlock` variants (text/thinking/tool_use/tool_result), `ChatMessage`, `Session`, `WSMessage` discriminated union, `StatusData`, `PermissionRequest`, plus P1 types (`SearchResult`, `MessageAnchor`, `SubAgentInfo`, `PlanApprovalRequest`, `AskUserQuestionRequest`).

### Utils

- `src/utils/markdown.ts` — marked + highlight.js, configured once at import time. `renderMarkdown()` also wraps file-like backtick references in clickable `<code class="file-link">`.
- `src/utils/diff.ts` — line-based diff stats + HTML patch rendering using the `diff` package.

### i18n (`src/i18n/`)

i18next + react-i18next. Two locales (zh as default/fallback, en). Language persisted to localStorage. Components use the `useTranslation()` hook.

### Theming (`src/index.css`)

CSS variables on `:root` and `[data-theme="light"]`. The `data-theme` attribute is set on `<html>` in `main.tsx` from localStorage. Font size is also a CSS variable (`--base-font-size`) set the same way.

## Conventions

- React functional components + hooks only (no class components).
- No implicit `any` — all event handlers and callbacks are typed.
- `highlight.js` languages are registered individually per usage site (tree-shaking).
- Server detects dev vs production via `NODE_ENV`; port logic differs accordingly.
- Scripts under `scripts/` compute `PROJECT_DIR` from `SCRIPT_DIR` — they don't depend on `pwd`.
- `path.resolve()` + `startsWith(cwd)` guard on every file-access path.
- This project uses `pnpm` for dependency management in deploy scripts (`pnpm install`, `pnpm run build`), though `npm` works locally too.
