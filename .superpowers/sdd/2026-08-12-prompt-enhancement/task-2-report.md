# Task 2 Report

## Changed files

- `server/queryOptions.js`
  - Added `buildPromptEnhancementQueryOptions(...)`.
  - Reused the existing model/env/executable resolution path while forcing the safe isolated contract:
    - `settingSources: []`
    - `additionalDirectories: []`
    - `tools: []`
    - `maxTurns: 1`
    - `enableFileCheckpointing: false`
    - `includePartialMessages: false`
    - `permissionMode: 'default'`
    - `canUseTool` always returns a deny response
  - Added a dedicated text-only prompt-enhancer system prompt that forbids tools, execution, new requirements, and explanatory wrappers.

- `desktop/runtime/promptEnhancementService.js`
  - Added:
    - `extractPromptEnhancementText(events)`
    - `createPromptEnhancementService({ query, localConfig, workspaceFiles, usageStore })`
  - Implemented:
    - request validation for `requestId`, `text`, and `localResult`
    - provider env lookup through `localConfig.getProviders()`
    - workspace cwd lookup through `workspaceFiles.getWorkspace()`
    - injected short-lived query execution
    - assistant text extraction and latest usage capture
    - readable empty-input / empty-output / cancellation errors
    - request-scoped cancellation and disposal without session/chat mutation
  - Kept the enhancer isolated from the main chat controller/session flow and returned only `{ requestId, text, model, usage }`.

- `tests/query-options.test.mjs`
  - Added coverage for the prompt-enhancement safe query options contract.

- `tests/prompt-enhancement-service.test.mjs`
  - Added coverage for:
    - assistant text extraction
    - successful enhancement result + usage capture
    - empty input rejection
    - empty output rejection
    - propagated query failure
    - cancellation
    - service disposal across multiple in-flight requests

## Focused test command

Command:

```powershell
node --test tests/prompt-enhancement-service.test.mjs tests/query-options.test.mjs
```

Final output:

```text
✔ extracts only text blocks from assistant events
✔ returns enhanced prompt text and latest usage from a short-lived query
✔ rejects empty input before spawning a query
✔ rejects empty assistant output with a readable error and no local-result mutation
✔ propagates query failures without mutating the local result
✔ cancel interrupts and closes the active short-lived query
✔ dispose closes every in-flight prompt enhancement query
✔ packaged Windows query points the SDK at the unpacked Claude binary
✔ builds ccgui-style SDK options from client dialogue controls
✔ auto is a valid SDK permission mode without dangerous bypass
✔ bypassPermissions remains the only dangerous launch mode
✔ omits default model and disables partial messages when streaming is false
✔ does not send reasoning effort when the thinking toggle is off
✔ preserves ccgui long context marker before passing model to SDK
✔ resolves ccgui provider model mapping before passing model to SDK
✔ strips stale provider mapping suffix when the 1M toggle is off
✔ role-specific provider mapping beats the default fallback model
✔ Fable follows ccgui main model fallback instead of a private fable mapping
✔ includes ccgui cache-critical Claude Code preset and settings override
✔ disables 1M context through ccgui inline settings when long context is off
✔ uses ccgui SDK model selector and request-scoped model routing env
✔ keeps ccgui cache prefix inputs stable in the SDK options
✔ includes ccgui agent instructions in the stable system prompt append
✔ builds one ccgui-style request context from agent and MCP state
✔ prompt enhancement options disable project execution surfaces

tests 25
pass 25
fail 0
```

## Commit

- Commit SHA: `7397f3b3cd6803838c01ce369e6c49741d95dc68`
- Commit message: `feat: add isolated AI prompt enhancement service`

## Concerns / follow-up notes

- The new service is implemented and tested in isolation, as requested, but it is not wired into desktop IPC/chat UI flows in this task.
- The service intentionally does not persist chat/session artifacts, does not return a session id, and does not mutate Claude/cc-switch/project configuration.
- Git reported only LF→CRLF working-tree normalization warnings on commit; no additional files were changed.

## Fix Round 1

### Review finding addressed

- `desktop/runtime/promptEnhancementService.js`
  - Fixed `extractPromptEnhancementText(events)` so it now accumulates text blocks from assistant events in order across the full event stream.
  - It still ignores non-assistant events and non-text blocks such as `tool_use`.
  - This closes the truncation bug where the previous implementation replaced accumulated text with only the most recent assistant event.

- `tests/prompt-enhancement-service.test.mjs`
  - Updated the success-path regression so the assistant reply is split across separate assistant events:
    - first event: `Rewrite the request with the same intent.`
    - second event: `Keep error handling and examples.`
  - The assertion now requires both parts to be returned in order.
  - Existing success/error/cancel/disposal coverage was preserved.

### TDD evidence

Red command:

```powershell
node --test tests/prompt-enhancement-service.test.mjs tests/query-options.test.mjs
```

Observed failure before the fix:

```text
actual: 'Keep error handling and examples.'
expected: 'Rewrite the request with the same intent.\n\nKeep error handling and examples.'
```

Green command:

```powershell
node --test tests/prompt-enhancement-service.test.mjs tests/query-options.test.mjs
```

Green result:

```text
tests 25
pass 25
fail 0
```

### Concerns

- No scope expansion was added: the service still uses the injected query function and mock-driven tests rather than real SDK integration.
