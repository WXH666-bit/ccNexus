# 全窗口背景与状态面板开关图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 让自定义背景覆盖整个 ccNexus renderer 窗口，并修复状态面板总开关在收起/展开状态下不显示图标的问题。

**Architecture:** 保留主进程 \`AppearancePreferences\`、preload IPC、renderer 外观状态和现有 CSS 变量不变，只把背景伪元素的承载层从 \`.chat-main\` 提升到 \`.app-root\`。状态面板总开关继续由 \`ChatInputBox/ContextBar\` 控制，但改用独立 class 和明确的 \`ChevronUp\`/\`ChevronDown\` 图标，避免旧容器样式冲突。

**Tech Stack:** React 19、TypeScript、Vite、lucide-react、CSS custom properties、Node.js built-in test runner。

## Global Constraints

- 自定义背景只允许写入 ccNexus 自己的 \`.ccnexus\` 外观状态和固定背景文件，不修改 Claude Code、cc-switch 或其他配置文件。
- 保留 \`--bg-chat-image\`、\`--chat-bg-image-opacity\`、\`--chat-bg-image-blur\` 和 \`--chat-bg-overlay-opacity\` 变量及现有背景导入、清除、透明度、模糊和遮罩协议。
- 不改变任务、子代理和编辑面板的打开/关闭逻辑，只修复状态面板总开关的图标和样式。
- 不新增图片格式、远程背景、拖放导入或图片编辑功能。
- 修改完成后必须运行相关测试、\`npm run test:protocol\`、\`npm run build\` 和 \`git diff --check\`。

---

## 文件地图

- \`src/index.css\`：应用壳层的全窗口背景层、透明/半透明表面和状态开关按钮样式。
- \`src/components/ChatInputBox/ContextBar.tsx\`：状态面板总开关的 class、图标和展开状态属性。
- \`tests/desktop-appearance-preferences.test.mjs\`：外观背景层的静态回归断言。
- \`tests/streaming-status-indicator.test.mjs\`：状态面板布局和总开关图标的静态回归断言。

### Task 1: Add failing regression tests

**Files:**
- Modify: \`tests/desktop-appearance-preferences.test.mjs\`
- Modify: \`tests/streaming-status-indicator.test.mjs\`

**Interfaces:**
- Consumes: current renderer CSS and \`ContextBar\` source.
- Produces: regression assertions that fail against the current chat-only background and blank status-toggle implementation.

- [ ] **Step 1: Add the global background-layer test**

在 \`tests/desktop-appearance-preferences.test.mjs\` 中增加测试，读取 \`src/index.css\`，断言应用壳层拥有背景伪元素、路由页面位于内容层、聊天主区域不再拥有独立伪元素：

\`\`\`js
test('appearance background is rendered by the whole app shell', () => {
  const css = read('src/index.css');
  assert.match(css, /\.app-root\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.app-root::before[\s\S]*--bg-chat-image/);
  assert.match(css, /\.app-root::after[\s\S]*--chat-bg-overlay-opacity/);
  assert.match(css, /\.app-root\s*>\s*\*[^}]*z-index:\s*1;/s);
  assert.match(css, /\.chat-main\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(css, /\.chat-main::before/);
});
\`\`\`

- [ ] **Step 2: Add the status-toggle icon test**

在 \`tests/streaming-status-indicator.test.mjs\` 中读取 \`src/components/ChatInputBox/ContextBar.tsx\`，增加以下断言，锁定专用 class、两个方向图标和 \`aria-expanded\`：

\`\`\`js
test('status panel toggle renders a direction icon in both states', () => {
  const contextBar = read('../src/components/ChatInputBox/ContextBar.tsx');
  const styles = read('../src/index.css');

  assert.match(contextBar, /ChevronDown[\s\S]*ChevronUp/);
  assert.match(contextBar, /status-panel-toggle-button/);
  assert.match(contextBar, /showStatusPanel \? <ChevronDown size=\{16\} \/> : <ChevronUp size=\{16\} \/>/);
  assert.match(contextBar, /aria-expanded=\{showStatusPanel\}/);
  assert.match(styles, /\.status-panel-toggle-button\s*\{/);
});
\`\`\`

- [ ] **Step 3: Run only the new regression tests and confirm RED**

Run:

\`\`\`powershell
node --test tests/desktop-appearance-preferences.test.mjs tests/streaming-status-indicator.test.mjs
\`\`\`

Expected: FAIL because the current background selectors are \`.chat-main::before\`/\`.chat-main::after\`, and \`ContextBar\` currently uses \`Layers\` plus the conflicting \`status-panel-toggle\` class.

### Task 2: Move the background layers to the application shell

**Files:**
- Modify: \`src/index.css\` at the final ccNexus-owned appearance block and the legacy status-toggle block.

**Interfaces:**
- Consumes: the existing CSS variables set by \`applyAppearancePreferences()\`.
- Produces: \`.app-root\` background image/overlay layers and transparent/半透明 surfaces that expose them across chat, history, settings, sidebar, titlebar, input and status areas.

- [ ] **Step 1: Replace the chat-only pseudo-element block**

Replace the final \`.chat-main\` background block with an app-shell block using the existing variables:

\`\`\`css
.app-root {
  position: relative;
  isolation: isolate;
  background: var(--bg-primary);
}

.app-root::before,
.app-root::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
}

.app-root::before {
  z-index: 0;
  background-image: var(--bg-chat-image);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: blur(var(--chat-bg-image-blur));
  opacity: var(--chat-bg-image-opacity);
  transform: scale(1.04);
  transition: opacity 180ms ease, filter 180ms ease;
}

.app-root::after {
  z-index: 0;
  background: var(--bg-primary);
  opacity: var(--chat-bg-overlay-opacity);
  transition: opacity 180ms ease;
}

.app-root > * {
  position: relative;
  z-index: 1;
}

.chat-view,
.history-view,
.settings-view,
.chat-main {
  background: transparent;
}
\`\`\`

- [ ] **Step 2: Make the main surfaces translucent without changing their layout**

Append overrides after the existing visual-polish rules so they win over earlier opaque backgrounds:

\`\`\`css
.window-drag-region {
  background: color-mix(in srgb, var(--bg-primary) 68%, transparent);
}

.chat-header,
.history-header,
.settings-sidebar,
.file-explorer {
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
}

.file-explorer-header {
  background: color-mix(in srgb, var(--bg-secondary) 64%, transparent);
}

.file-editor,
.settings-content,
.message-list {
  background: transparent;
}

.chat-input-box {
  background: color-mix(in srgb, var(--surface-panel) 76%, transparent);
}

.status-panel-tabs,
.status-panel-popover {
  background: color-mix(in srgb, var(--surface-panel) 80%, transparent);
}
\`\`\`

Keep existing borders, shadows, spacing and responsive rules unchanged. The image remains hidden when \`--chat-bg-image-opacity\` is zero, so missing/cleared backgrounds still render the theme fallback.

- [ ] **Step 3: Remove the stale broad \`.status-panel-toggle\` container rules**

Delete the unused legacy rules that set \`display\`, \`padding\`, \`background\` and \`border-top\` on \`.status-panel-toggle\`; those rules were written for an old wrapper and conflict with the current button. Keep no selector that applies wrapper-only layout to the new button.

- [ ] **Step 4: Run the appearance regression test**

Run:

\`\`\`powershell
node --test tests/desktop-appearance-preferences.test.mjs
\`\`\`

Expected: the application-shell background assertions pass, including the absence of \`.chat-main::before\`.

### Task 3: Give the status-panel toggle a visible state icon

**Files:**
- Modify: \`src/components/ChatInputBox/ContextBar.tsx\`
- Modify: \`src/index.css\`

**Interfaces:**
- Consumes: the existing \`showStatusPanel\` boolean and \`onToggleStatusPanel\` callback.
- Produces: a button with a stable \`status-panel-toggle-button\` class, state-specific direction icon and \`aria-expanded\` state.

- [ ] **Step 1: Update the icon import and button markup**

Change the lucide import to include \`ChevronUp\` and remove \`Layers\`. Change the button to:

\`\`\`tsx
<button
  type="button"
  className={'context-tool-btn status-panel-toggle-button ' + (showStatusPanel ? 'expanded' : 'collapsed')}
  onClick={event => {
    event.stopPropagation();
    onToggleStatusPanel();
  }}
  title={showStatusPanel ? '收起状态面板' : '展开状态面板'}
  aria-label={showStatusPanel ? '收起状态面板' : '展开状态面板'}
  aria-expanded={showStatusPanel}
>
  {showStatusPanel ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
</button>
\`\`\`

Keep the adjacent \`RotateCcw\` button and all attachment/context behavior unchanged.

- [ ] **Step 2: Add the dedicated button style**

Add a final style that restores the compact context-bar button geometry after removing the old wrapper conflict:

\`\`\`css
.status-panel-toggle-button {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
}

.status-panel-toggle-button:hover {
  border-color: var(--border-subtle);
}

.status-panel-toggle-button.expanded {
  color: var(--accent-blue);
}
\`\`\`

- [ ] **Step 3: Run the focused toggle test**

Run:

\`\`\`powershell
node --test tests/streaming-status-indicator.test.mjs
\`\`\`

Expected: PASS, with the existing three-column status panel assertions still passing and the new button assertions passing.

### Task 4: Run the complete verification suite

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: the completed app-shell CSS and toggle component.
- Produces: verified renderer build and regression-free protocol suite.

- [ ] **Step 1: Run all protocol/integration tests**

Run:

\`\`\`powershell
npm run test:protocol
\`\`\`

Expected: all existing tests pass; any intentionally skipped test remains skipped.

- [ ] **Step 2: Run the production renderer build**

Run:

\`\`\`powershell
npm run build
\`\`\`

Expected: Vite exits successfully and emits \`dist/\` without TypeScript/JSX errors.

- [ ] **Step 3: Check the final diff**

Run:

\`\`\`powershell
git diff --check
git status --short
\`\`\`

Expected: no whitespace errors; only the planned CSS, \`ContextBar\` and regression-test changes are present.

- [ ] **Step 4: Commit the implementation**

Run:

\`\`\`powershell
git add src/index.css src/components/ChatInputBox/ContextBar.tsx tests/desktop-appearance-preferences.test.mjs tests/streaming-status-indicator.test.mjs
git commit -m "fix: apply custom background across app shell"
\`\`\`

