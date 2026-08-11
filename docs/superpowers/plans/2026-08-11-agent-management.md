# Agent Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ccgui-aligned agent management to ccNexus using an app-owned `~/.ccnexus/agent.json`, while keeping Claude Code native agent files read-only and leaving Claude/cc-switch configuration untouched.

**Architecture:** Keep agent persistence in `LocalConfigService` and expose it through the existing preload → `desktopBridgeApi` → IPC boundary. Merge ccNexus-managed agents with project/global `.claude/agents/*.md` entries for display and runtime loading; only ccNexus entries are editable. Store the selected agent ID in `agent.json`, and keep prompt resolution in `server/claudeRequestContext.js` rather than in `chatController`.

**Tech Stack:** Electron IPC/preload, Node.js ESM, React + TypeScript, existing CSS/i18n, Node built-in test runner.

## Global Constraints

- Never write Claude Code `settings.json`.
- Never write, edit, rename, or delete `.claude/agents/*.md`.
- Never write cc-switch state.
- The managed store is `~/.ccnexus/agent.json` and is written atomically.
- Existing session subagent status remains separate from managed agent definitions.
- Every production behavior is preceded by a failing test and verified after implementation.

---

### Task 1: Add the managed agent store and merged runtime reader

**Files:**
- Modify: `desktop/runtime/localConfigService.js:280-294,796-847`
- Test: `tests/desktop-config-ipc.test.mjs`

**Interfaces:**
- `listAgents(cwd)` returns `{ agents, selectedAgentId }`; each item contains `id`, `name`, `description`, `source` (`ccnexus` or `claude`), `editable`, and optional `file`/`prompt`.
- `getAgent(name, cwd)` first resolves a ccNexus-managed ID and returns `{ name, content: prompt, source: 'ccnexus' }`; it falls back to the existing Claude Markdown reader and returns its file content.
- `saveAgent({ id?, name, prompt })` creates or updates only `~/.ccnexus/agent.json` and returns `{ success, agent }`.
- `deleteAgent(id)` removes only a ccNexus-managed agent and clears `selectedAgentId` when necessary.
- `setSelectedAgent(id)` persists or clears `selectedAgentId` without modifying any Claude file.
- `exportAgents()` returns a versioned JSON-safe object; `importAgents({ agents, strategy })` applies `skip`, `overwrite`, or `duplicate` only to the managed store.

- [ ] **Step 1: Write failing service tests**

  Extend `tests/desktop-config-ipc.test.mjs` with a temporary-home test that creates one native `.claude/agents/native.md`, then asserts:

  ```js
  const empty = await service.listAgents(projectCwd);
  assert.deepEqual(empty.agents, [{
    id: 'native', name: 'native', source: 'claude', editable: false,
    description: 'Native agent', file: nativeFile,
  }]);

  const saved = await service.saveAgent({ id: 'writer', name: 'Writer', prompt: 'Write carefully.' });
  assert.equal(saved.agent.source, 'ccnexus');
  assert.equal((await service.getAgent('writer', projectCwd)).content, 'Write carefully.');
  assert.equal((await service.listAgents(projectCwd)).selectedAgentId, null);

  await service.setSelectedAgent('writer');
  assert.equal((await service.listAgents(projectCwd)).selectedAgentId, 'writer');
  await service.saveAgent({ id: 'writer', name: 'Writer 2', prompt: 'Updated.' });
  assert.equal((await service.getAgent('writer', projectCwd)).content, 'Updated.');
  await service.deleteAgent('writer');
  assert.equal((await service.listAgents(projectCwd)).selectedAgentId, null);
  assert.equal(await readFile(nativeFile, 'utf8'), '---\ndescription: Native agent\n---\nNative body');
  ```

  Add assertions that `agent.json` has version `1`, stores managed agents under an object map, rejects path traversal IDs/names, and `importAgents` applies all three conflict strategies.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run: `node --test tests/desktop-config-ipc.test.mjs`

  Expected: FAIL because the managed store methods and `selectedAgentId` response do not exist yet.

- [ ] **Step 3: Implement the minimal managed store**

  Add `this.agentConfigPath = path.join(homeDir, '.ccnexus', 'agent.json')`. Reuse the existing `readJsonObject` and `writeJsonAtomic` helpers. Normalize missing/invalid files to `{ version: 1, selectedAgentId: null, agents: {} }`, validate IDs with the same safe identifier rules used for skill names, preserve `createdAt` and `id` on updates, and return native Claude entries as `editable: false`.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `node --test tests/desktop-config-ipc.test.mjs`

  Expected: PASS for the new agent persistence cases and all existing local-config cases.

- [ ] **Step 5: Commit the service layer**

  ```powershell
  git add desktop/runtime/localConfigService.js tests/desktop-config-ipc.test.mjs
  git commit -m "feat: add ccNexus agent store"
  ```

### Task 2: Expose agent management through the desktop bridge

**Files:**
- Modify: `desktop/main.js:339-342`
- Modify: `desktop/preload.cjs:30-34`
- Modify: `src/utils/desktopBridgeApi.ts:9-14,82-84`
- Modify: `src/vite-env.d.ts:121-122`
- Test: `tests/desktop-config-ipc.test.mjs`

**Interfaces:**
- Renderer calls `getAgents()`, `saveAgent(agent)`, `deleteAgent(id)`, `setSelectedAgent(id)`, `exportAgents()`, and `importAgents(payload)`.
- Main-process handlers pass workspace `cwd` only for merged native-agent reads; all managed writes stay under the service-owned home path.

- [ ] **Step 1: Add failing bridge contract assertions**

  Extend the existing source-contract test with exact handler and preload assertions for `desktop:save-agent`, `desktop:delete-agent`, `desktop:set-selected-agent`, `desktop:export-agents`, and `desktop:import-agents`, plus `desktopBridgeApi` calls for the same methods.

- [ ] **Step 2: Run the contract test and verify it fails**

  Run: `node --test tests/desktop-config-ipc.test.mjs`

  Expected: FAIL on the first missing handler assertion.

- [ ] **Step 3: Add the IPC and TypeScript bridge methods**

  Add the six methods to `preload.cjs`, register the six handlers in `main.js`, and give `desktopBridgeApi.ts`/`vite-env.d.ts` concrete managed-agent types including `source`, `editable`, `prompt`, and `selectedAgentId`.

- [ ] **Step 4: Run the bridge and type checks**

  Run: `node --test tests/desktop-config-ipc.test.mjs` and `npx.cmd tsc --noEmit`.

  Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the bridge layer**

  ```powershell
  git add desktop/main.js desktop/preload.cjs src/utils/desktopBridgeApi.ts src/vite-env.d.ts tests/desktop-config-ipc.test.mjs
  git commit -m "feat: expose agent management IPC"
  ```

### Task 3: Replace the read-only settings list with ccgui-style management UI

**Files:**
- Modify: `src/components/settings/AgentSection.tsx`
- Modify: `src/components/AgentDialog.tsx`
- Modify: `src/index.css` near the existing agent/settings dialog rules
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`
- Test: `tests/agent-management-ui.test.mjs`

**Interfaces:**
- `AgentSection` owns loading, add/edit/delete/import/export dialog state and receives the merged agent list from `getAgents()`.
- `AgentDialog` accepts `{ isOpen, agent, onClose, onSave }` and edits only `name` and `prompt`.
- Native Claude items show a read-only source badge and never render edit/delete controls.

- [ ] **Step 1: Add failing UI contract tests**

  Create `tests/agent-management-ui.test.mjs` that reads the source and asserts the settings section contains `saveAgent`, `deleteAgent`, `exportAgents`, `importAgents`, an add action, edit/delete actions, and a `source === 'claude'` read-only branch. Assert the old selection-only `AgentDialog` props are gone.

- [ ] **Step 2: Run the UI contract test and verify it fails**

  Run: `node --test tests/agent-management-ui.test.mjs`

  Expected: FAIL because the current settings section only refreshes and renders rows.

- [ ] **Step 3: Implement the minimum ccgui-aligned UI**

  Add header actions, managed/native badges, managed-item menu actions, validated name/prompt form, delete confirmation, JSON file input for import, browser download for export, loading/error states, and toast feedback. Keep the existing theme variables and provider button primitives so the panel matches the rest of ccNexus.

- [ ] **Step 4: Run UI contract and type checks**

  Run: `node --test tests/agent-management-ui.test.mjs` and `npx.cmd tsc --noEmit`.

  Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the settings UI**

  ```powershell
  git add src/components/settings/AgentSection.tsx src/components/AgentDialog.tsx src/index.css src/i18n/locales/zh.json src/i18n/locales/en.json tests/agent-management-ui.test.mjs
  git commit -m "feat: add agent management settings"
  ```

### Task 4: Persist selection and resolve prompts from the unified source

**Files:**
- Modify: `src/components/ChatInputBox/index.tsx:126-162,199-203,266-287`
- Modify: `src/components/ConfigSelect.tsx:108-115,343-367`
- Modify: `src/utils/desktopBridgeApi.ts`
- Modify: `server/claudeRequestContext.js:3-30`
- Test: `tests/agent-runtime-selection.test.mjs`

**Interfaces:**
- Selecting an agent updates React state immediately and asynchronously calls `setSelectedAgent(id)`; clearing calls `setSelectedAgent(null)`.
- `getAgents()` supplies `selectedAgentId` so a fresh renderer restores the persisted selection.
- `buildClaudeClientOptions` resolves a managed agent prompt through `loadAgent` exactly as it resolves a native Markdown agent.

- [ ] **Step 1: Add failing selection/runtime tests**

  Add source-level assertions that the input initializes from `selectedAgentId`, calls the bridge setter on selection/clear, and that `claudeRequestContext.js` accepts the returned managed `content` as `agentPrompt` without adding logic to `chatController`.

- [ ] **Step 2: Run the selection test and verify it fails**

  Run: `node --test tests/agent-runtime-selection.test.mjs`

  Expected: FAIL because selection is currently localStorage-only and the bridge result has no selected ID.

- [ ] **Step 3: Implement selection synchronization**

  Keep localStorage only as a fast renderer fallback, hydrate from the desktop result, call the persistence bridge on every explicit change, clear stale selections after a delete, and leave `chatController` responsible only for request orchestration.

- [ ] **Step 4: Run focused tests and type checks**

  Run: `node --test tests/agent-runtime-selection.test.mjs tests/desktop-config-ipc.test.mjs` and `npx.cmd tsc --noEmit`.

  Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the selection integration**

  ```powershell
  git add src/components/ChatInputBox/index.tsx src/components/ConfigSelect.tsx src/utils/desktopBridgeApi.ts server/claudeRequestContext.js tests/agent-runtime-selection.test.mjs
  git commit -m "feat: persist selected agent"
  ```

### Task 5: Verify isolation and the complete build

**Files:**
- Modify: `AGENTS.MD` only if the existing project guidance needs the new agent-store rule documented
- Test: existing test suite and `git diff --check`

**Interfaces:**
- No new runtime interface; this task verifies the end-to-end contract and records the final implementation rule.

- [ ] **Step 1: Add isolation assertions if missing**

  Extend the service test to snapshot `~/.claude/settings.json`, `.claude/agents/native.md`, and any cc-switch state fixture before CRUD operations, then assert their bytes are unchanged afterward.

- [ ] **Step 2: Run the complete verification suite**

  Run: `npm.cmd run test:protocol`, `npx.cmd tsc --noEmit`, `npm.cmd run build`, and `git diff --check`.

  Expected: all tests pass, TypeScript exits 0, the production build exits 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Inspect the final diff and runtime paths**

  Run: `git status --short`, `git diff --stat`, and `rg -n "settings\.json|cc-switch|\.claude[/\\]agents|agent\.json" desktop src tests`.

  Confirm all managed writes target only `~/.ccnexus/agent.json` and no new code writes Claude Code or cc-switch configuration.

- [ ] **Step 4: Update the project guidance if required**

  If `AGENTS.MD` has a configuration ownership section, add the exact rule: “ccNexus managed agents are stored in `~/.ccnexus/agent.json`; Claude Code `.claude/agents/*.md` are read-only compatibility sources.” Otherwise leave `AGENTS.MD` untouched.

- [ ] **Step 5: Commit final verification/documentation changes**

  ```powershell
  git add AGENTS.MD tests
  git commit -m "test: verify isolated agent management"
  ```
