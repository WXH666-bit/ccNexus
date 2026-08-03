# ccNexus 开发规则

## 当前架构

- ccNexus 是 Electron 桌面应用，不再维护独立的浏览器产品或 Web broker。
- `desktop/main.js` 负责 Electron 生命周期、窗口、菜单、IPC 注册和桌面运行时组装。
- `desktop/preload.cjs` 只暴露经过审核的窄 IPC API。Renderer 不得直接访问 Node.js、文件系统或 Claude SDK。
- `desktop/runtime/` 负责工作区、会话、文件、provider、进程和聊天控制器。
- `desktop/daemon/` 负责运行 Claude Agent SDK 查询和会话守护进程。
- `src/` 是 Electron 加载的 React/Vite renderer。Vite 开发服务器只用于本地桌面开发加载 renderer。
- Electron 窗口使用 `titleBarStyle: 'hidden'` 和 `titleBarOverlay` 保留原生窗口按钮；renderer 必须保留 `.window-drag-region` 与 `env(titlebar-area-height)` 顶部占位/拖拽区域，不能让内容覆盖系统按钮或恢复白色默认标题栏。
- `server/` 只包含桌面运行时复用的协议、Claude 历史、请求选项和工具辅助模块，不得恢复为独立 HTTP/WebSocket broker。
- `_ccgui/ccgui-src` 是行为和架构参考。修改聊天、会话、输入、usage、进程或状态栏前，必须先检查对应实现。

## ccgui 对齐

- ccgui 已实现的行为优先复用其生命周期、状态边界和数据流，不要因为 React 写法不同而重新发明协议。
- 会话切换必须先使旧请求失效，再清理 transient state，同时设置新的 session ID 和标题，最后加载历史。
- 历史响应、SDK 事件、usage、工具输出和权限事件必须校验 session ID；过期响应不得修改当前会话。
- 当前工作区是会话、历史、搜索、重命名、收藏、删除、导出、文件和进程操作的边界。
- 当前工作区的上次活动会话保存在 ccNexus 自己的 `.ccnexus/desktop-state.json`，不存在时才回退到最近活动会话。
- Claude JSONL 可读时是历史权威来源；只有 Claude 历史缺失或不可读时才使用 ccNexus 缓存。
- provider、模型、思考强度、权限模式和 `[1m]` 等运行时选择必须通过请求或运行时作用域传递，不得写入 Claude 配置。
- `/new`、`/clear`、`/reset`、`/resume`、`/continue`、`/plan` 和 `/context` 等本地命令必须按现有桌面 IPC/SDK 数据流处理。

## 编辑变更状态

- 文件变更必须按 ccgui 的 `useFileChangesManagement` / `useFileChanges` 思路实现。`保留全部` 不是临时清空 React 状态，而是将当前会话消息长度记录为基线，只展示基线之后的新变更。
- 单文件或批量撤销只有在 `undo_complete` 成功且带有 `filePath` 时，才记录为已处理文件；变更列表必须按会话基线和已处理文件重新派生。
- 基线和已处理文件按 session ID 隔离，并在会话切换、renderer 重挂载和历史恢复时恢复，不能让旧会话的撤销事件或历史响应污染当前会话。

## Claude 配置安全

- 永远不要修改、重写、删除或迁移 Claude Code 配置、provider 文件、凭据、MCP 配置或项目 `.claude` 内容。
- 测试和诊断可以读取配置和项目状态，但不能写入配置。
- 诊断文件必须放在 Claude 配置路径之外的临时目录，并在任务结束前清理。
- 文件树的保护规则必须继续禁止修改 `.claude`、`.codex`、`.git` 和 `node_modules` 等受保护内容。

## 持久化边界

- 工作区状态、活动会话 ID、会话索引和运行时缓存写入 ccNexus 自己的 `.ccnexus` 目录；renderer-only UI 状态（例如聊天偏好、上下文显示、Keep All 基线和已处理文件）可以使用 ccNexus 自己的 renderer `localStorage`，但绝不能写入 Claude 配置。
- 会话索引按工作区隔离。切换工作区时停止旧运行时、清理旧 transient state，并重新加载新工作区的会话。
- 删除、重命名、收藏和导出必须使用当前工作区的 session ID，并保持 Claude JSONL 只读原则。
- 持久化失败不能阻止打开工作区或继续聊天，但必须保留内存中的正确状态。

## Usage 与上下文

- 上下文占用使用权威 assistant usage：
  `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`。
- 上下文百分比必须优先来自 Claude SDK 的 `query.getContextUsage()` 和真实 assistant usage，不得在 React 中猜分类或合成百分比。
- `result.usage` 可能聚合工具循环中的多次 API 调用，不能代替 assistant message usage。
- 缓存命中率独立计算为：
  `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)`。
- 诊断缓存时必须对照 Claude JSONL 的原始 assistant usage，至少检查一次短请求和一次读写或工具请求。

## UI 与运行时

- Markdown 使用 GFM 解析；表格、代码块、思考块、工具卡片和权限卡片的视觉行为应与 ccgui 对齐。
- 顶部标题栏必须保持与应用主题一致，并保留可拖拽区域和原生最小化、最大化、关闭按钮；不得用普通内容层覆盖 `titleBarOverlay` 的窗口控制区。
- 编辑状态栏的文件变更、撤销和保留全部必须使用会话持久化基线，不能只依赖当前挂载的 ChatView 内存状态。
- Node 进程管理使用实时快照，终止、重启和孤儿进程清理必须有明确的 session/channel 边界。
- 任何桌面操作都要保留错误状态、加载状态和 stale-event 防护。
- 使用 Computer Use 验证结束后必须最小化 ccNexus；如果打开 PyCharm 或 ccgui，也必须最小化它们。

## 验证命令

Windows 下先运行聚焦测试，再运行完整协议测试、类型检查和构建：

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
npm.cmd run test:protocol
npx.cmd tsc --noEmit
npm.cmd run build
```

没有运行成功的验证命令必须在交付说明中明确报告，不能用未验证的结论代替测试结果。
