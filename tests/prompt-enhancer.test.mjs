import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPromptRules,
  createLocalPromptEnhancement,
  createPromptEnhancementPreview,
  organizePromptText,
} from '../src/utils/promptEnhancerCore.js';

test('organizes a multi-part request without inventing requirements', () => {
  const result = createLocalPromptEnhancement('帮我做一个好看的 HTML 页面，要科技风。', []);

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
    '```html',
    '<div class="demo">x</div>',
    '```',
  ].join('\n');

  const result = createLocalPromptEnhancement(source, []);
  assert.match(result, /C:\\Users\\18246\\Desktop\\ccnexus-test\\sakura\.html/);
  assert.match(result, /npm\.cmd run build/);
  assert.match(result, /https:\/\/example\.com\/a\?b=1/);
  assert.match(result, /<div class="demo">x<\/div>/);
});

test('ignores invalid custom regular expressions', () => {
  assert.doesNotThrow(() => createLocalPromptEnhancement('检查项目', [
    { pattern: '[', replacement: 'broken', enabled: true },
  ]));
});

test('applies enabled prompt rules in order', () => {
  const result = applyPromptRules('alpha beta', [
    { pattern: 'alpha', replacement: 'one', enabled: true },
    { pattern: 'beta', replacement: 'two', enabled: true },
  ]);

  assert.equal(result, 'one two');
});

test('organizePromptText leaves already short prompts unchanged', () => {
  assert.equal(organizePromptText('短句'), '短句');
});

test('preview returns the original text, local result, and change flag', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem(key) {
        if (key === 'promptEnhancerEnabled') return 'true';
        if (key === 'promptEnhancerRules') return '[]';
        return null;
      },
    },
  };

  try {
    const preview = createPromptEnhancementPreview('帮我做一个 HTML 页面。');

    assert.deepEqual(preview, {
      originalText: '帮我做一个 HTML 页面。',
      localResult: preview.localResult,
      changed: preview.changed,
    });
    assert.equal(typeof preview.localResult, 'string');
    assert.equal(typeof preview.changed, 'boolean');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('preview still computes local output when enhancement is disabled', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem(key) {
        if (key === 'promptEnhancerEnabled') return 'false';
        if (key === 'promptEnhancerRules') return '[]';
        return null;
      },
    },
  };

  try {
    const preview = createPromptEnhancementPreview('帮我做一个好看的 HTML 页面，要科技风。');
    assert.match(preview.localResult, /目标：/);
    assert.match(preview.localResult, /约束：/);
    assert.equal(preview.originalText, '帮我做一个好看的 HTML 页面，要科技风。');
    assert.equal(preview.changed, true);
  } finally {
    globalThis.window = originalWindow;
  }
});
