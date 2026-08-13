# ccNexus

ccNexus 是一个面向 Windows 的 Electron 桌面客户端，用于操作 Claude
Code。它提供聊天、会话历史、工作区文件、进程管理、供应商模式、权限控制、
MCP/Skills 管理和用量统计等功能。

## 架构

ccNexus 仅支持桌面模式，不提供独立的浏览器界面、Express broker 或
WebSocket broker。

```text
Electron 主进程
  ├─ BrowserWindow + 原生标题栏
  ├─ preload.cjs contextBridge
  └─ desktop/runtime/
       └─ daemonBridge.js
            └─ desktop/daemon/ccnexus-daemon.js
                 └─ Claude Agent SDK 持久化 query

React/Vite renderer
  └─ window.ccNexusDesktop 类型化 IPC API
```

- `desktop/main.js` 负责 Electron 生命周期、窗口、托盘、菜单、更新和 IPC
  handler。
- `desktop/preload.cjs` 只暴露经过审核的 `window.ccNexusDesktop` API。Renderer
  不能直接访问 Node.js、文件系统、子进程或 Claude SDK。
- `desktop/runtime/` 负责工作区、会话、文件、供应商、进程、提示词增强和聊天
  控制。
- `desktop/daemon/` 通过 NDJSON 协议运行持久化的 Claude Agent SDK query 进程。
- `src/` 是由 Electron 加载的 React/Vite renderer。
- `server/` 只包含桌面运行时复用的 Claude 历史、协议、请求选项和工具辅助
  模块，不是独立的服务器入口。
- `_ccgui/ccgui-src` 是行为和数据流的本地参考实现。

## 主要功能

- 流式聊天、图片附件，以及按工作区隔离的会话历史、搜索、收藏、重命名、删除和导出。
- 模型、Agent、思考强度、权限模式、流式输出和长上下文模式控制。
- 项目文件浏览、AI 文件变更跟踪与撤销，以及相关 Node.js 进程管理。
- Claude Code CLI 登录、本地设置与供应商切换，以及受控的 MCP/Skills 管理。
- 上下文用量、Token、成本和缓存统计，以及任务、工具调用与权限状态展示。
- 原生 Windows 标题栏、系统托盘、主题、自定义背景和应用更新。

## 环境要求

- Windows
- Node.js 20 或更高版本
- pnpm
- 已安装并完成认证的 Claude Code CLI

## 开发

安装依赖，并同时启动 Vite renderer 和 Electron：

```powershell
pnpm install
pnpm desktop:dev
```

开发模式下，renderer 由 `http://127.0.0.1:5000` 提供并由 Electron 加载。
如果只启动 Electron 主进程，需要先在另一个终端启动 Vite：

```powershell
pnpm exec vite --port 5000 --host 127.0.0.1
pnpm desktop:host
```

直接调试 daemon：

```powershell
pnpm desktop:daemon
```

## 验证

根据修改范围先运行聚焦测试，再运行完整协议测试、类型检查、构建和补丁格式
检查：

```powershell
node tests\context-usage.test.mjs
node tests\claude-history.test.mjs
node tests\assistant-turn.test.mjs
node tests\chat-protocol.test.mjs
node tests\chat-view-session-restore.test.mjs
node tests\desktop-chat-ipc.test.mjs
node tests\desktop-session-ipc.test.mjs
node tests\desktop-config-ipc.test.mjs
node tests\desktop-usage-statistics.test.mjs
node tests\markdown-table.test.mjs
node tests\file-changes-management.test.mjs
node tests\desktop-titlebar.test.mjs

pnpm test:protocol
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

测试使用 Node.js 原生 test runner，位于 `tests/` 目录。需要模拟 Claude 配置
的测试和诊断必须使用隔离的临时目录，不要写入真实用户配置目录。

## 打包

```powershell
pnpm desktop:pack
pnpm desktop:dist
```

`desktop:pack` 生成未打包的 Windows 应用，`desktop:dist` 生成 NSIS 安装包，
输出位于 `release/`。Windows 安装包必须使用
`ccNexus-Setup-<version>.exe` 命名；更新元数据和对应的 `.exe.blockmap` 也必须
使用完全一致的文件名。

## 项目规范

- 保持 preload IPC 边界足够窄，Renderer 的能力必须通过
  `window.ccNexusDesktop` 使用。
- Claude 配置、供应商文件、凭据、OAuth 数据和项目 `.claude` 内容默认只读。
  MCP/Skills 管理是受控例外，写入时必须保留无关字段并校验路径。
- 保持会话和工作区隔离，拒绝来自旧会话的历史、SDK、usage、权限和工具事件。
- 除非真实的 runtime signature 或进程启动条件发生变化，否则复用 daemon 的
  持久化 SDK query。
- 上下文和缓存计算必须使用真实 assistant usage，不能用聚合的 result usage 或
  renderer 估算值替代。
- 修改聊天、会话、输入、usage、进程、权限或状态行为前，先检查对应的
  `_ccgui/ccgui-src` 实现。
