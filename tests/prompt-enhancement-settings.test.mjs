import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('prompt enhancer settings describe deterministic local rules and a manual AI polish boundary', () => {
  const source = read('src/components/settings/PromptEnhancerSection.tsx');
  const en = read('src/i18n/locales/en.json');
  const zh = read('src/i18n/locales/zh.json');

  for (const locale of [en, zh]) {
    assert.match(locale, /"settings"\s*:/);
    assert.match(locale, /"prompt"\s*:/);
    assert.match(locale, /"localRulesTitle"\s*:/);
    assert.match(locale, /"localRulesDescription"\s*:/);
    assert.match(locale, /"manualAiTitle"\s*:/);
    assert.match(locale, /"manualAiDescription"\s*:/);
    assert.match(locale, /"rulesEmpty"\s*:/);
    assert.match(locale, /"patternLabel"\s*:/);
    assert.match(locale, /"replacementLabel"\s*:/);
    assert.match(locale, /"deleteRule"\s*:/);
    assert.match(locale, /"enableRule"\s*:/);
    assert.match(locale, /"disableRule"\s*:/);
  }

  assert.match(source, /settings\.prompt\.localRulesTitle/);
  assert.match(source, /settings\.prompt\.localRulesDescription/);
  assert.match(source, /settings\.prompt\.manualAiTitle/);
  assert.match(source, /settings\.prompt\.manualAiDescription/);
  assert.match(source, /settings\.prompt\.rulesEmpty/);
  assert.match(source, /settings\.prompt\.patternLabel/);
  assert.match(source, /settings\.prompt\.replacementLabel/);
  assert.match(source, /settings\.prompt\.deleteRule/);
  assert.match(source, /settings\.prompt\.enableRule/);
  assert.match(source, /settings\.prompt\.disableRule/);
});

test('prompt enhancer settings keep local rule management controls without the removed test-only UI', () => {
  const source = read('src/components/settings/PromptEnhancerSection.tsx');

  assert.match(source, /localStorage\.getItem\('promptEnhancerEnabled'\)/);
  assert.match(source, /localStorage\.getItem\('promptEnhancerRules'\)/);
  assert.match(source, /localStorage\.setItem\('promptEnhancerEnabled'/);
  assert.match(source, /localStorage\.setItem\('promptEnhancerRules'/);
  assert.match(source, /const addRule = \(\) =>/);
  assert.match(source, /const updateRule = \(id: string, field: keyof PromptRule, value: string \| boolean\) =>/);
  assert.match(source, /const removeRule = \(id: string\) =>/);
  assert.match(source, /updateRule\(rule\.id, 'pattern'/);
  assert.match(source, /updateRule\(rule\.id, 'replacement'/);
  assert.match(source, /updateRule\(rule\.id, 'enabled'/);
  assert.match(source, /removeRule\(rule\.id\)/);
  assert.match(source, /t\('settings\.prompt\.addRule'\)/);

  assert.doesNotMatch(source, /onEnhance\?/);
  assert.doesNotMatch(source, /Test Enhancement/);
  assert.doesNotMatch(source, /prompt-test-input/);
  assert.doesNotMatch(source, /textarea/);
  assert.doesNotMatch(source, /console\.log/);
});

test('prompt enhancer settings styles use theme-aware surfaces for explanatory cards and rule rows', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.prompt-enhancer-notice-card/);
  assert.match(styles, /\.prompt-enhancer-notice-title/);
  assert.match(styles, /\.prompt-enhancer-notice-copy/);
  assert.match(styles, /\.prompt-rule-item/);
  assert.match(styles, /\.rule-fields/);
  assert.match(styles, /\.rule-actions/);
  assert.match(styles, /var\(--surface-panel\)|var\(--surface-raised\)/);
  assert.match(styles, /var\(--text-primary\)/);
  assert.match(styles, /var\(--text-secondary\)|var\(--text-tertiary\)/);
  assert.match(styles, /var\(--accent-blue\)/);
});
