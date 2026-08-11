# 智能体管理设计

## 目标

在不修改 Claude Code `settings.json`、Claude Code 原生智能体文件或 cc-switch 配置的前提下，为 ccNexus 增加与 ccgui 对齐的智能体管理能力：读取、选择、新增、编辑、删除、导入和导出。

## 现状与边界

- Claude Code 原生智能体来自当前项目 `.claude/agents/*.md` 和用户目录 `~/.claude/agents/*.md`。
- 这些原生文件只作为兼容来源：可以读取、显示和选择，但不能由 ccNexus 设置页编辑或删除。
- ccNexus 自己维护的智能体存放在 Windows 用户目录下的 `~/.ccnexus/agent.json`，不使用 ccgui 的 `~/.codemoss/agent.json`，避免两个应用互相覆盖配置。
- 运行中的子代理状态仍由会话状态面板负责，不与“智能体管理”混合。

## 数据格式

`~/.ccnexus/agent.json` 使用 ccgui 的对象映射结构，并保留版本字段：

```json
{
  "version": 1,
  "selectedAgentId": "writer",
  "agents": {
    "writer": {
      "id": "writer",
      "name": "Writer",
      "prompt": "You are a careful technical writer.",
      "createdAt": 1730000000000
    }
  }
}
```

约束：`id` 是稳定且安全的文件/配置键；名称必填；提示词允许为空；创建和更新不能修改 `id` 与 `createdAt`。不存在或损坏的文件按空配置处理，并在保存时使用原子替换避免半写入。

## 架构与数据流

### 持久化服务

在 `LocalConfigService` 中增加独立的 ccNexus agent store，负责：

- 读取和规范化 `agent.json`；
- 列出 ccNexus 管理的智能体；
- 创建、更新、删除和读取单个智能体；
- 保存当前选择；
- 生成和解析导入导出数据。

现有 `.claude/agents/*.md` 读取逻辑保留，但需要给列表项标记 `source: 'claude'`；`agent.json` 项标记 `source: 'ccnexus'`。名称或 ID 冲突时，ccNexus 项优先用于选择和运行，原生项仍保留为只读记录时应避免重复展示。

### Desktop IPC

沿用现有 preload → `desktopBridgeApi` → `desktop/main.js` → `LocalConfigService` 分层，增加明确的 agent API：

- `getAgents`
- `saveAgent`
- `deleteAgent`
- `setSelectedAgent`
- `exportAgents`
- `importAgents`

所有写入操作只允许落在 `~/.ccnexus/agent.json`，不接受外部路径作为写入目标。导入采用 ccgui 的冲突策略：跳过、覆盖、生成新 ID；导出只输出 ccNexus 管理的智能体。

### 设置界面

把当前只读 `AgentSection` 改为 ccgui 风格：

- 顶部提供新增、导入、导出和刷新；
- ccNexus 智能体卡片提供编辑、删除菜单；
- Claude Code 原生智能体显示“Claude Code 原生 / 只读”标记，不出现编辑和删除操作；
- 新增和编辑共用表单弹窗；删除必须二次确认；
- 写入失败、冲突和导入结果通过现有 toast/错误展示反馈。

### 聊天框与运行时

- 聊天框选择器使用统一的合并列表，不再只依赖本地 `selectedAgent` 字符串。
- 当前选择保存到 `agent.json`，同时用 React 状态立即更新界面。
- 运行时通过统一的 `loadAgent` 读取 ccNexus agent 的 `prompt`；Claude Code 原生 agent 继续读取 Markdown 内容。
- 发起请求时只传递选择的 agent ID，提示词解析集中在请求上下文层，避免把管理逻辑放入 `chatController`。

## 错误处理

- 读取目录不存在：返回空列表，不弹错误。
- `agent.json` 不存在：创建默认空结构。
- JSON 损坏：保留损坏文件副本，使用空结构并提示用户恢复/重置。
- 名称或 ID 非法、重复：在保存前校验并返回可读错误。
- 删除当前选中项：删除后同步清除 `selectedAgentId`。
- IPC 或文件操作失败：不更新前端成功状态，显示失败原因。

## 测试策略

先为 `LocalConfigService` 的真实临时目录行为添加测试，覆盖：空文件初始化、列表、创建、更新、删除、选择持久化、路径隔离、冲突处理和损坏 JSON。随后为 IPC bridge 和设置组件增加行为测试，确认：

- 原生 Claude Code agent 可见但没有编辑/删除操作；
- ccNexus agent 可新增、编辑和删除；
- 选择项在重启/重新加载后从 `agent.json` 恢复；
- 运行时加载到正确的 prompt；
- 写入不会触碰 `settings.json`、`.claude/agents` 或 cc-switch 状态。

## 不在本次范围内

- 修改 Claude Code 原生 `.claude/agents/*.md`；
- 修改 Claude Code `settings.json`；
- 修改 cc-switch 配置；
- 重构运行中子代理状态面板；
- 独立的团队同步或云端 agent 仓库。
