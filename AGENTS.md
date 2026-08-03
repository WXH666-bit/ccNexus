# ccNexus Agent Rules

## Architecture

- ccNexus is a desktop-first Electron application. React is the renderer UI; Claude Code SDK processes, session daemons, and persistence belong to the desktop runtime.
- Keep the local Web UI only as the renderer surface needed by Electron. Do not expand the old Web broker architecture.
- Before changing Claude runtime behavior, inspect and follow the matching implementation under `_ccgui/ccgui-src`.
- Prefer ccgui's persistent-query, runtime lifecycle, per-session ownership, request-context, and usage handling patterns over new custom behavior.
- The renderer's `/context` command must use the desktop IPC path to the session daemon and Claude SDK `query.getContextUsage()`; never recreate the category breakdown with percentages guessed in React.
- Keep session history authoritative to the current workspace's Claude JSONL when it exists; use ccNexus-owned cache only when Claude history is absent or unreadable.
- Keep history search, selection, batch deletion, favorites, export, and rename scoped to the active workspace. Stale session responses must not mutate the active chat.
- Keep the chat input aligned with ccgui: persist bounded local input history, restore the draft when navigating with ArrowUp/ArrowDown, and handle `/new`, `/clear`, `/reset`, `/resume`, `/continue`, and `/plan` as local commands before sending a prompt.
- Node process management should follow ccgui's live snapshot behavior: refresh while the submenu is open, confirm daemon/channel termination or restart, and allow orphan cleanup directly.
- Keep the bottom status panel aligned with ccgui: one tabbed popover anchored above the full status bar, structured task/subagent/file rows, outside-click dismissal, and file actions scoped to the active workspace session.

## Claude Configuration Safety

- Never modify Claude Code configuration files.
- Tests and diagnostics may read configuration and project MCP state, but must not write settings, provider files, credentials, or Claude project configuration.
- Diagnostic files must be temporary, outside Claude configuration paths, and removed before finishing.

## Cache And Usage Rules

- Claude context occupancy is calculated from the authoritative assistant usage payload:
  `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- A `result.usage` payload may aggregate several API calls inside one tool loop. It is not a single context snapshot and must not replace assistant-message usage in the context bar.
- `extractUsageFromSdkEvent` therefore accepts only `assistant.message.usage`, matching ccgui's `emitUsageTag` source of truth.
- Cache hit rate is a separate metric. Use `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)` for a Claude request; do not confuse it with context occupancy.
- A warm persistent session should normally report approximately 97% to 99% cache reads in stable short or tool turns. A cold session or an expired provider-side cache can have a lower first request.
- Keep the 1M context suffix and inline settings override behavior aligned with ccgui. `[1m]` changes the runtime identity and must not be silently applied to an already-spawned incompatible runtime.
- The `/context` dialog's `totalTokens`, model limit, category grid, MCP tools, agents, memory files, skills, and autocompact state must be passed through from SDK `getContextUsage()` without synthetic category allocation.

## Desktop Diagnostics

- When diagnosing cache behavior, record the assistant usage fields from Claude JSONL and compare them with the visible context bar.
- Test at least one short turn and one read/write/tool turn. Confirm that tool-loop aggregation does not inflate the context percentage.
- If the desktop app is operated through Computer Use, minimize it after verification. Minimize PyCharm or ccgui as well if either was opened.

## Verification

Run focused tests first, then the desktop and build checks:

```powershell
node tests\context-usage.test.mjs
node tests\claude-history.test.mjs
node tests\assistant-turn.test.mjs
node tests\chat-protocol.test.mjs
node tests\desktop-chat-ipc.test.mjs
node tests\desktop-session-ipc.test.mjs
node tests\desktop-config-ipc.test.mjs
node tests\desktop-usage-statistics.test.mjs
node tests\model-resolution.test.mjs
node tests\query-options.test.mjs
npm.cmd run test:protocol
npx.cmd tsc --noEmit
npm.cmd run build
```

Do not claim a fix without reporting any verification command that could not be run.
