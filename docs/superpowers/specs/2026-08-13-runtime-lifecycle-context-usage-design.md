# Runtime 生命周期、上下文查询与缓存稳定性设计

## 背景

ccNexus 当前采用“每个会话一个 daemon 进程、每个 daemon 一个 persistent SDK query”的架构。这个结构提供了清晰的会话隔离和跨会话并行能力，但生命周期管理存在五类问题：

1. `/context` 使用只有模型字段的临时 options 进入通用 `ensureRuntime`。当 Agent、streaming、effort、权限启动位等字段与当前对话不一致时，它可能关闭正在工作的 runtime；即使签名一致，它也可能把 permission 或 thinking 控制改成临时默认值。
2. `[1m]` 判断读取的是已经转换成 `sonnet`、`opus`、`haiku` 的 SDK 短名，因此检查短名是否包含 `[1m]` 是不可达分支。目前功能依赖 settings env 的间接判断。
3. runtime signature 已包含 SDK 模型和解析后的模型路由，正常模型变化会先触发重建，通用 `setModel` 分支因而基本不可达。
4. `runtimeSessionEpoch` 已进入签名但生产路径没有赋值，不能真正提供旧 runtime 所有权隔离。
5. 会话 daemon 没有 idle 和绝对寿命管理；同时，单纯加载历史会调用 `ensureSessionDaemon`，历史深搜可能为许多只读会话启动进程。

ccgui 提供了可参考的 registry、epoch、`/context` 快路径和回收周期，但不能原样照搬：它使用共享 daemon 的全局命令队列，跨会话工作会被串行化；其签名遗漏 MCP 快照；`[1m]` 通过临时修改 `process.env` 传递；绝对寿命判断还可能早于 active-turn 保护。

本设计采用 ccgui 已验证的生命周期思想，同时保留 ccNexus 当前的每会话隔离和跨会话并行架构。

## 用户认可的产品边界

- 会话连续闲置 30 分钟后可以关闭其 daemon 和 SDK runtime。
- runtime 创建满 6 小时后可以退休并在后续使用时重建。
- 回收后恢复会话的第一条请求可能是 cold request；该请求必须在缓存统计中单独报告，不能伪装成 warm request。
- 30 分钟 idle 或 6 小时绝对寿命不能中断正在回复、等待权限、等待计划审批、等待用户回答或正在执行工具的 Agent。
- 除上述生命周期边界、用户主动改变 runtime identity、provider/workspace 切换、abort、异常和应用退出外，配置未变化的会话不得额外重建 SDK query。
- 所有现有功能必须继续可用。排队可以改变 `/context` 在活动 turn 期间返回结果的时间，但不能禁用或丢弃该命令。

## 术语

- **daemon**：ccNexus 为一个会话启动的后台 Node.js 管理进程。
- **runtime**：daemon 内保存的 persistent SDK query 及其生命周期状态。
- **turn**：从一条用户消息开始，到本轮 Agent 结果或错误结束的完整工作周期；权限、计划审批、用户提问和工具执行都属于该 turn。
- **runtime identity**：决定一个 runtime 能否安全复用的不可变输入集合。
- **dynamic control**：SDK 允许在不重建 query 的情况下修改的权限或 thinking 等控制。
- **idle**：runtime 没有活动 turn、没有等待中的控制请求，并且距离最后一次真实使用达到指定时间。heartbeat、status、历史查看和会话列表刷新不算真实使用。
- **retiring**：runtime 已达到回收条件，但必须等待活动工作完成后才能关闭的状态。

## 目标

- `/context` 永远不打断活动 turn，也不修改当前 Agent 的模型、权限、thinking、Agent prompt、streaming 或 MCP 状态。
- 原始模型 ID、解析后的后端模型和 `[1m]` 状态有明确的数据来源，不再通过 SDK 短名猜测。
- 模型路由变化继续使用受控重建，避免对子进程启动时冻结的环境做不完整 live update。
- epoch 真正参与 host 到 daemon 的所有权校验。
- 历史查看和深搜保持纯读取，不创建 daemon。
- idle runtime 在 30 分钟后回收，runtime 最长寿命为 6 小时；活动工作永远不被计时器中断。
- 回收后按同一 session ID 和完整会话配置透明恢复，模型、Agent、MCP、权限、thinking、streaming、工具、计划模式和会话历史继续可用。
- 保持不同会话可以并行工作，不引入 ccgui 的跨会话全局串行队列。
- 缓存统计继续使用真实 assistant usage，并清楚区分生命周期回收后的 cold request 与同一 runtime 内的 warm request。

## 非目标

- 本次不把每会话 daemon 改造成单 daemon 多 runtime。
- 本次不承诺回收后的第一条请求仍命中供应商 prompt cache。
- 本次不承诺供应商 TTL、网络、服务端缓存策略或模型切换后的缓存结果。
- 本次不修改 Claude Code 的 settings、credentials、provider、cc-switch 或项目 `.claude` 内容。
- 本次不通过定时伪请求维持服务端缓存；不得为了保温额外消耗用户 token 或 API 费用。
- 本次不改变 Agent prompt、工具清单、permission 语义、thinking 语义或模型选择结果来提高缓存指标。

## 方案选择

### 方案 A：保留每会话 daemon，增加改良版 ccgui 生命周期（采用）

保留现有进程隔离和跨会话并行行为，在 host registry 与 daemon 协议中补充 runtime 状态、idle 检查、退休状态和退出清理。`/context` 只在对应会话内部排队，不阻塞其他会话。

优点是修改范围集中、与当前架构一致、功能回归风险最低。用户已经接受 30 分钟 idle 与 6 小时绝对寿命后的 cold 恢复。

### 方案 B：改成 ccgui 的单 daemon 多 runtime

该方案可减少 daemon 外壳进程，但每个 persistent SDK query 的主要状态仍然存在。它还需要重新设计故障隔离、退出恢复和并发队列，不能直接复制 ccgui 的全局串行实现。本次问题不要求承担这项架构迁移风险，因此不采用。

### 方案 C：不回收任何已使用 runtime

该方案最有利于进程内连续性，但会让使用过的会话在应用运行期间持续占用资源，与用户认可的 30 分钟和 6 小时回收策略不符，因此不采用。

## 总体架构

### 1. 继续保留每会话隔离

- 每个有实际 Agent 操作需求的 session 继续由独立 daemon 承载。
- 不同 session 拥有独立 turn 状态、控制队列和 SDK query，可以并行工作。
- host 的 `bridges` 与 `processRegistry` 共同维护 `starting`、`running`、`retiring`、`stopping`、`stopped` 状态。
- bridge 意外退出或按策略退休时，只有在 bridge identity 仍匹配当前记录的情况下才能删除 registry 项；旧进程的迟到 exit 事件不能删除新进程。

### 2. 历史读取与 daemon 激活解耦

- `sessionController.loadSession` 只加载并返回历史，不再调用 `runtime.ensureSessionDaemon`。
- `HistoryView` 深搜可以继续并发读取会话，但整个过程不得创建 bridge、daemon 或 SDK query。
- daemon 只在发送对话、执行需要 SDK runtime 的 `/context`、显式进程操作或明确的受控预热时创建。
- prompt enhancement 继续使用一次性隔离 runtime，并按现有路径在完成后立即关闭，不进入会话 idle registry。

### 3. Runtime descriptor 与 SDK options 分离

host 到 daemon 的请求分成两部分：

- `options`：只包含允许传给 Claude Agent SDK 的 query options。
- `runtimeDescriptor`：仅供 ccNexus 判断生命周期和所有权，不传给 SDK。

`runtimeDescriptor` 至少包含：

- `rawModelId`：renderer/host 接收到的原始模型 ID，可包含 `[1m]`。
- `sdkModelName`：映射后的 `sonnet`、`opus`、`haiku` 或空值。
- `resolvedModelId`：当前 provider 最终路由到的后端模型。
- `contextWindow1M`：直接从原始模型 ID 的 `[1m]` 后缀计算的布尔值。
- `runtimeSessionEpoch`：host 为当前 session daemon generation 生成的 UUID。
- `providerGeneration` 与 `workspaceIdentity`：用于诊断和边界校验的非秘密标识，不包含 API key、token 或完整凭据。

自定义 descriptor 不得混入 SDK options，以免未来 SDK 对未知字段收紧校验时破坏查询。

### 4. Runtime identity

runtime signature 继续包含真正影响缓存前缀或子进程启动条件的字段：

- cwd/workspace；
- additionalDirectories；
- systemPromptAppend/Agent prompt；
- streaming/includePartialMessages；
- runtimeSessionEpoch；
- SDK model name 与 resolved model route；
- effort；
- `contextWindow1M`；
- bypassPermissions 启动位；
- persistSession、strictMcpConfig 与 prompt-enhancement 隔离位；
- canonical MCP snapshot fingerprint。

MCP fingerprint 必须使用稳定的 key 排序和规范化序列化，避免对象插入顺序不同造成无意义重建。不得把 API key、auth token 等秘密原文写入签名日志；若将来需要识别其他启动环境变化，只能使用不泄露秘密的 provider generation 或受控摘要。

普通 `default`、`plan`、`acceptEdits`、`auto` permission，以及 SDK 支持 live update 的 thinking 值不进入不可变 signature。`bypassPermissions` 继续作为启动位。

## `/context` 设计

### 1. 同会话排队

- daemon 保留一个活动 turn；`/context` 在没有活动 turn 时立即执行。
- 活动 turn 存在时，`/context` 进入该 session 的控制队列，等待 turn 的 result、error 或 abort 清理完成。
- 只排队当前 session；其他 session 的消息与 `/context` 不受阻塞。
- permission response、plan response、AskUserQuestion response、abort、heartbeat 和 status 必须绕过 `/context` 队列，否则活动 turn 可能因拿不到控制响应而死锁。
- 多个 `/context` 请求按 FIFO 处理并分别返回结果。daemon shutdown/provider/workspace 切换时，未执行请求收到明确取消错误，不能永久悬挂。

### 2. 已有 runtime 的只读快路径

当目标 runtime 存在、未关闭，并且请求的模型路由与 `[1m]` 状态和该 runtime 一致时：

- 直接调用现有 `runtime.query.getContextUsage()`；
- 不调用通用 `ensureRuntime`；
- 不重新加载 MCP 或重建 request context；
- 不调用 `applyDynamicControls`；
- 不调用 `setModel`、`setPermissionMode` 或 `setMaxThinkingTokens`；
- 不关闭、不替换 SDK query。

这条路径保证 `/context` 只读取上下文，不污染下一轮 Agent 行为。

### 3. 需要新 runtime 的路径

以下情况允许为 `/context` 创建或重建 runtime：

- session 尚无 runtime；
- runtime 已关闭或已经按生命周期回收；
- 用户选择的 resolved model route 已变化；
- `[1m]` 状态发生变化；
- epoch/工作区/provider ownership 不匹配。

重建只能在活动 turn 结束后发生。host 保留每个 session 最近一次完整、非持久化的 runtime profile；回收后在同一次应用运行期间使用该 profile 重新调用标准 query-options builder，重新读取当前 provider 与 MCP 快照。profile 保存用户选择器和 Agent 标识，不保存或落盘 API key/token。

若应用刚启动、session 没有内存 profile，则使用当前界面选择和 host 的正常 query-options 构建路径。该行为与首次恢复会话一致，不能为了 `/context` 写入 Claude 配置。

## `[1m]` 与模型切换

### 1. `[1m]` 状态

- `contextWindow1M` 只从 `runtimeDescriptor.rawModelId` 的 `[1m]` 后缀计算。
- 删除基于 `options.model.includes('[1m]')` 的不可达判断。
- `CLAUDE_CODE_DISABLE_1M_CONTEXT` 继续作为传给 SDK 子进程的请求作用域设置，但不再作为 daemon 推测原始模型选择的唯一来源。
- 普通窗口与 `[1m]` 互相切换属于 runtime identity 变化，必须在当前 turn 完成后重建。

### 2. `setModel`

- model route 继续属于不可变 runtime identity；普通对话的模型或 provider mapping 变化使用完整重建。
- 删除或收窄通用 `applyDynamicControls` 中不可达的 `setModel` 分支。
- `/context` 不通过 live `setModel` 修改已有 runtime。目标模型和当前 runtime 不一致时，按模型切换边界安全重建。
- 这保持当前 ccNexus 的保守语义，避免 SDK 子进程启动环境已经冻结、但只修改 query 模型字段造成路由不一致。

## Epoch 所有权

- host 在创建每个 session bridge generation 时生成非空 UUID epoch。
- query、`/context`、reset 和 runtime 控制协议都携带该 epoch。
- daemon 创建 runtime 时保存 epoch；复用和控制前校验请求 epoch。
- epoch 不匹配时，旧 runtime 不能接收新请求。活动旧 turn 先按 session/channel 规则结束或取消，再清理旧 runtime。
- provider 切换、workspace 切换、新 session/reset 和 daemon 重建都会获得新 generation；epoch 不需要写入 provider-state 或 Claude 配置。
- bridge 事件必须同时匹配 session ID、bridge identity 和 epoch，防止退休 daemon 的迟到事件污染新 daemon。

## Thinking 与权限动态控制

- permission mode 继续沿用现有 live-control 规则；只有进入或离开 `bypassPermissions` 允许重建。
- `setMaxThinkingTokens` 存在时继续 live update，不进入 runtime signature。
- 方法缺失时不得静默忽略。若目标 thinking 与当前值不同，则在 turn 结束后使用完整 profile 重建，使用户选择仍然生效。
- live thinking 调用抛错时，不更新 daemon 记录的 current value；保留旧 runtime 可用状态，返回明确错误，并允许一次受控重建重试。
- `/context` 永远不应用 thinking 或 permission 控制，因此不会因为临时默认 options 改变当前 Agent。

## Idle 与绝对寿命

### 1. 时间参数

- session runtime idle timeout：30 分钟。
- absolute runtime lifetime：6 小时。
- cleanup scan interval：5 分钟。

实际 idle 回收发生在闲置约 30–35 分钟。时间从 SDK runtime 创建开始记录，不从只存在 daemon 外壳时开始计算绝对寿命。

修复历史加载后，正常的历史查看与搜索不会再产生无 runtime 的 daemon。若显式进程启动、启动失败后的恢复路径或未来受控预热仍留下 `runtime === null` 的 daemon，则它没有 persistent query 和热缓存；在没有 pending request 且 daemon 自身连续 30 分钟无活动时可以防御性关闭。该规则不是历史深搜问题的主要修复，主要修复仍是从源头禁止只读操作启动 daemon。

### 2. 真实使用时间

以下行为更新 `lastUsedAt`：

- turn 开始和 turn 事件到达；
- turn 正常结束、出错或 abort 完成；
- permission、plan approval 和 AskUserQuestion 的活动；
- `/context` 实际执行并完成；
- 成功的显式 runtime control。

以下行为不更新 `lastUsedAt`：

- heartbeat/status；
- 打开会话列表；
- 加载或搜索历史；
- 仅切换 renderer 当前选中的 session；
- cleanup scan 本身。

### 3. 回收资格

只有同时满足以下条件，30 分钟 idle 回收才可以立即执行：

- runtime 存在且未关闭；
- 没有 active turn；
- 没有等待中的 permission/plan/AskUserQuestion；
- 没有排队或执行中的 `/context`；
- 没有 host 已发送但尚未完成的控制请求；
- `now - lastUsedAt >= 30 minutes`。

若 status 查询失败、状态字段缺失或 registry 无法证明 runtime 安全空闲，本轮不回收，等待下一次扫描。

### 4. 六小时退休

- runtime 达到 6 小时时，如果完全 idle，可以立即退休。
- 如果存在 active turn 或等待中的控制交互，只设置 `retireAfterTurn`，不得关闭 query、sink 或 daemon。
- turn 和已排队的 `/context` 完成后进入 graceful shutdown。
- `retireAfterTurn` 状态下到达的新 chat/context acquisition 等待旧 bridge 退出，然后由 registry 创建新 generation 并透明重试；不得落到已经 closing 的 bridge。
- 这修正 ccgui 中绝对寿命可能优先于 active-turn 保护的问题。

### 5. Graceful shutdown 与重建

- registry 对每个 session 的 retirement 使用单一 Promise/锁，避免 cleanup、用户发送和手动停止并发关闭同一进程。
- daemon 先关闭 SDK query，再返回 shutdown 完成；超时后 bridge 才使用现有强制终止兜底。
- bridge exit 后同步清理 `bridges` 和 `processRegistry`，但保留轻量 session runtime profile，供本次应用运行期间恢复。
- 新消息或 `/context` 到达已回收 session 时，通过 session ID 创建新 daemon，使用新的 epoch 和标准 resume 路径恢复。
- 手动 Stop/Restart Process 的现有语义继续保留；手动操作不受 30 分钟计时器限制。

## 并发与状态机

每个 session daemon 使用以下状态：

```text
stopped -> starting -> running -> retiring -> stopping -> stopped
```

- 同一 session 的创建、退休和重建必须串行协调。
- 不同 session 的状态机彼此独立，可以并行执行。
- `ensureBridge` 遇到 `starting` 时等待同一个启动 Promise；遇到 `retiring/stopping` 时等待旧进程退出后再创建新 bridge。
- retirement 已开始后，旧 bridge 不再接收新 turn。
- stale message 必须通过 request ID、session ID、bridge identity 和 epoch 四层检查。

## 功能兼容性

本设计不得使以下功能变得不可用：

- 正常发送、排队发送、流式输出和 abort；
- `/new`、`/clear`、`/reset`、`/resume`、`/continue`、`/plan`、`/context`；
- Agent 选择和 system prompt append；
- 模型、`[1m]`、effort、always-thinking 和 streaming；
- `default`、`plan`、`acceptEdits`、`auto`、`bypassPermissions`；
- MCP/Skills、工具权限、计划审批和 AskUserQuestion；
- 文件变更、工具卡片、usage、历史、搜索、收藏、重命名、删除和导出；
- provider/workspace 切换；
- 会话级进程查看、停止和重启；
- 多会话并行 Agent 工作。

回收后的首次启动可以增加启动延迟，但不得丢失会话、改变配置、禁用工具或要求用户手工重建会话。

## 缓存边界与统计

缓存命中率继续使用真实 assistant usage：

`cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)`

验收必须分开报告：

- 首次 cold request；
- 同一 runtime 的 warm short request；
- 同一 runtime 的 warm read/write/tool request；
- 30 分钟 idle 回收后的 resume cold request；
- 6 小时退休后的 resume cold request；
- 后续重新变 warm 的请求；
- 多轮/当日聚合结果。

同一 runtime identity 且未达到回收边界时，`/context`、普通 permission、thinking live control、历史查看和 renderer 操作不得增加 SDK query 创建次数。回收后的第一条请求不得从统计中隐藏，也不得被标为 warm。

供应商 TTL、服务端缓存策略、模型/provider/MCP/`[1m]` 主动变化不属于 ccNexus 可以绝对控制的命中率。但代码必须证明除已批准边界外没有额外 teardown 或提示词前缀漂移。

## 错误处理

- cleanup/status 失败采用 fail-open-for-runtime：不回收当前 runtime，记录经过秘密脱敏的诊断信息。
- retirement 期间的新请求不得收到笼统的“daemon closed”后静默丢失；registry 等待并路由到新 generation。
- daemon 异常退出时，当前活动请求收到明确错误，所有 pending control Promise 被清理，registry 状态回到 stopped；下一次用户操作可正常重建。
- `/context` SDK 调用失败只影响该命令，不得关闭健康的活动会话，除非 SDK 已明确报告 runtime 不可继续使用。
- dynamic control 失败不伪装成成功，也不把本地 current state 更新为未生效值。
- 所有日志不得输出 API key、auth token、完整 provider env 或敏感 MCP 凭据。

## 测试策略

### `/context` 行为测试

- 活动 turn 期间的 `/context` 保持 pending，turn 完成后才调用 `getContextUsage`。
- 排队期间不调用 `closeRuntime`、`query()`、`setModel`、`setPermissionMode` 或 `setMaxThinkingTokens`。
- 已有匹配 runtime 时 query 创建次数保持为 1。
- Agent prompt、streaming、effort、permission 和 thinking 与临时请求字段不同时，`/context` 仍不污染当前 runtime。
- `[1m]` 或 resolved model route 真正变化时只在 turn 结束后重建。
- 多个 `/context` FIFO 返回；shutdown/切换时全部明确结算。

### 模型、`[1m]`、epoch 与 thinking

- 原始模型 `claude-…[1m]` 映射成 SDK 短名后，descriptor 仍保留 `contextWindow1M: true`。
- 普通模型与 `[1m]` 切换改变 signature；仅大小写或规范化等价输入不产生额外重建。
- resolved provider model 变化触发完整重建，generic `setModel` 不承担冻结环境的路由切换。
- 每个 bridge generation 携带非空 epoch；旧 epoch 请求和迟到事件被拒绝。
- thinking setter 缺失或失败时不静默丢弃用户选择，并验证受控重建 fallback。

### 生命周期测试

- 使用 fake clock 验证 29:59 不回收，30:00 达到资格，5 分钟扫描不会提前关闭。
- active turn、permission、plan、AskUserQuestion 和 queued `/context` 均阻止 idle 回收。
- runtime 超过 6 小时但仍 active 时只标记退休；turn 完成后才关闭。
- retirement 与新请求并发时，新请求最终进入新 bridge，旧 exit 不会删除新记录。
- 回收后 resume 使用同一 session ID、完整 profile 和新 epoch。
- daemon exit 后 bridges/process registry 无僵尸记录。

### 历史与进程测试

- 单次 `loadSession` 创建 daemon 数量为 0。
- 对 N 个会话进行历史深搜，bridge、daemon 和 SDK query 创建数量均为 0。
- 无 runtime 的 daemon 只有在没有 pending request 且连续 30 分钟无活动时才关闭；该路径不产生 SDK query teardown。
- 发送第一条消息时仍能按原协议创建 daemon。
- 进程查看、手动停止和重启继续工作。

### 缓存与功能回归

- 记录同一 identity 多轮对话的 query factory 调用次数，除批准边界外始终为 1。
- 从 Claude 原始 JSONL 按 assistant message ID 去重读取 short 与 tool request usage。
- 回收前 warm、回收后 cold、恢复后 warm 分开报告，不修改分母或隐藏样本。
- 覆盖 normal chat、Agent、MCP、permissions、plan、AskUserQuestion、streaming、thinking、`[1m]`、provider/workspace 和 session resume。
- 运行 `.agents/AGENTS.md` 规定的缓存聚焦测试、完整 protocol tests、TypeScript 检查、构建和 `git diff --check`。

## 文档与规则同步

实施时需要同步更新 `.agents/AGENTS.md` 的 persistent query 硬性规则，明确以下两个经用户批准的额外重建边界：

- session runtime 连续 idle 30 分钟；
- runtime 达到 6 小时绝对寿命，并且活动 turn 已安全完成。

规则仍须强调：这两个边界以外，同一 runtime identity 必须复用；回收后的请求按 cold request 单独报告；不得中断 active turn。

## 实施顺序

1. 先补行为测试，复现 `/context` 并发关闭/动态控制污染、历史加载启动 daemon 和 epoch 空值。
2. 引入 descriptor、非空 epoch 和稳定 signature，不改变现有正常发送行为。
3. 实现 `/context` 同会话排队与只读快路径。
4. 移除历史加载的 daemon 激活。
5. 实现 registry/bridge 退休状态、30 分钟 idle 和 6 小时 retire-after-turn。
6. 完善 thinking fallback、bridge exit 清理和 profile 恢复。
7. 更新 AGENTS 规则，运行完整自动化与真实缓存验收。

每一步都必须保持可验证；如果出现功能回归、未批准的 query 重建或活动 turn 中断，则停止推进并修复，不能用后续步骤掩盖问题。
