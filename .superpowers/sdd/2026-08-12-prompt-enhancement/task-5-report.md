# Task 5 Report

Date: 2026-08-11

## Summary

Implemented the prompt enhancement preview flow in the requested renderer files. The sparkle trigger now opens a deterministic local preview dialog instead of mutating the draft or sending the message. AI enhancement starts only from the dialog, uses bridge wrappers from Task 4, tracks request IDs, ignores stale results, supports cancellation, and keeps the local preview usable after AI failure.

## Files Changed

- `src/components/ChatInputBox/PromptEnhanceDialog.tsx`
- `src/components/ChatInputBox/index.tsx`
- `src/components/ChatInputBox/ButtonArea.tsx`
- `src/index.css`
- `src/i18n/locales/zh.json`
- `src/i18n/locales/en.json`
- `tests/prompt-enhancement-ui.test.mjs`

## Behavior Delivered

- Sparkle/enhance is trigger-only and no longer submits or rewrites the draft directly.
- `ChatInputBox` now creates a local deterministic preview with `createPromptEnhancementPreview`.
- The dialog shows:
  - original draft,
  - local preview,
  - optional AI result,
  - use / restore / cancel actions,
  - AI loading and error states,
  - AI cancel action.
- `onUse` only updates the draft via `setText(...)` and closes the dialog.
- `onRestore` restores the original draft and closes the dialog.
- `onCancel` closes without changing the draft.
- AI enhancement:
  - starts only from `onAiEnhance`,
  - generates a request ID per request,
  - calls `enhancePrompt(...)` once per request,
  - calls `cancelPromptEnhancement(...)` on explicit cancel or dialog close during loading,
  - ignores stale results by comparing `requestId`.
- The dialog is closed and active AI work is cancelled when `sessionKey` changes or streaming starts.
- `ButtonArea` now receives both:
  - `hasInputContent` for send/queue behavior,
  - `hasPromptText` for prompt enhancement availability.
- Image-only drafts still keep Send enabled while prompt enhancement stays disabled.
- Attachments remain unchanged through preview / use / restore / cancel flows.

## Styling / UX

- Added compact prompt enhancement dialog styles using existing theme variables and existing dialog/button classes.
- Added focus-visible styling and responsive layout adjustments.
- Added English and Chinese locale keys using the existing `react-i18next` translation pattern.

## Tests

### Passing

Run:

```powershell
node --test tests/prompt-enhancement-ui.test.mjs
```

Result: PASS

### Blocked outside requested file scope

Run:

```powershell
npx.cmd tsc --noEmit
```

Result: FAIL

Current compiler error:

```text
src/utils/promptEnhancer.ts(8,46): error TS7016: Could not find a declaration file for module './promptEnhancerCore.js'. 'D:/ccNexus/.worktrees/codex-prompt-enhancement/src/utils/promptEnhancerCore.js' implicitly has an 'any' type.
```

This error is in `src/utils/promptEnhancer.ts`, which was not part of the allowed Task 5 edit list. I did not change that file. The Task 5 renderer work itself is green against the new contract test.

## Diff Review Notes

- No package-lock changes.
- No unrelated tracked files were modified.
- The renderer diff stays focused on Task 5 UI flow, styling, locales, and tests.

## Fix Round 1

### Review item verified

The review finding was correct: the dialog footer previously preferred `aiResult || localResult`, so stale AI text could remain selectable after a retry, cancel, or error path if the old AI result string was still present.

### Fix applied

- Added a pure dialog helper, `getPromptEnhancementUseValue(...)`, so the footer only uses AI text when `aiStatus === 'success'`.
- Added pure lifecycle helpers in `ChatInputBox`:
  - `startPromptEnhancementAiRequest(...)`
  - `resetPromptEnhancementAiState(...)`
- Starting a new AI request now clears stale `aiResult` and `aiError`.
- Canceling an AI request resets state back to local-only fallback and clears stale `aiResult`.
- Error reset now clears stale `aiResult`, records the fresh error text, and keeps local preview as the only usable result.
- Successful completion still applies only the current request's AI result after the request ID check passes.
- Explicit-action-only AI invocation and no-submit behavior remain unchanged.

### Test strengthening

- Extended `tests/prompt-enhancement-ui.test.mjs` with executable helper coverage through a narrow `vm` harness, without adding any new test dependency.
- Added behavioral coverage for:
  - success selecting the current AI result,
  - loading falling back to local result,
  - error falling back to local result,
  - idle falling back to local result,
  - retry clearing stale AI text before a new request,
  - cancel/error reset rejecting stale AI text afterward.
- Kept the existing static architecture guardrails alongside the executable checks.

### Styling cleanup

- Replaced the hard-coded prompt enhancement error text color with the existing semantic variable `var(--mode-dangerous-foreground)`.

### Verification

Run:

```powershell
node --test tests/prompt-enhancement-ui.test.mjs
```

Result: PASS

Run:

```powershell
npx.cmd tsc --noEmit
```

Result: FAIL on the same known baseline error:

```text
src/utils/promptEnhancer.ts(8,46): error TS7016: Could not find a declaration file for module './promptEnhancerCore.js'. 'D:/ccNexus/.worktrees/codex-prompt-enhancement/src/utils/promptEnhancerCore.js' implicitly has an 'any' type.
```

No additional TypeScript errors were introduced by Fix Round 1.
