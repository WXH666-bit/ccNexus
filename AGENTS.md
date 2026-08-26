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

## Renderer 资源路径与打包兼容

- renderer 不得使用 `/xxx` 形式的根路径资源引用（例如 `/ccnexus-logo.png`）。Electron 打包后通过 `file://` 加载 renderer，根路径会解析到磁盘根目录并导致资源破图。
- renderer 静态资源必须使用相对路径（例如 `./ccnexus-logo.png`）或 `import.meta.env.BASE_URL`；新增或修改资源时必须确认资源会被复制到 `dist/`，并同时验证 Vite 开发环境和 Electron 打包加载路径。
- Electron 主进程资源必须使用基于 `__dirname` 的 `path.resolve(...)`；renderer 不得绕过 preload 直接访问文件系统。

## ccgui 对齐

- ccgui 已实现的行为优先复用其生命周期、状态边界和数据流，不要因为 React 写法不同而重新发明协议。
- 会话切换必须先使旧请求失效，再清理 transient state，同时设置新的 session ID 和标题，最后加载历史。
- 历史响应、SDK 事件、usage、工具输出和权限事件必须校验 session ID；过期响应不得修改当前会话。
- 当前工作区是会话、历史、搜索、重命名、收藏、删除、导出、文件和进程操作的边界。
- 当前工作区的上次活动会话保存在 ccNexus 自己的 `.ccnexus/desktop-state.json`，不存在时才回退到最近活动会话。
- Claude JSONL 可读时是历史权威来源；只有 Claude 历史缺失或不可读时才使用 ccNexus 缓存。
- provider、模型、思考强度、权限模式和 `[1m]` 等运行时选择必须通过请求或运行时作用域传递，不得写入 Claude 配置。MCP/Skills 管理页是已授权的例外，只能写入其自身负责的 Claude Code MCP/Skills 数据。
- 供应商切换要参考 ccgui 的运行时供应商列表，包含 `__local_settings_json__` 和 `__cli_login__` 两个特殊模式；切换状态只写入 `.ccnexus/provider-state.json`，选择后停止旧 runtime 并从新会话开始。
- CLI 登录模式必须清除继承的 API key、auth token 和 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`，让 Claude Code 使用自己的登录态；本地 `settings.json` 模式只读并校验 JSON，不能由 ccNexus 回写。
- `/new`、`/clear`、`/reset`、`/resume`、`/continue`、`/plan` 和 `/context` 等本地命令必须按现有桌面 IPC/SDK 数据流处理。

## 编辑变更状态

- 文件变更必须按 ccgui 的 `useFileChangesManagement` / `useFileChanges` 思路实现。`保留全部` 不是临时清空 React 状态，而是将当前会话消息长度记录为基线，只展示基线之后的新变更。
- 单文件或批量撤销只有在 `undo_complete` 成功且带有 `filePath` 时，才记录为已处理文件；变更列表必须按会话基线和已处理文件重新派生。
- 基线和已处理文件按 session ID 隔离，并在会话切换、renderer 重挂载和历史恢复时恢复，不能让旧会话的撤销事件或历史响应污染当前会话。

## Claude 配置安全

- cc-switch 的作用边界是修改 Claude Code 的 `settings.json`；ccNexus 只读取 Claude Code `settings.json` 作为本地设置 provider 的输入，不得读取、解析、监控或依赖 cc-switch 自身的配置文件，也不得根据 cc-switch 的内部存储结构新增适配。
- 除 MCP/Skills 管理页明确授权的操作外，永远不要修改、重写、删除或迁移 Claude Code 配置、provider 文件、凭据、MCP 配置或项目 `.claude` 内容。
- MCP/Skills 管理页可以按 ccgui 的受限写入边界修改 Claude Code MCP 配置和 Skill 文件；不能触碰 cc-switch、provider、OAuth 凭据或其他无关配置。
- 测试和诊断默认只读；只有覆盖 MCP/Skills 写入行为的测试才可以在隔离临时目录中写入模拟配置。
- 诊断文件必须放在 Claude 配置路径之外的临时目录，并在任务结束前清理。

## MCP/Skills 配置写入边界

- MCP 添加、编辑、删除和启用/禁用必须保留 Claude 配置中的无关字段，按 ccgui 规则更新 `~/.claude.json` 及需要同步的 `~/.claude/settings.json`；不得写入 cc-switch 配置。
- Skills 添加、删除和启用/禁用只能作用于 Claude Code 的 Skills 目录及其受控管理目录；不得把操作扩展到 Codex、provider 或凭据目录。
- 所有写入都必须校验服务器 ID、Skill 名称和路径，拒绝路径穿越；采用临时文件/原子替换或可恢复的移动策略，避免半写入状态。
- 写入操作必须从主进程受控 IPC 进入，并在界面上提供明确的确认、成功/失败反馈；renderer 不得直接写文件。
- 写入 MCP/Skills 后必须刷新列表和 runtime 输入快照；不能让旧配置继续静默作用于新对话。
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

## 最近确认的 Renderer 外观约束

- 自定义背景属于整个 ccNexus 应用壳层：背景图和遮罩必须由 `.app-root::before` / `.app-root::after` 渲染，不能重新放回 `.chat-main::before` / `.chat-main::after`。聊天、历史、设置、文件区、输入区和状态区等主表面需要保持透明或半透明，让背景可以透出；背景状态仍然只能写入 ccNexus 自己的 `.ccnexus` 数据。
- 状态面板的任务、子代理、编辑逻辑继续由 `ChatView` 和 `StatusPanel` 管理。输入框上下文栏的总开关使用 `status-panel-toggle-button`，收起显示 `ChevronUp`，展开显示 `ChevronDown`，并同步 `aria-expanded`；不要恢复旧的 `.status-panel-toggle` 容器样式或 `Layers` 图标。
- 这两类 UI 改动至少需要运行 `node --test tests/desktop-appearance-preferences.test.mjs tests/streaming-status-indicator.test.mjs`、`npm.cmd run test:protocol`、`npx.cmd tsc --noEmit`、`npm.cmd run build` 和 `git diff --check`。

## 对话缓存与持久 Query（硬性规则）

- 对话必须复用 ccgui 的 persistent query 生命周期：同一 `sessionId`、workspace、模型路由、`[1m]` context 状态、effort、system prompt append、additionalDirectories、MCP 快照和 streaming mode 未改变时，复用同一个 SDK query/daemon，不得每轮重新创建 query。
- `desktop/daemon/ccnexus-daemon.js` 的 `AsyncStream`、perpetual reader、turn sink 和 runtime signature 是缓存稳定性的核心。修改前必须先对照 `_ccgui/ccgui-src/ai-bridge/services/claude/runtime-lifecycle.js` 和 `persistent-query-service.js`。
- 只有真正改变缓存前缀或进程启动条件的变化才允许重建 runtime：workspace/cwd、system prompt append、additionalDirectories、MCP 配置、模型路由、`[1m]` context state、effort、streaming mode、provider/runtime epoch、bypass permission launch bit 等。普通 permission mode、thinking level 等控制应优先使用 SDK live control。
- provider 切换、workspace 切换、abort、runtime/query error 可以清理旧 runtime；清理必须有明确的 session/channel 边界，不能让 stale event 进入新会话。
- 缓存率只能用真实 assistant usage 计算，不能使用 `result.usage` 或 React 估算值：
  `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)`。
- 验收必须分开报告 cold request、same-session warm short request、same-session warm read/write/tool request 和 aggregated history/day rate。冷启动、缓存 TTL、模型切换以及供应商缓存策略不应被伪装成稳定的热缓存命中率。
- 热缓存连续请求低于 95% 时，先检查 query 是否被重建、runtime signature 是否漂移、请求是否改变了缓存前缀，以及原始 JSONL usage；不得为了达到 95% 修改分母、隐藏冷请求或套用固定比例。
- 诊断必须读取 Claude 原始 JSONL 的 assistant message usage，并按 message id 去重；至少包含一条短请求和一条读写/工具请求。`result.usage` 只能作为辅助诊断，不能替代 assistant message usage。
- Timer-based runtime retirement is allowed only after 30 minutes of true session inactivity or after 6 hours of runtime lifetime. Six-hour retirement must wait for the active turn and queued control work to finish.
- A request after approved retirement is a cold request and must be reported separately. Outside approved retirement and existing hard identity/error boundaries, an unchanged session must keep the same SDK query.
- History loading and search must not start a daemon or SDK query. `/context` must queue behind its session's active turn and must use a read-only fast path when model route, `[1m]`, and epoch still match.

## 外观设置与 ccNexus 自有持久化（硬性规则）

- 主题、标题栏颜色和自定义背景只允许写入 ccNexus 自己的 `.ccnexus` 目录，例如 `appearance.json` 和 `chat-background`；不得写入 Claude Code 的 `settings.json`、credentials、MCP 配置或 cc-switch provider 文件。
- 自定义背景必须由主进程通过受控 IPC 选择、校验并复制到固定的 ccNexus 路径；renderer 不得直接访问文件系统，也不得把用户原始路径写入 CSS 或持久化状态。
- 外观启动顺序必须是：主进程加载 ccNexus appearance state → 窗口和原生 titlebar 使用初始主题 → renderer 通过 preload 同步。不能让 renderer 的 fallback localStorage 覆盖主进程设置。
- 图片缺失、格式错误或设置损坏必须安全回退到默认外观，不得阻止应用启动。

## 缓存与外观变更后的验证

- 缓存相关改动至少运行：
  `node --test tests/context-usage.test.mjs tests/claude-history.test.mjs tests/assistant-turn.test.mjs tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/query-options.test.mjs tests/desktop-usage-statistics.test.mjs`
- 仍需按项目既有验证要求运行 `npm.cmd run test:protocol`、`npx.cmd tsc --noEmit`、`npm.cmd run build`；另外运行 `git diff --check` 检查补丁格式。

没有运行成功的验证命令必须在交付说明中明确报告，不能用未验证的结论代替测试结果。

## Agent 权限、计划与流式交互边界

- permission mode 必须区分 `default`、`plan`、`acceptEdits`、`auto` 和 `bypassPermissions`。`auto` 是由模型/Claude Code 判断单次操作是否允许的普通运行时模式；`bypassPermissions` 才是完全访问模式，并且是唯一需要重建 runtime 的启动位变化。
- `EnterPlanMode` 和 `ExitPlanMode` 通过 daemon 的 `PreToolUse` hook 处理。计划审批必须经 renderer 返回 `requestId`、`approved` 和目标执行模式；批准后先调用 SDK live `setPermissionMode`，再放行原工具输入，并发出 `mode_changed`。
- `AskUserQuestion` 不得加入无条件放行列表。它必须通过 `canUseTool` 返回带 `answers` 的 `updatedInput`；多个问题和多个阻塞对话请求必须 FIFO 展示、可取消、可超时，不能用后来的问题覆盖前一个问题。
- daemon 的 persistent query、AsyncStream、perpetual reader 和 turn sink 不得因为普通权限切换或 renderer 批处理而重建。renderer 可以将高频 `stream_event` 按约 50ms 合并唤醒，但 `assistant`、`result`、权限、计划、询问和模式变更事件必须优先刷新且保持顺序。
- 权限、计划和询问事件必须携带稳定 request id，并在 session/channel 边界检查后再更新当前 ChatView；stale event 不得污染新会话。

## 发布产物命名与更新元数据（硬性规则）

- electron-builder 必须通过 `build.artifactName` 固定 Windows 安装包名称模板：`${productName}-Setup-${version}.${ext}`。当前产品的安装包应为 `ccNexus-Setup-<version>.exe`，不得依赖 electron-builder 默认的点号命名。
- `latest.yml` 中的 `files[].url` 和顶层 `path` 必须与实际上传的 `.exe` 文件名完全一致；文件名不一致会让旧版本更新器请求错误 URL 并返回 404。
- 每个稳定版本 Release 必须同时包含匹配的 `.exe`、`.exe.blockmap` 和 `latest.yml`。`.blockmap` 与 `latest.yml` 是更新器使用的辅助文件，用户只需下载 `.exe`。
- GitHub Actions 发布前必须校验 `latest.yml` 指向的安装包和对应 `.blockmap` 确实存在；禁止手动重命名已经生成的安装包后再上传。
- 发布时 `package.json` 的版本、Git 标签 `v<version>`、`latest.yml` 的版本和 Release 名称必须一致；修改命名或更新流程后必须重新构建并验证 Release 资产。
