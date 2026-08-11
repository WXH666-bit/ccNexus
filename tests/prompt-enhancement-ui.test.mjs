import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function captureFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  let index = source.indexOf('{', start);
  assert.notEqual(index, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated function: ${signature}`);
}

function stripTsFunction(functionSource) {
  return functionSource
    .replace(/export\s+/g, '')
    .replace(/function\s+(\w+)\(([^)]*)\)/g, (_match, name, params) => (
      `function ${name}(${params.replace(/:\s*[^,)=]+/g, '')})`
    ))
    .replace(/\)\s*:\s*[^{]+\{/g, ') {')
    .replace(/\s+as const/g, '');
}

function loadPromptEnhancementHelpers() {
  const dialogSource = read('src/components/ChatInputBox/PromptEnhanceDialog.tsx');
  const inputSource = read('src/components/ChatInputBox/index.tsx');
  const getUseValueSource = stripTsFunction(captureFunction(dialogSource, 'export function getPromptEnhancementUseValue'));
  const startRequestSource = stripTsFunction(captureFunction(inputSource, 'export function startPromptEnhancementAiRequest'));
  const resetStateSource = stripTsFunction(captureFunction(inputSource, 'export function resetPromptEnhancementAiState'));
  const script = [
    getUseValueSource,
    startRequestSource,
    resetStateSource,
    'result = { getPromptEnhancementUseValue, startPromptEnhancementAiRequest, resetPromptEnhancementAiState };',
  ].join('\n');
  const context = { result: null };
  vm.runInNewContext(script, context);
  return context.result;
}

test('PromptEnhanceDialog exists and exposes the preview, AI, restore, and cancel contract', () => {
  const dialogPath = resolve(root, 'src/components/ChatInputBox/PromptEnhanceDialog.tsx');
  assert.equal(existsSync(dialogPath), true, 'PromptEnhanceDialog.tsx should exist');

  const source = read('src/components/ChatInputBox/PromptEnhanceDialog.tsx');

  assert.match(source, /export function getPromptEnhancementUseValue/);
  assert.match(source, /useTranslation\(/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /localResult/);
  assert.match(source, /aiResult/);
  assert.match(source, /aiStatus/);
  assert.match(source, /aiError/);
  assert.match(source, /onUse/);
  assert.match(source, /onAiEnhance/);
  assert.match(source, /onCancelAi/);
  assert.match(source, /onRestore/);
  assert.match(source, /onCancel/);
  assert.match(source, /chat\.promptEnhancer\.title/);
  assert.match(source, /chat\.promptEnhancer\.localResult/);
  assert.match(source, /chat\.promptEnhancer\.aiResult/);
  assert.match(source, /chat\.promptEnhancer\.useResult/);
  assert.match(source, /chat\.promptEnhancer\.restore/);
  assert.match(source, /chat\.promptEnhancer\.cancel/);
  assert.match(source, /chat\.promptEnhancer\.aiEnhance/);
  assert.match(source, /chat\.promptEnhancer\.loading/);
  assert.match(source, /chat\.promptEnhancer\.error/);
});

test('prompt enhancement helper selects only successful AI output and otherwise falls back to local text', () => {
  const { getPromptEnhancementUseValue } = loadPromptEnhancementHelpers();
  const localResult = 'local rewrite';
  const staleAiResult = 'old ai rewrite';

  assert.equal(
    getPromptEnhancementUseValue({ localResult, aiResult: 'fresh ai rewrite', aiStatus: 'success' }),
    'fresh ai rewrite',
  );
  assert.equal(
    getPromptEnhancementUseValue({ localResult, aiResult: staleAiResult, aiStatus: 'loading' }),
    localResult,
  );
  assert.equal(
    getPromptEnhancementUseValue({ localResult, aiResult: staleAiResult, aiStatus: 'error' }),
    localResult,
  );
  assert.equal(
    getPromptEnhancementUseValue({ localResult, aiResult: staleAiResult, aiStatus: 'idle' }),
    localResult,
  );
});

test('prompt enhancement AI lifecycle helpers clear stale AI text on retry and reset', () => {
  const { getPromptEnhancementUseValue, startPromptEnhancementAiRequest, resetPromptEnhancementAiState } = loadPromptEnhancementHelpers();
  const current = {
    originalText: 'draft',
    localResult: 'local rewrite',
    aiResult: 'stale ai rewrite',
    aiStatus: 'success',
    aiError: '',
    requestId: 'req-1',
  };

  const retrying = startPromptEnhancementAiRequest(current, 'req-2');
  assert.equal(retrying.aiStatus, 'loading');
  assert.equal(retrying.aiResult, '');
  assert.equal(retrying.aiError, '');
  assert.equal(retrying.requestId, 'req-2');
  assert.equal(getPromptEnhancementUseValue(retrying), current.localResult);

  const cancelled = resetPromptEnhancementAiState(retrying);
  assert.equal(cancelled.aiStatus, 'idle');
  assert.equal(cancelled.aiResult, '');
  assert.equal(cancelled.aiError, '');
  assert.equal(cancelled.requestId, null);
  assert.equal(getPromptEnhancementUseValue(cancelled), current.localResult);

  const failed = resetPromptEnhancementAiState({ ...retrying, aiResult: 'should be discarded' }, 'error', 'boom');
  assert.equal(failed.aiStatus, 'error');
  assert.equal(failed.aiResult, '');
  assert.equal(failed.aiError, 'boom');
  assert.equal(getPromptEnhancementUseValue(failed), current.localResult);
});

test('ChatInputBox opens a local preview dialog instead of mutating or submitting immediately', () => {
  const source = read('src/components/ChatInputBox/index.tsx');

  assert.match(source, /import PromptEnhanceDialog from '\.\/PromptEnhanceDialog';/);
  assert.match(source, /createPromptEnhancementPreview/);
  assert.doesNotMatch(source, /enhancePromptText/);
  assert.match(source, /const \[promptEnhancement, setPromptEnhancement\] = useState/);
  assert.match(source, /const openPromptEnhancer = useCallback/);
  assert.match(source, /createPromptEnhancementPreview\(originalText\)/);
  assert.match(source, /localResult:\s*preview\.localResult|localResult:\s*createPromptEnhancementPreview\(originalText\)\.localResult/);
  assert.match(source, /aiStatus:\s*'idle'/);
  assert.match(source, /aiError:\s*''/);
  assert.match(source, /<PromptEnhanceDialog/);
  assert.match(source, /onEnhancePrompt=\{openPromptEnhancer\}/);
  assert.doesNotMatch(source, /onEnhancePrompt=\{submit\}/);
});

test('ChatInputBox keeps prompt enhancement side effects out of send and only updates the draft on use', () => {
  const source = read('src/components/ChatInputBox/index.tsx');

  assert.match(source, /onUse=\{\(nextText\) => \{/);
  assert.match(source, /setText\(nextText\)/);
  assert.match(source, /setPromptEnhancement\(null\)/);
  assert.doesNotMatch(source, /onUse=\{\(nextText\) => \{[\s\S]{0,220}(submit|onSend)\(/);
  assert.match(source, /onRestore=\{\(\) => \{/);
  assert.match(source, /setText\(promptEnhancement\.originalText\)/);
  assert.doesNotMatch(source, /onRestore=\{\(\) => \{[\s\S]{0,220}(submit|onSend)\(/);
  assert.match(source, /onCancel=\{/);
});

test('ChatInputBox starts AI enhancement only from the explicit dialog action and guards request lifecycles', () => {
  const source = read('src/components/ChatInputBox/index.tsx');

  assert.match(source, /import \{[^}]*enhancePrompt[^}]*cancelPromptEnhancement[^}]*\} from '\.\.\/\.\.\/utils\/desktopBridgeApi';/);
  assert.match(source, /export function startPromptEnhancementAiRequest/);
  assert.match(source, /export function resetPromptEnhancementAiState/);
  assert.match(source, /requestId/);
  assert.match(source, /crypto\.randomUUID\(\)|Date\.now\(\)/);
  assert.match(source, /onAiEnhance=\{async \(\) => \{/);
  assert.match(source, /await enhancePrompt\(/);
  assert.match(source, /localResult:\s*promptEnhancement\.localResult/);
  assert.match(source, /setPromptEnhancement\(current => startPromptEnhancementAiRequest\(current, requestId\)\)/);
  assert.match(source, /setPromptEnhancement\(current => resetPromptEnhancementAiState\(current\)\)/);
  assert.match(source, /aiStatus:\s*'loading'/);
  assert.match(source, /aiStatus:\s*'success'|'done'/);
  assert.match(source, /resetPromptEnhancementAiState\(current, 'error'/);
  assert.match(source, /result\.requestId/);
  assert.match(source, /cancelPromptEnhancement\(/);
  assert.match(source, /sessionKey/);
  assert.match(source, /isStreaming/);
});

test('ButtonArea receives separate hasPromptText semantics so image-only drafts still send but cannot enhance', () => {
  const inputSource = read('src/components/ChatInputBox/index.tsx');
  const buttonArea = read('src/components/ChatInputBox/ButtonArea.tsx');

  assert.match(inputSource, /hasInputContent=\{!!text\.trim\(\) \|\| attachments\.length > 0\}/);
  assert.match(inputSource, /hasPromptText=\{!!text\.trim\(\)\}/);

  assert.match(buttonArea, /hasPromptText:\s*boolean;/);
  assert.match(buttonArea, /hasInputContent:\s*boolean;/);
  assert.match(buttonArea, /disabled=\{!hasPromptText \|\| isStreaming\}/);
  assert.match(buttonArea, /title=\{t\('chat\.promptEnhancer\.trigger'/);
  assert.doesNotMatch(buttonArea, /createPromptEnhancementPreview|enhancePrompt\(|cancelPromptEnhancement\(/);
});

test('prompt enhancement translations and styles are defined in the existing renderer systems', () => {
  const styles = read('src/index.css');
  const en = read('src/i18n/locales/en.json');
  const zh = read('src/i18n/locales/zh.json');

  assert.match(styles, /\.prompt-enhance-dialog/);
  assert.match(styles, /\.prompt-enhance-preview/);
  assert.match(styles, /\.prompt-enhance-actions/);
  assert.match(styles, /\.prompt-enhance-error/);
  assert.match(styles, /\.prompt-enhance-loading/);
  assert.match(styles, /var\(--bg-secondary\)/);
  assert.match(styles, /var\(--text-primary\)/);
  assert.match(styles, /var\(--accent-blue\)/);
  assert.match(styles, /var\(--mode-dangerous-foreground\)|var\(--accent-red\)/);
  assert.doesNotMatch(styles, /#ffb4ab/);

  for (const locale of [en, zh]) {
    assert.match(locale, /"promptEnhancer"\s*:/);
    assert.match(locale, /"title"\s*:/);
    assert.match(locale, /"original"\s*:/);
    assert.match(locale, /"localResult"\s*:/);
    assert.match(locale, /"aiResult"\s*:/);
    assert.match(locale, /"useResult"\s*:/);
    assert.match(locale, /"restore"\s*:/);
    assert.match(locale, /"cancel"\s*:/);
    assert.match(locale, /"aiEnhance"\s*:/);
    assert.match(locale, /"loading"\s*:/);
    assert.match(locale, /"error"\s*:/);
  }
});
