# 聊天协议闭环设计

**目标：** 让 ccNexus 的 React 前端、Express WebSocket bridge 和 Claude Agent SDK 完成一轮可靠的聊天闭环。

## 范围

本阶段只覆盖发送消息、流式内容、工具调用、权限确认、停止、错误结果和会话 ID 回传。会话历史持久化、项目目录选择、附件、MCP、Skills 和设置功能不在本阶段实现。

## 架构

React 通过单个 WebSocket 连接与 Express bridge 通信；bridge 负责把 Claude Agent SDK 事件转换为浏览器可消费的事件。协议类型在 `src/types.ts` 中定义，服务端与前端遵循同一字段名，而不是各自维护近似但不兼容的格式。

## 事件契约

- 客户端请求：`chat` 使用 `sessionId`；`permission_response` 使用 `requestId`、`allow` 和可选 `message`；`abort` 使用可选 `sessionId`。
- 服务端事件：`session` 使用 `sessionId`；`stream_event` 保留 SDK 原始流事件；`assistant` 使用 `message` 对象；`permission_request` 使用 `requestId`、`toolName`、`input`；`status`、`result` 和 `error` 使用固定字段。
- 前端在收到 `session` 后创建或更新当前会话；在收到 `assistant` 后用完整消息替换临时流式消息；在收到 `result` 或 `error` 后结束流式状态。

## 连接与查询生命周期

`useWebSocket` 在未连接时暂存待发送消息，并在连接建立后按顺序发送。服务端将活跃 query 归属到产生它的 WebSocket；连接关闭时仅中断该连接拥有的 query，不影响其他客户端。

## 错误处理与安全

协议无法解析时忽略消息并保持连接。SDK 错误使用 `error` 事件反馈给发起客户端。权限请求在五分钟后自动拒绝。文件路径和 diff API 不在本阶段改动。

## 验收标准

1. 新会话能发送消息、收到 sessionId、显示流式文本和最终完整回答。
2. 工具调用能在流式和最终消息中显示。
3. 权限弹窗的允许与拒绝能解除服务端等待。
4. 停止只中断当前客户端发起的查询。
5. WebSocket 尚未打开时发送的消息不会丢失。
