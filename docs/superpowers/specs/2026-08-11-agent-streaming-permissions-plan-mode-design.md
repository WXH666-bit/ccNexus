# Agent 流式交互、权限与计划模式设计

## 背景

ccNexus 当前已经通过 daemon 和 persistent query 复用 Claude Agent SDK 会话，但 renderer 对每个流式事件都立即触发 React 更新，工具参数未完整解析前又不会显示工具卡片。因此，大型 `Write`/`Edit` 调用会表现为长时间没有明显进展，随后突然弹出权限窗口，批准后整份变更一次出现。

权限执行本身仍由 SDK 的 `canUseTool` Promise 阻塞：文件不会在用户批准前写入。现有问题主要是进度反馈、渲染频率和并发权限请求管理，而不是权限提前失效。

计划模式还存在协议断点：renderer 虽然包含计划审批组件，daemon/runtime 却没有发出完整的计划审批请求，`ExitPlanMode` 因而退化为普通权限弹窗；审批结果也没有携带目标权限模式，底部模式选择器不会与运行时同步。

## 目标

- 让思考、文本和工具调用进度以稳定节奏持续呈现，避免长时间静止后一次性跳变。
- 保证 `Write`、`Edit`、命令执行等工具只在对应权限 Promise 获准后执行。
- 顺序处理并发的权限、用户提问和计划审批请求，避免弹窗覆盖和后台请求悬挂。
- 接通独立的 `EnterPlanMode` / `ExitPlanMode` 生命周期。
- 用户批准计划并选择“自动模式”后，在当前轮后续工具执行前立即切换到 SDK `auto` 模式。
- 同步 daemon、主进程、renderer 和持久化偏好中的权限模式。
- 保持 persistent query 和稳定提示词前缀，不降低由 ccNexus 改动造成的缓存命中率。

## 非目标

- 不修改 Claude Code 的 `settings.json`、credentials、provider、cc-switch 或其他配置文件。
- 不伪造、固定或修饰缓存命中率；统计仍只使用真实 assistant usage。
- 不改变 Claude Agent SDK 必须先生成完整工具输入、再请求权限的时序。
- 不把一次 `Write` 改造成逐字符磁盘写入。
- 不保证冷请求、缓存过期或供应商缓存策略下的单次命中率达到 95%。
- 本设计不重新解释“完全访问模式”的安全含义，也不预先为普通会话开启完全放行能力。

## 权限模式语义

界面和 SDK 值必须一一对应：

| 界面名称 | SDK 值 | 行为 |
| --- | --- | --- |
| 默认模式 | `default` | 按 Claude Code 默认规则询问危险操作 |
| 计划模式 | `plan` | 只读分析并生成计划 |
| 接受编辑 | `acceptEdits` | 自动接受文件创建和编辑，其他危险工具仍可询问 |
| 自动模式 | `auto` | 由模型分类器判断权限请求，必要时仍可询问或拒绝 |
| 完全访问模式 | `bypassPermissions` | 跳过全部权限检查，需要明确警告和 SDK 启动许可 |

当前把 `bypassPermissions` 显示为“自动模式”的映射必须纠正。`dontAsk` 不在本次界面中暴露，因为 ccgui 当前没有对应的主要交互，用户也没有要求该模式。

## 方案选择

### 方案 A：显示通道与 SDK 控制通道分离（采用）

保持 daemon 的 AsyncStream、perpetual reader、session ID 和 persistent query 不变。流式文本只在 renderer 中按帧合并展示；权限、计划审批和模式切换通过独立控制事件处理，不写入对话内容。

`auto` 是当前 SDK 支持的动态权限模式，可以在计划审批仍阻塞于 `ExitPlanMode` 时调用 `query.setPermissionMode('auto')`。切换成功后再批准退出计划模式，使同一轮后续工具立即读取新模式，同时不重建 query。

该方案同时满足即时生效、权限正确性、流畅度和缓存稳定性。

### 方案 B：只优化 renderer

仅合并流式更新和缓存 React 组件。该方案不会影响缓存，但无法修复计划审批、模式不同步和并发权限覆盖，因此不采用。

### 方案 C：每次模式变化都重建 runtime

通过关闭并恢复会话应用新模式。实现边界较简单，但会产生不必要的 query 生命周期变化，计划批准后也无法自然地在当前轮立即继续，因此不采用。只有 `bypassPermissions` 启动许可发生变化时，才保留受控重建这一例外。

## 架构设计

### 1. Persistent query 与缓存边界

- 同一 session、workspace、provider、模型路由、`[1m]` 状态、effort、system prompt append、additionalDirectories、MCP 快照和 streaming 设置未改变时，继续复用同一个 daemon/query。
- `default`、`plan`、`acceptEdits` 和 `auto` 之间的切换使用 SDK live control，不进入 runtime signature，也不触发重建。
- `bypassPermissions` 继续作为 runtime signature 的启动位，因为 SDK 要求 `allowDangerouslySkipPermissions`；进入或离开完全访问模式时允许进行一次明确的受控重建。
- `mode_changed`、权限响应和计划审批结果是本地控制事件，不得转换为用户消息、system prompt append 或额外的 Claude 请求。
- renderer 的流式合并只改变绘制频率，不改变 daemon 接收事件、`AssistantTurn` 汇总、消息顺序或写入 Claude JSONL 的内容。

### 2. 流式呈现调度

- `useDesktopChat` 不再在每次 render 时从索引 0 返回完整历史事件队列；改为按游标增量消费，并及时释放已处理事件。
- 文本和 thinking delta 先写入 ref 缓冲区，再以 `requestAnimationFrame` 和约 33ms 最小间隔合并提交。
- 合并时保持 SDK 原始事件顺序和 content block 索引，不合并跨消息、跨 session 或跨工具的事件。
- `permission_request`、`plan_approval`、`ask_user_question`、`error`、`result` 和会话切换事件绕过流式节流，立即进入 UI。
- `MessageList`、`MessageItem`、Markdown 块和稳定工具卡片使用 memo 化；旧消息不因新 token 到达而重复解析 Markdown。
- 收到 `tool_use` block start、但参数 JSON 尚未完整时，显示“正在准备工具调用”的轻量状态。不得展示无法解析的半截 JSON，也不得提前声称工具正在执行。

### 3. 对话请求队列

- renderer 使用带 request ID、session ID 和类型的对话请求协调器，管理 permission、plan approval 和 ask-user 请求。
- 请求按到达顺序排队，同一时刻只显示一个阻塞式弹窗；重复 request ID 去重。
- 每个响应只能解析对应的 backend Promise。关闭弹窗、切换会话、abort 或窗口销毁时，必须显式拒绝或取消仍在等待的请求，不能遗留到超时。
- backend 保留按 request ID 索引的 pending map，并在响应、超时、abort、daemon 退出和 dispose 路径中清理。
- `Write`/`Edit` 权限卡片优先展示文件路径、操作类型和可计算的差异摘要，避免把完整文件内容作为巨大原始 JSON 直接铺在弹窗中。

### 4. 计划模式协议

1. daemon 为 persistent runtime 安装读取可变权限状态的 `PreToolUse` hook。
2. `EnterPlanMode` 到达时，hook 将运行时状态切换为 `plan`，允许安全进入计划模式，并向 renderer 发出权威 `mode_changed('plan')`。
3. `ExitPlanMode` 到达时，hook 创建独立 `plan_approval` 请求并等待，不走普通工具权限弹窗。
4. renderer 展示计划摘要、步骤、反馈输入和目标执行模式。目标选项包含默认模式、接受编辑和自动模式；自动模式明确说明“由模型判断权限”。
5. 用户选择自动模式并批准后，响应携带 `targetMode: 'auto'`。
6. hook 先调用当前 query 的 `setPermissionMode('auto')`，成功后更新 daemon 的 reactive mode state，再允许 `ExitPlanMode`。
7. daemon 发出权威 `mode_changed` 事件；renderer 更新底部选择器、自动模式标记和 ccNexus 自己的偏好存储。
8. 当前轮随后的工具调用读取 `auto`，由 SDK 模型分类器判断权限，无需等待下一条用户消息。

如果 live mode 切换失败，`ExitPlanMode` 不得伪装成已进入自动模式：保持计划模式、向用户显示可读错误，并允许重新选择或拒绝计划。

### 5. 完全访问模式

- “完全访问模式”单独映射到 `bypassPermissions`，不再使用“自动模式”名称。
- 入口必须展示跳过全部权限检查的明显警告。
- 该模式保留 SDK 要求的启动许可和 runtime 重建边界，不为了当前轮即时自动判断而对所有普通 runtime 预先开启完全放行能力。
- 本次“当前轮立即生效”的验收要求只针对 SDK `auto`，不把完全访问模式混入该流程。

### 6. 状态权威与持久化

- daemon/runtime 是当前会话实际权限模式的权威来源。
- renderer 选择模式后先发送控制请求；只有收到成功确认或 `mode_changed` 后才固化最终状态。
- 计划 hook、设置页和底部选择器都复用同一模式同步协议，不分别维护互相独立的真值。
- 持久化只写入 ccNexus 自己的 preference/localStorage；不写 Claude Code 配置。
- session 切换时重新读取该 session 的实际模式或回退到 ccNexus 默认偏好，过期 session 的事件不得改变当前选择器。

## 错误与安全处理

- 权限请求超过等待时限时默认拒绝，并清理 renderer 与 backend 两侧记录。
- 模式切换失败时保留旧模式，不能仅更新按钮文字。
- 并行子代理权限按队列展示；一个请求的响应不得解析另一个请求。
- 用户批准 `Write`/`Edit` 前，测试替身和真实控制路径都必须证明文件写入函数尚未执行。
- `auto` 模式仍可能产生 SDK 权限请求；此类请求继续进入正常权限队列，不能被 ccNexus 自行改为允许。
- daemon 异常退出时终止全部等待中的权限与计划 Promise，并向当前 session 发出错误和 idle 状态。

## 缓存统计与验收口径

缓存命中率继续使用真实 assistant usage：

`cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)`

验收分开记录：

- cold request；
- same-session warm short request；
- same-session warm read/write/tool request；
- 多轮会话和当日聚合命中率。

不使用 `result.usage` 替代 assistant message usage，不隐藏冷请求，不根据目标比例修改统计值。由于供应商 TTL、首次缓存创建和模型路由可影响结果，验收重点是本次改动不增加 runtime 创建次数、不改变稳定请求前缀，并且 warm 基线相较改动前无回退。

## 测试策略

### 协议与权限

- 验证 `Write`/`Edit` 在批准前没有调用写入实现，批准后只执行一次，拒绝后不执行。
- 模拟多个并发 permission/plan/ask-user 请求，确认 FIFO、去重、逐一响应和 abort 清理。
- 验证过期 session 的弹窗和响应不会污染当前会话。

### 计划与模式

- `EnterPlanMode` 更新 daemon 状态并发送 `mode_changed('plan')`。
- `ExitPlanMode` 只触发 plan approval，不触发普通 permission dialog。
- 批准并选择自动模式时，断言 `setPermissionMode('auto')` 在 ExitPlanMode Promise 获准前完成。
- 同一轮下一次工具调用读取 `auto`；底部选择器和设置页同步为自动模式。
- live control 失败时保持 plan，显示错误且不产生假状态。
- 模式列表和设置页分别验证 `auto` 与 `bypassPermissions` 的名称、说明和警告。

### 流式性能

- 高频 text/thinking delta 只按调度周期提交 UI，最终内容和原始顺序完全一致。
- 权限、计划审批和错误事件不受 33ms 节流阻塞。
- 长 `Write` 参数生成期间显示准备状态，完整参数到达后再展示权限详情。
- 已处理的 inbound 事件能够释放，长会话不会无限重复遍历完整队列。

### Persistent query 与缓存

- default/plan/acceptEdits/auto 的切换不改变 runtime signature，不增加 query 创建次数。
- auto 计划批准后复用原 session、daemon 和 query。
- 只有进入或离开 `bypassPermissions`、provider/workspace/model 等既有硬边界才重建 runtime。
- 从 Claude JSONL 按 assistant message ID 去重读取 usage，对照短请求和工具请求计算缓存命中率。

### 项目回归

- 运行聚焦的 streaming、permission、plan mode、persistent runtime、context usage 和 Claude history 测试。
- 运行 `npm.cmd run test:protocol`、`npx.cmd tsc --noEmit`、`npm.cmd run build` 和 `git diff --check`。
- 使用 ccNexus 做一次人工验证：计划模式生成计划，批准选择自动模式，确认选择器立即变化，当前轮继续执行，并在必要时由模型触发权限询问。
