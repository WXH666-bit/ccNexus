# ccNexus 协作说明

## 项目定位

ccNexus 是一个独立运行的 Claude Code 可视化客户端。当前阶段是 Web 应用，目标是在不依赖 JetBrains IDE 的前提下提供接近 ccGUI 的 Claude Code 使用体验；桌面壳会在 Web 核心稳定后再引入。

## 当前技术栈

- 前端：React 19、TypeScript、Vite、React Router。
- 服务端：Node.js、Express、ws、`@anthropic-ai/claude-agent-sdk`。
- 包管理器：只使用 pnpm；不要新增或恢复 npm lockfile。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm start
```

开发模式下 Vite 运行在 5000 端口，Express API/WebSocket 运行在 3456 端口。生产模式由 Express 在 5000 端口服务 `dist/`。

## 目录职责

- `src/views/`：Chat、History、Settings 三个页面。
- `src/components/`：聊天、配置和工具调用展示组件。
- `src/hooks/useWebSocket.ts`：浏览器端 WebSocket 生命周期。
- `server/index.js`：API、WebSocket 与 Claude Agent SDK 适配层。
- `scripts/`：Coze 的预览与部署入口。
- `.claude/`：项目级 Claude 配置，必须保留。
- `ccGUI源码.zip`：对标实现的只读参考源码，不参与构建。

## 开发约束

- 先保证 Claude 会话、流式事件、权限、附件、会话恢复等核心数据链路真实可用，再添加展示层功能。
- 前后端 WebSocket 事件必须由共享的消息契约约束；修改一端时同步更新另一端并补充集成测试。
- 服务端文件操作必须限制在用户选定的项目根目录，并使用路径边界校验，不能仅依赖字符串前缀。
- 不要恢复已迁移淘汰的 Electron 主进程、preload 或 `src/renderer/` 目录结构。
- 当前工作区包含用户尚未提交的迁移改动；不得重置、覆盖或删除未确认的业务文件。
- 改动完成后至少运行 `pnpm exec tsc --noEmit`；涉及服务端协议时还应验证聊天主流程。

## 变更原则

- 使用 `apply_patch` 修改文本文件。
- 新增依赖前先说明用途，且通过 pnpm 管理。
- 文档以中文为主；用户可见的功能必须明确标记“已实现”或“规划中”，不得把占位 UI写成已完成能力。
