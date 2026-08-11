import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('PromptEnhanceDialog exists and exposes the preview, AI, restore, and cancel contract', () => {
  const dialogPath = resolve(root, 'src/components/ChatInputBox/PromptEnhanceDialog.tsx');
  assert.equal(existsSync(dialogPath), true, 'PromptEnhanceDialog.tsx should exist');

  const source = read('src/components/ChatInputBox/PromptEnhanceDialog.tsx');

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
  assert.match(source, /requestId/);
  assert.match(source, /crypto\.randomUUID\(\)|Date\.now\(\)/);
  assert.match(source, /onAiEnhance=\{async \(\) => \{/);
  assert.match(source, /await enhancePrompt\(/);
  assert.match(source, /localResult:\s*promptEnhancement\.localResult/);
  assert.match(source, /aiStatus:\s*'loading'/);
  assert.match(source, /aiStatus:\s*'success'|'done'/);
  assert.match(source, /aiStatus:\s*'error'/);
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
