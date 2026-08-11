# Prompt Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a safe hybrid prompt-enhancement flow that first creates a deterministic local preview and only calls an isolated model rewrite after explicit user confirmation.

**Architecture:** Keep local enhancement as a pure renderer utility. Add a dedicated desktop prompt-enhancement service and IPC surface for the optional model call; it must not reuse the active chat session, chat controller, daemon session, tools, permissions, MCP, Agent, or project settings. Persist model usage in a ccNexus-owned ledger and merge it into usage totals without creating a synthetic Claude session.

**Tech Stack:** React 19, TypeScript, Vite, Electron IPC, Node.js ES modules, Claude Agent SDK 0.3.218, Node test runner.

## Global Constraints

- The enhancement button opens a preview and never sends automatically.
- Local enhancement must not issue a model request or consume Token.
- AI enhancement is manual-only, must show an extra-usage warning, and must return text without executing work.
- Do not modify Claude Code configuration, cc-switch configuration, settings.json, or project files.
- Do not change the active chat model, provider, mode, reasoning effort, permission flow, message history, or main-session cache chain.
- AI enhancement requests must use no tools, no file context, no Agent, no MCP, and no permission callback.
- Existing localStorage keys promptEnhancerEnabled and promptEnhancerRules remain readable.
- AI enhancement usage must be recorded separately in the ccNexus usage ledger and must not become a fake chat session.
- Preserve existing Claude usage deduplication by inner message.id for normal sessions.
- Verification commands are npm.cmd run test:protocol, npx.cmd tsc --noEmit, npm.cmd run build, and git diff --check.

---

### Task 1: Build the deterministic local enhancement core

**Files:**
- Create: src/utils/promptEnhancerCore.js
- Modify: src/utils/promptEnhancer.ts
- Test: tests/prompt-enhancer.test.mjs

**Interfaces:**
- Produces organizePromptText(text), applyPromptRules(text, rules), and createLocalPromptEnhancement(text, rules).
- createLocalPromptEnhancement accepts a string and an array of pattern, replacement, and enabled objects and returns a string.
- promptEnhancer.ts remains the browser-facing wrapper that reads localStorage and exports the existing enhancePromptText(text) compatibility function.

- [ ] **Step 1: Write failing pure-core tests**

Add Node tests that import src/utils/promptEnhancerCore.js directly:

~~~js
test('organizes a multi-part request without inventing requirements', () => {
  const result = createLocalPromptEnhancement(
    '帮我做一个好看的 HTML 页面，要科技风。',
    [],
  );
  assert.match(result, /目标：/);
  assert.match(result, /约束：/);
  assert.match(result, /HTML/);
  assert.match(result, /科技风/);
});

test('leaves short clear prompts stable', () => {
  assert.equal(createLocalPromptEnhancement('你好', []), '你好');
});

test('preserves paths, URLs, commands, and fenced code', () => {
  const source = [
    '检查 C:\\Users\\18246\\Desktop\\ccnexus-test\\sakura.html',
    '运行 npm.cmd run build',
    '参考 https://example.com/a?b=1',
    '~~~html',
    '<div class="demo">x</div>',
    '~~~',
  ].join('\\n');
  const result = createLocalPromptEnhancement(source, []);
  assert.match(result, /C:\\\\Users\\\\18246\\\\Desktop\\\\ccnexus-test\\\\sakura\\.html/);
  assert.match(result, /npm\\.cmd run build/);
  assert.match(result, /https:\\/\\/example\\.com\\/a\\?b=1/);
  assert.match(result, /<div class="demo">x<\\/div>/);
});

test('ignores invalid custom regular expressions', () => {
  assert.doesNotThrow(() => createLocalPromptEnhancement('检查项目', [
    { pattern: '[', replacement: 'broken', enabled: true },
  ]));
});
~~~

Run: node --test tests/prompt-enhancer.test.mjs

Expected: FAIL because the pure core module and its exported functions do not exist yet.

- [ ] **Step 2: Implement the pure local core**

Implement the smallest deterministic formatter:

1. Normalize CRLF and trim outer whitespace.
2. Apply enabled custom regex replacements in order; catch invalid regular expressions and keep the current text.
3. Protect fenced code blocks, inline code, URLs, Windows paths, and shell-like commands while classifying prose.
4. Classify explicit sentences containing terms such as “背景/目前/项目” as background, “要求/必须/不要/需要” as constraints, “验收/检查/确保” as acceptance, and “输出/返回/提供” as output.
5. Put unclassified content under goal.
6. Only emit section labels when at least two meaningful sections are found; otherwise return normalized text without adding headings.
7. Never create facts, paths, technologies, acceptance criteria, permission instructions, or file-operation instructions that were not in the source.

Use this public shape in src/utils/promptEnhancerCore.js:

~~~js
export function organizePromptText(text) {}
export function applyPromptRules(text, rules = []) {}
export function createLocalPromptEnhancement(text, rules = []) {
  return organizePromptText(applyPromptRules(text, rules));
}
~~~

In src/utils/promptEnhancer.ts, keep localStorage parsing and make enhancePromptText delegate to createLocalPromptEnhancement. Add createPromptEnhancementPreview(text) returning originalText, localResult, and changed.

- [ ] **Step 3: Run the pure-core tests**

Run: node --test tests/prompt-enhancer.test.mjs

Expected: PASS for short prompts, structured multi-part prompts, protected literals, and invalid rules.

- [ ] **Step 4: Commit the local core**

~~~powershell
git add src/utils/promptEnhancerCore.js src/utils/promptEnhancer.ts tests/prompt-enhancer.test.mjs
git commit -m "feat: add deterministic prompt enhancement core"
~~~

### Task 2: Add an isolated AI enhancement service

**Files:**
- Modify: server/queryOptions.js
- Create: desktop/runtime/promptEnhancementService.js
- Test: tests/prompt-enhancement-service.test.mjs
- Test: tests/query-options.test.mjs

**Interfaces:**
- Produces buildPromptEnhancementQueryOptions(args).
- Produces extractPromptEnhancementText(events).
- Produces createPromptEnhancementService({ query, localConfig, workspaceFiles, usageStore }) with enhance(args), cancel(requestId), and dispose().
- enhance accepts requestId, text, localResult, and model and returns requestId, text, model, and usage.

- [ ] **Step 1: Write failing safe-options and response-parser tests**

Add tests that verify the safe options and isolate the assistant text:

~~~js
test('prompt enhancement options disable project execution surfaces', () => {
  const options = buildPromptEnhancementQueryOptions({
    cwd: 'D:/repo',
    env: { ANTHROPIC_API_KEY: 'test' },
    providerMode: '',
    model: 'claude-sonnet-4-6',
  });
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.additionalDirectories, []);
  assert.deepEqual(options.tools, []);
  assert.equal(options.maxTurns, 1);
  assert.equal(options.enableFileCheckpointing, false);
  assert.equal(options.permissionMode, 'default');
  assert.equal(typeof options.canUseTool, 'function');
});

test('extracts only text blocks from assistant events', () => {
  const text = extractPromptEnhancementText([
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [
      { type: 'text', text: '目标：整理请求' },
      { type: 'tool_use', name: 'ignored' },
      { type: 'text', text: '约束：保留原意' },
    ] } },
  ]);
  assert.equal(text, '目标：整理请求\\n约束：保留原意');
});
~~~

Run: node --test tests/prompt-enhancement-service.test.mjs tests/query-options.test.mjs

Expected: FAIL because the safe builder and service parser do not exist.

- [ ] **Step 2: Implement safe query options**

Add buildPromptEnhancementQueryOptions beside the existing Claude query builder. Reuse the existing provider/model environment resolution and executable-path resolution, then override the execution surfaces:

~~~js
{
  cwd,
  model,
  env,
  systemPrompt: PROMPT_ENHANCER_SYSTEM_PROMPT,
  settingSources: [],
  additionalDirectories: [],
  tools: [],
  maxTurns: 1,
  enableFileCheckpointing: false,
  includePartialMessages: false,
  permissionMode: 'default',
  canUseTool: async () => ({ behavior: 'deny', message: 'Prompt enhancement cannot use tools' }),
}
~~~

The system prompt must require text-only rewriting, preservation of literals and intent, no new requirements, no execution, no tools, and no explanatory wrapper. The builder may read the currently effective provider environment but must not write any configuration.

- [ ] **Step 3: Implement the isolated service**

Create desktop/runtime/promptEnhancementService.js. Inject the SDK query function so tests do not spawn a Claude process. For each request:

1. Validate requestId, text, and localResult; reject empty text.
2. Read currentEnv and providerMode from localConfig.getProviders() and read only the workspace cwd.
3. Build the safe options from Task 2.
4. Send a delimited rewrite prompt containing the original draft and local result.
5. Iterate assistant events, collect text blocks, retain the latest complete usage payload, and reject empty output.
6. Close the short-lived query in finally.
7. Store the active query by requestId so cancel(requestId) can interrupt and close it.
8. Return usage metadata without adding a session id or chat message.

Use these signatures:

~~~js
export function extractPromptEnhancementText(events) {}
export function createPromptEnhancementService(deps) {
  return { enhance, cancel, dispose };
}
~~~

- [ ] **Step 4: Test success, failure, and cancellation**

Use a mocked async iterable to verify:

- a successful assistant text is returned;
- an empty assistant result rejects with a user-readable error;
- a rejected query is propagated without changing local results;
- cancel(requestId) calls the mocked query interrupt/close path;
- no query options contain MCP, Agent, project directories, or permission callbacks that can approve a tool.

Run: node --test tests/prompt-enhancement-service.test.mjs tests/query-options.test.mjs

Expected: PASS.

- [ ] **Step 5: Commit the isolated service**

~~~powershell
git add server/queryOptions.js desktop/runtime/promptEnhancementService.js tests/prompt-enhancement-service.test.mjs tests/query-options.test.mjs
git commit -m "feat: add isolated AI prompt enhancement service"
~~~

### Task 3: Track AI enhancement usage without creating sessions

**Files:**
- Create: desktop/runtime/promptEnhancementUsageStore.js
- Modify: desktop/runtime/sessionService.js
- Modify: desktop/main.js
- Test: tests/prompt-enhancement-usage.test.mjs
- Test: tests/desktop-usage-statistics.test.mjs

**Interfaces:**
- createPromptEnhancementUsageStore({ homeDir }) stores records in ~/.ccnexus/prompt-enhancement-usage.jsonl.
- append(record) accepts id, timestamp, cwd, model, and usage.
- list() returns valid records and ignores malformed JSONL lines.
- DesktopSessionService receives an optional promptEnhancementUsage dependency and merges records into totals, daily usage, model usage, and estimated cost.

- [ ] **Step 1: Write failing ledger tests**

Test that the store appends and reads records, ignores malformed lines, and keeps records outside Claude's history:

~~~js
const record = {
  id: 'enhance-1',
  timestamp: Date.parse('2026-08-12T10:00:00+08:00'),
  cwd: 'D:/repo',
  model: 'claude-sonnet-4-6',
  usage: {
    input_tokens: 100,
    output_tokens: 40,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
};
await store.append(record);
assert.deepEqual(await store.list(), [record]);
~~~

Add a usage-statistics fixture that has one normal Claude assistant usage record and one prompt-enhancement record. Assert that totals include both, sessions contains only the real Claude session, daily request count includes both requests, and malformed ledger entries do not affect totals.

Run: node --test tests/prompt-enhancement-usage.test.mjs tests/desktop-usage-statistics.test.mjs

Expected: FAIL because the store and merge path do not exist.

- [ ] **Step 2: Implement the ccNexus-owned usage store**

Use fs/promises, create the parent directory on append, write one JSON object per line, normalize only the record shape, and skip invalid lines during reads. Never place records below .claude, the project directory, or any cc-switch file.

- [ ] **Step 3: Merge ledger records in DesktopSessionService**

After normal Claude JSONL aggregation, load ledger records and filter them using the existing local-day cutoff and scope:

- scope current includes records whose normalized cwd equals this.cwd.
- scope all includes all valid records.
- today, 7d, 30d, and all use the same local-day boundaries as Claude records.

Add these response fields without changing existing meanings:

~~~js
{
  promptEnhancementCount: number,
  promptEnhancementUsage: UsageTotals,
  promptEnhancementCost: number,
}
~~~

Merge enhancement usage into totalUsage, dailyUsage, byModel, and estimated cost. Do not append synthetic entries to sessions, do not increment session counts, and do not modify Claude history files.

- [ ] **Step 4: Wire the store into application startup**

Instantiate the store from the same app-data root used by the desktop session service, pass it to both the prompt-enhancement service and DesktopSessionService, and flush/close no process-specific resources during application cleanup because appends are atomic file operations.

- [ ] **Step 5: Run ledger and usage tests**

Run: node --test tests/prompt-enhancement-usage.test.mjs tests/desktop-usage-statistics.test.mjs

Expected: PASS, with exact totals for normal Claude usage plus the separate enhancement fields.

- [ ] **Step 6: Commit usage accounting**

~~~powershell
git add desktop/runtime/promptEnhancementUsageStore.js desktop/runtime/sessionService.js desktop/main.js tests/prompt-enhancement-usage.test.mjs tests/desktop-usage-statistics.test.mjs
git commit -m "feat: account for prompt enhancement usage separately"
~~~

### Task 4: Expose the enhancement service through the desktop bridge

**Files:**
- Modify: desktop/main.js
- Modify: desktop/preload.cjs
- Modify: src/utils/desktopBridgeApi.ts
- Modify: src/vite-env.d.ts
- Test: tests/desktop-prompt-enhancement-ipc.test.mjs

**Interfaces:**
- Renderer method: enhancePrompt(args).
- Renderer method: cancelPromptEnhancement(requestId).
- enhancePrompt returns requestId, text, model, and usage.
- cancelPromptEnhancement returns cancelled and requestId.

- [ ] **Step 1: Write failing IPC contract tests**

Assert that:

- desktop/main.js registers desktop:enhance-prompt and desktop:cancel-prompt-enhancement;
- desktop/preload.cjs exposes both methods through contextBridge;
- src/vite-env.d.ts contains the exact argument and result shapes;
- src/utils/desktopBridgeApi.ts calls requireDesktopApi() and does not use fetch;
- the main handlers call the dedicated prompt-enhancement service and never call chatController.handle.

Run: node --test tests/desktop-prompt-enhancement-ipc.test.mjs

Expected: FAIL until the bridge is wired.

- [ ] **Step 2: Add main-process handlers**

Register:

~~~js
ipcMain.handle('desktop:enhance-prompt', async (_event, args = {}) => (
  promptEnhancementService.enhance(args)
));

ipcMain.handle('desktop:cancel-prompt-enhancement', async (_event, args = {}) => (
  promptEnhancementService.cancel(args.requestId)
));
~~~

Ensure the service is disposed in cleanupApplication.

- [ ] **Step 3: Add preload, typed bridge, and renderer wrapper**

Expose IPC calls in desktop/preload.cjs, add PromptEnhancementUsage and PromptEnhancementResult types to src/vite-env.d.ts, and add typed wrappers in src/utils/desktopBridgeApi.ts.

- [ ] **Step 4: Run IPC tests**

Run: node --test tests/desktop-prompt-enhancement-ipc.test.mjs

Expected: PASS.

- [ ] **Step 5: Commit the bridge**

~~~powershell
git add desktop/main.js desktop/preload.cjs src/utils/desktopBridgeApi.ts src/vite-env.d.ts tests/desktop-prompt-enhancement-ipc.test.mjs
git commit -m "feat: expose prompt enhancement over desktop bridge"
~~~

### Task 5: Add the preview dialog and connect ChatInputBox

**Files:**
- Create: src/components/ChatInputBox/PromptEnhanceDialog.tsx
- Modify: src/components/ChatInputBox/index.tsx
- Modify: src/components/ChatInputBox/ButtonArea.tsx
- Modify: src/index.css
- Modify: src/i18n/locales/zh.json
- Modify: src/i18n/locales/en.json
- Test: tests/prompt-enhancement-ui.test.mjs

**Interfaces:**
- PromptEnhanceDialog receives originalText, localResult, aiResult, aiStatus, and aiError.
- It emits onUse(text), onCancel(), onRestore(), onAiEnhance(), and onCancelAi().
- ChatInputBox owns originalText, localResult, aiResult, aiStatus, aiError, and requestId.
- ButtonArea receives a separate hasPromptText boolean; attachments alone keep Send enabled but keep prompt enhancement disabled.

- [ ] **Step 1: Write failing renderer contract tests**

Assert that the dialog has controls for local use, AI enhancement, restore, cancel, loading, and error fallback. Assert that ChatInputBox calls the local preview function, renders the dialog, calls the bridge only from the explicit AI action, and does not call submit from any enhancement handler.

Run: node --test tests/prompt-enhancement-ui.test.mjs

Expected: FAIL because the dialog and state machine do not exist.

- [ ] **Step 2: Implement the dialog**

Create a theme-aware modal/panel with:

- original text preview;
- local enhancement preview;
- optional AI result preview;
- primary use-this-result action;
- AI-polish action with extra-usage text;
- restore-original and cancel actions;
- loading state with disabled duplicate actions;
- error state that keeps local result usable.

Use existing CSS variables, modal styles, lucide icons, and i18n keys. Do not introduce a second provider/model selector.

- [ ] **Step 3: Connect ChatInputBox state**

Change the sparkle handler from direct replacement to:

~~~ts
const openPromptEnhancer = useCallback(() => {
  const originalText = getEditorText().trim();
  if (!originalText || isStreaming) return;
  setPromptEnhancement({
    originalText,
    localResult: createPromptEnhancementPreview(originalText).localResult,
    aiResult: '',
    aiStatus: 'idle',
    aiError: '',
  });
}, [getEditorText, isStreaming]);
~~~

On local use or AI use, update only the draft via setText and close the dialog. Do not call submit. Generate a requestId for AI calls, call enhancePrompt only from onAiEnhance, and call cancelPromptEnhancement when the dialog closes during loading. Pass text.trim() as hasPromptText to ButtonArea so an image-only draft cannot open the enhancer.

Close/cancel preview state when sessionKey changes or a stream starts. Preserve attachments unchanged.

- [ ] **Step 4: Keep ButtonArea as a trigger-only component**

Retain onEnhancePrompt as a callback prop, keep the existing disabled conditions, and add an accessible localized title. Do not place local or AI enhancement logic in ButtonArea.

- [ ] **Step 5: Add theme-aware styles and translations**

Add compact preview layout, readable text areas, loading/error states, focus styles, and light/dark variable usage to src/index.css. Add zh/en keys for title, original, local result, AI result, use result, restore, cancel, AI extra-usage warning, loading, and failure fallback.

- [ ] **Step 6: Run renderer contract tests and typecheck**

Run:

~~~powershell
node --test tests/prompt-enhancement-ui.test.mjs
npx.cmd tsc --noEmit
~~~

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit the renderer flow**

~~~powershell
git add src/components/ChatInputBox/PromptEnhanceDialog.tsx src/components/ChatInputBox/index.tsx src/components/ChatInputBox/ButtonArea.tsx src/index.css src/i18n/locales/zh.json src/i18n/locales/en.json tests/prompt-enhancement-ui.test.mjs
git commit -m "feat: add prompt enhancement preview flow"
~~~

### Task 6: Make the settings page describe the real behavior

**Files:**
- Modify: src/components/settings/PromptEnhancerSection.tsx
- Modify: src/index.css
- Modify: src/i18n/locales/zh.json
- Modify: src/i18n/locales/en.json
- Test: tests/prompt-enhancement-settings.test.mjs

**Interfaces:**
- Existing localStorage keys remain unchanged.
- Settings only manage custom local rules; AI polishing remains an explicit action in the preview dialog.

- [ ] **Step 1: Write failing settings tests**

Assert that the settings page:

- labels the switch as custom local rules rather than automatic AI rewriting;
- explains that local rules do not call the model;
- explains that AI polishing is manual and consumes extra Token;
- keeps add, edit, enable/disable, and delete rule controls;
- removes the old onBlur test textarea and console logging.

Run: node --test tests/prompt-enhancement-settings.test.mjs

Expected: FAIL until the copy and dead test UI are corrected.

- [ ] **Step 2: Update the settings component and copy**

Remove the optional onEnhance test prop and test textarea. Keep the existing localStorage schema and rule editor, add localized explanatory copy, and use the same theme-aware controls as the rest of SettingsView.

- [ ] **Step 3: Run settings tests**

Run: node --test tests/prompt-enhancement-settings.test.mjs

Expected: PASS.

- [ ] **Step 4: Commit settings clarification**

~~~powershell
git add src/components/settings/PromptEnhancerSection.tsx src/index.css src/i18n/locales/zh.json src/i18n/locales/en.json tests/prompt-enhancement-settings.test.mjs
git commit -m "fix: clarify prompt enhancement settings"
~~~

### Task 7: Run full verification and manually validate the desktop app

**Files:**
- Test: tests/prompt-enhancer.test.mjs
- Test: tests/prompt-enhancement-service.test.mjs
- Test: tests/prompt-enhancement-usage.test.mjs
- Test: tests/desktop-prompt-enhancement-ipc.test.mjs
- Test: tests/prompt-enhancement-ui.test.mjs
- Test: tests/prompt-enhancement-settings.test.mjs

- [ ] **Step 1: Run targeted prompt-enhancement tests**

Run:

~~~powershell
node --test tests/prompt-enhancer.test.mjs tests/prompt-enhancement-service.test.mjs tests/prompt-enhancement-usage.test.mjs tests/desktop-prompt-enhancement-ipc.test.mjs tests/prompt-enhancement-ui.test.mjs tests/prompt-enhancement-settings.test.mjs
~~~

Expected: all targeted tests pass.

- [ ] **Step 2: Run the existing regression suite**

Run: npm.cmd run test:protocol

Expected: all existing tests pass; no normal chat, permission, usage, provider, MCP, skills, or packaging regression.

- [ ] **Step 3: Run typecheck, build, and whitespace checks**

Run:

~~~powershell
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
~~~

Expected: typecheck and Vite build exit 0; git diff --check prints no errors.

- [ ] **Step 4: Manually validate the packaged-equivalent desktop flow**

Run npm.cmd run desktop:dev, then verify:

1. Enter a multi-part prompt and click the sparkle button.
2. Confirm the local preview opens immediately and no chat message is sent.
3. Restore the original, reopen, and use the local result.
4. Open the preview again and explicitly click AI polish.
5. Confirm the AI request shows loading, returns only text, and does not open a permission dialog or change the selected mode/model/provider.
6. Cancel during loading and confirm the input draft remains unchanged.
7. Force an AI failure and confirm the local result remains usable.
8. Open Usage and verify the enhancement count/cost is separate, while normal session count and chat history remain unchanged.
9. Repeat in both dark and light themes.

- [ ] **Step 5: Record final verification notes**

~~~powershell
git status --short
git log -6 --oneline
~~~

Record the test commands and manual results in the final handoff. Do not create a commit from this step and do not build or publish an installer unless the user separately requests a release.
