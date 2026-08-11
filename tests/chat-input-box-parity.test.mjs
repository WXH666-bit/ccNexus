import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ChatInputBox uses ccgui-style module boundaries', () => {
  const files = [
    'src/components/ChatInputBox/index.tsx',
    'src/components/ChatInputBox/ContextBar.tsx',
    'src/components/ChatInputBox/InputEditable.tsx',
    'src/components/ChatInputBox/ButtonArea.tsx',
    'src/components/ChatInputBox/ModeSelect.tsx',
    'src/components/ChatInputBox/ModelSelect.tsx',
    'src/components/ChatInputBox/CompletionDropdown.tsx',
  ];

  for (const file of files) {
    assert.equal(existsSync(resolve(root, file)), true, `${file} should exist`);
  }
});

test('ChatInputBox copies ccgui input semantics instead of using textarea', () => {
  const source = read('src/components/ChatInputBox/index.tsx');
  const editable = read('src/components/ChatInputBox/InputEditable.tsx');

  assert.equal(source.includes('<textarea'), false);
  assert.match(editable, /contentEditable=\{!disabled\}/);
  assert.match(editable, /onCompositionStart/);
  assert.match(editable, /onCompositionEnd/);
  assert.match(editable, /insertParagraph/);
  assert.match(source, /@引用文件，#唤起智能体，!插入提示词，Enter 发送/);
});

test('ChatInputBox supports ccgui trigger completions and toolbar controls', () => {
  const source = read('src/components/ChatInputBox/index.tsx');
  const buttonArea = read('src/components/ChatInputBox/ButtonArea.tsx');

  assert.match(source, /trigger:\s*'@'/);
  assert.match(source, /trigger:\s*'#'/);
  assert.match(source, /trigger:\s*'!'/);
  assert.match(source, /trigger:\s*'\/'/);
  assert.match(buttonArea, /ModeSelect/);
  assert.match(buttonArea, /ModelSelect/);
  assert.match(buttonArea, /ReasoningSelect/);
  assert.match(buttonArea, /disabled=\{!alwaysThinking\}/);
  assert.match(buttonArea, /longContextEnabled/);
  assert.equal(buttonArea.includes('<ProviderSelect'), false);
});

test('ChatInputBox persists chat toolbar preferences across app restarts', () => {
  const chatView = read('src/views/ChatView.tsx');
  const inputBox = read('src/components/ChatInputBox/index.tsx');

  assert.match(chatView, /readStoredPreference\('chatMode', 'default'\)/);
  assert.match(chatView, /localStorage\.setItem\('chatMode'/);
  assert.match(chatView, /readStoredPreference\('chatModel', 'default'\)/);
  assert.match(chatView, /localStorage\.setItem\('chatModel'/);
  assert.match(chatView, /readStoredPreference\('chatReasoning', 'high'\)/);
  assert.match(chatView, /localStorage\.setItem\('chatReasoning'/);

  assert.match(inputBox, /setAlwaysThinking = useCallback/);
  assert.match(inputBox, /localStorage\.setItem\('alwaysThinking'/);
  assert.match(inputBox, /setStreaming = useCallback/);
  assert.match(inputBox, /localStorage\.setItem\('streaming'/);
  assert.match(inputBox, /setLongContextEnabled = useCallback/);
  assert.match(inputBox, /localStorage\.setItem\('longContextEnabled'/);
  assert.match(inputBox, /setSelectedAgent = useCallback/);
  assert.match(inputBox, /localStorage\.setItem\('selectedAgent'/);
});

test('ChatInputBox config switches show distinct enabled and disabled states', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.toggle-slider\s*\{[^}]*background-color:\s*#3a3f45;/s);
  assert.match(styles, /\.toggle-switch input:checked \+ \.toggle-slider\s*\{[^}]*background-color:\s*#0e8df5;/s);
  assert.match(styles, /\.reasoning-select-trigger\.disabled/s);
});

test('ChatInputBox does not steal focus from selector controls', () => {
  const source = read('src/components/ChatInputBox/index.tsx');

  assert.match(source, /shouldFocusEditor/);
  assert.match(source, /\.closest\('\.button-area/);
  assert.match(source, /event\.target/);
});

test('ChatInputBox token indicator uses dynamic usage props instead of a hard-coded percentage', () => {
  const source = read('src/components/ChatInputBox/index.tsx');
  const contextBar = read('src/components/ChatInputBox/ContextBar.tsx');

  assert.equal(source.includes('useState(26)'), false);
  assert.match(source, /usageUsedTokens/);
  assert.match(source, /getModelContextLimit/);
  assert.match(source, /calculateContextPercentage/);
  assert.match(contextBar, /TokenIndicator/);
  assert.match(contextBar, /usedTokens/);
  assert.match(contextBar, /maxTokens/);
});

test('ChatInputBox token indicator displays one decimal for small context percentages', () => {
  const tokenIndicator = read('src/components/ChatInputBox/TokenIndicator.tsx');

  assert.match(tokenIndicator, /function formatPercentageLabel/);
  assert.match(tokenIndicator, /safePercentage < 10/);
  assert.equal(/const labelPercentage = `\$\{Math\.round\(safePercentage\)\}%`;/.test(tokenIndicator), false);
});

test('ChatInputBox token indicator is vertically centered in the context bar', () => {
  const styles = read('src/index.css');
  const tokenRule = styles.match(/\.token-indicator\s*\{[^}]*\}/g)?.at(-1) || '';
  const wrapRule = styles.match(/\.token-indicator-wrap\s*\{[^}]*\}/s)?.[0] || '';

  assert.match(tokenRule, /align-items:\s*center;/);
  assert.match(tokenRule, /margin:\s*0;/);
  assert.match(wrapRule, /width:\s*14px;/);
  assert.match(wrapRule, /height:\s*14px;/);
});

test('ChatInputBox does not render the top resize slider', () => {
  const source = read('src/components/ChatInputBox/index.tsx');
  const styles = read('src/index.css');

  assert.equal(source.includes('resize-handle'), false);
  assert.equal(styles.includes('.resize-handle'), false);
});

test('ModeSelect uses ccgui custom dropdown instead of a native select popup', () => {
  const buttonArea = read('src/components/ChatInputBox/ButtonArea.tsx');
  const modeSelect = read('src/components/ChatInputBox/ModeSelect.tsx');

  assert.equal(buttonArea.includes('<select className="selector mode-select"'), false);
  assert.match(modeSelect, /selector-button/);
  assert.match(modeSelect, /selector-dropdown/);
  assert.match(modeSelect, /stopPropagation/);
  assert.match(modeSelect, /document\.addEventListener\('mousedown'/);
});

test('ModeSelect dropdown is left aligned so it stays inside the chat input boundary', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.mode-select-dropdown\s*\{[^}]*left:\s*0;/s);
  assert.match(styles, /\.mode-select-dropdown\s*\{[^}]*right:\s*auto;/s);
});

test('permission mode labels distinguish SDK auto from full access', () => {
  const modeSelect = read('src/components/ChatInputBox/ModeSelect.tsx');
  const buttonArea = read('src/components/ChatInputBox/ButtonArea.tsx');

  assert.match(modeSelect, /id:\s*['"]auto['"]/);
  assert.match(modeSelect, /id:\s*['"]bypassPermissions['"]/);
  assert.match(modeSelect, /模型判断|Model decides/);
  assert.match(modeSelect, /完全访问|Full access/);
  assert.doesNotMatch(
    buttonArea,
    /mode\s*===\s*['"]bypassPermissions['"][\s\S]{0,180}auto-mode-badge/,
  );
});

test('permission mode colors communicate neutral auto and dangerous full access states', () => {
  const modeSelect = read('src/components/ChatInputBox/ModeSelect.tsx');
  const styles = read('src/index.css');

  assert.match(modeSelect, /mode-auto-option/);
  assert.match(modeSelect, /mode-dangerous-option/);
  assert.match(modeSelect, /mode-dangerous-icon/);
  assert.match(
    styles,
    /\.mode-auto-active,\s*\.mode-auto-icon\s*\{[^}]*color:\s*var\(--accent-blue\);/s,
  );
  assert.match(
    styles,
    /\.mode-dangerous-active,\s*\.mode-dangerous-icon\s*\{[^}]*color:\s*var\(--accent-red\);/s,
  );
  assert.match(
    styles,
    /\.selector-option\.selected\.mode-dangerous-option\s*\{[^}]*background:\s*var\(--mode-dangerous-selected\);/s,
  );
});

test('full access mode requires explicit confirmation before changing active mode', () => {
  const chatView = read('src/views/ChatView.tsx');

  assert.match(chatView, /FullAccessConfirmDialog/);
  assert.match(chatView, /pendingModeConfirmation/);
  assert.match(chatView, /nextMode === ['"]bypassPermissions['"]/);
  assert.match(chatView, /onConfirm=\{confirmFullAccessMode\}/);
  assert.match(chatView, /onCancel=\{\(\) => setPendingModeConfirmation\(null\)\}/);
});

test('dangerous mode keeps warning text visible in the chat toolbar', () => {
  const styles = read('src/index.css');

  assert.match(
    styles,
    /\.button-area \.mode-dangerous-active\s*\{[^}]*color:\s*var\(--accent-red\);/s,
  );
  assert.match(
    styles,
    /\.mode-dangerous-option \.mode-option-label\s*\{[^}]*color:\s*var\(--mode-dangerous-foreground\);/s,
  );
});

test('ModelSelect merges provider mapping with model choice like ccgui', () => {
  const source = read('src/components/ChatInputBox/ModelSelect.tsx');

  assert.match(source, /resolveModelDisplay/);
  assert.match(source, /modelSupportsLongContext/);
  assert.match(source, /1M上下文/);
  assert.match(source, /添加模型/);
  assert.match(source, /model-option-subtitle/);
});
