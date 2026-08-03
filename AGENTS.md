# ccNexus 开发规则

## 产品形态

- ccNexus 是 Electron 桌面应用。React 只负责渲染界面；Claude Code SDK 进程、会话守护进程、IPC 和持久化都属于桌面运行时。
- 本地 Web 页面只作为 Electron 使用的渲染界面保留。不要重新扩展已经移除的 Web broker 架构，也不要增加第二套运行时路径。
- 桌面行为是唯一事实来源。一个功能只有在渲染状态、IPC 契约、运行时所有权、持久化和重启行为一致时才算完成。

## ccgui 对齐规则

- 修改运行时或聊天行为前，必须先检查 `_ccgui/ccgui-src` 中对应的实现。
- ccgui 已有的行为必须优先照搬它的架构和控制流：持久化查询、每会话守护进程所有权、请求上下文、模型和思考强度覆盖、sidechain 历史、usage 处理、输入历史、本地斜杠命令和实时进程快照。
- 优先对 ccgui 的代码和数据流做最小适配，不要因为 React 可以近似实现就另造协议或逻辑。
- 底部状态栏必须与 ccgui 对齐：一个锚定在完整状态栏上方的 Popover，任务/子代理/编辑三个 Tab，结构化行项目，点击外部和 Escape 关闭，实时子代理详情，文件打开/变更/撤销操作，以及当前工作区范围限制。
- 查看文件变更时，统计必须使用有界缓存和大文件保护；完整 diff 只能在用户展开对应文件后生成，不能在整个状态栏渲染期间预先计算。

## Claude 配置安全

- 永远不要写入、重写、删除或迁移 Claude Code 设置、provider 文件、凭据、MCP 配置或项目 `.claude` 配置。
- 测试和诊断可以读取 Claude 配置及项目状态，但不得写入这些位置。诊断文件必须放在 Claude 路径之外的临时目录，并在结束前删除。
- 模型、思考强度、provider、权限模式和 `[1m]` 等运行时覆盖，必须像 ccgui 一样通过会话请求或进程环境传递，不得写入 Claude 配置。
- `[1m]` 会改变运行时身份。不能把它静默应用到已经运行且不兼容的会话，必须像 ccgui 一样创建或重启兼容运行时。

## 会话与工作区

- 当前工作区是隔离边界。会话列表、历史搜索、选择、重命名、收藏、批量删除、导出、文件操作、sidechain 读取和进程控制都必须限定在当前工作区。
- 当前工作区存在且可读时，优先使用 Claude JSONL 历史；只有 Claude 历史缺失或不可读时，才使用 ccNexus 自有缓存作为后备。
- 过期会话响应不能修改当前聊天。切换工作区、会话或 Tab 时，应清除草稿、usage、状态行和 sidechain 详情。
- 每个会话保持一个持久运行时所有者。工作区、模型身份、provider 或长上下文设置不兼容时，不能复用原守护进程。
- `/new`、`/clear`、`/reset`、`/resume`、`/continue`、`/plan` 和 `/context` 在 ccgui 视为本地命令时，也必须在本地处理；其他提示词通过桌面聊天 IPC 发送。

## Usage 与缓存指标

- 上下文占用使用权威 assistant usage：
  `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`。
- 上下文条只接受 `assistant.message.usage`。一次工具循环中的 `result.usage` 可能聚合多个 API 调用，不能替代 assistant 消息的上下文快照。
- 缓存命中率是独立指标：
  `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)`。
- 必须把实时 assistant usage 保存在消息和持久化 JSONL/缓存记录中，确保刷新和重新加载会话后上下文值一致。
- `/context` 必须通过桌面 IPC 请求会话守护进程，再调用 Claude SDK 的 `query.getContextUsage()`。`totalTokens`、模型上限、分类数据、MCP 工具、agents、memory 文件、skills 和自动压缩状态都必须直接传递，不能在 React 中合成分类百分比。
- 诊断缓存时，必须记录 Claude JSONL 中的原始 assistant usage，并与界面指标对比。至少测试一次短请求和一次读写或工具请求，不能把工具循环聚合值误当成单个上下文快照。
- 冷启动、provider 缓存过期或运行时身份变化可能导致单次命中率降低；不得用错误的上下文公式或伪造数据把它显示成高命中率。

## 运行时与界面

- Node 进程管理遵循 ccgui 的实时快照行为：子菜单打开时持续刷新，终止或重启 daemon/channel 前进行确认，并允许直接清理孤儿进程。
- 只读 sidechain 历史 IPC 必须校验 session 和 agent 标识，只能读取当前工作区的 Claude 项目目录，容忍损坏 JSONL，且绝不写入历史。
- 聊天输入必须遵循 ccgui：有上限的本地输入历史、ArrowUp/ArrowDown 草稿导航、IME 安全提交、粘贴与附件处理，以及受控 contenteditable 同步。
- 文件打开、变更、撤销、权限、计划审批、工具输出、思考块、消息锚点、历史和设置交互都必须感知工作区；ccgui 支持键盘关闭的地方也要支持键盘关闭。
- 不要覆盖脏工作区中与当前任务无关的用户修改。编辑范围应限于请求的行为，并保持现有项目约定。

## 桌面检查

- 使用 Computer Use 时，先检查当前窗口再操作，避免破坏性动作；验证结束后必须最小化 ccNexus。若打开了 PyCharm 或 ccgui，也必须最小化它们。
- 不要用关闭应用代替最小化，也不要在测试期间修改 Claude 配置。

## 验证命令

先运行聚焦测试，再运行协议、类型和构建检查：

```powershell
node tests\context-usage.test.mjs
node tests\claude-history.test.mjs
node tests\assistant-turn.test.mjs
node tests\chat-protocol.test.mjs
node tests\desktop-chat-ipc.test.mjs
node tests\desktop-session-ipc.test.mjs
node tests\desktop-config-ipc.test.mjs
node tests\desktop-usage-statistics.test.mjs
node tests\desktop-subagent-history.test.mjs
node tests\diff-performance.test.mjs
node tests\model-resolution.test.mjs
node tests\query-options.test.mjs
node tests\status-panel-parity.test.mjs
npm.cmd run test:protocol
npx.cmd tsc --noEmit
npm.cmd run build
```

- 必须报告任何未能运行的验证命令。没有证据就不能声称修复完成或已经完全对齐。
