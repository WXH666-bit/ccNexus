# ccNexus

ccNexus 是一个正在开发中的、自托管的 Claude Code 可视化客户端。它的目标是提供类似 ccGUI 的聊天式工作界面，但不依赖 PyCharm、IntelliJ IDEA 或其他 JetBrains IDE。

当前项目处于 Web alpha 阶段：先完成可独立运行的 Claude Code 核心交互，再考虑封装为桌面应用。

## 当前方向

- 以 Claude Code CLI / Agent SDK 为核心，而不是重新实现模型服务。
- 提供聊天、工具调用展示、权限确认、文件引用、会话与设置界面。
- 参考根目录的 `ccGUI源码.zip` 对齐真实能力，包括流式输出、会话恢复、附件、权限、文件回退、Skills、MCP 和供应商配置。
- 先确保功能真实可用，再扩展视觉效果和桌面壳。

## 技术栈

- 前端：React 19、TypeScript、Vite、React Router
- 后端：Node.js、Express、ws、`@anthropic-ai/claude-agent-sdk`
- 包管理器：pnpm

## 前置条件

- Node.js 20 或更高版本
- 已安装并登录 Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude
```

## 安装与运行

```bash
pnpm install
pnpm dev
```

开发模式下：

- 前端 Vite：`http://localhost:5000`
- 后端 API 与 WebSocket：`http://localhost:3456`

构建并运行生产版本：

```bash
pnpm build
pnpm start
```

## 项目结构

```text
server/index.js       Express、WebSocket 与 Claude Agent SDK 适配层
src/
  views/              Chat、History、Settings 页面
  components/         聊天、工具卡片、设置组件
  hooks/              WebSocket 等客户端逻辑
  utils/              Markdown 与 diff 工具
scripts/              预览与部署脚本
.claude/              项目级 Claude 配置
.agents/              面向协作代理的项目说明
ccGUI源码.zip         ccGUI 对标参考源码
```

## 开发原则

当前优先级是让下列核心链路真正闭环：

1. Claude 会话创建、恢复、取消与历史持久化。
2. 前后端统一的流式消息和工具调用协议。
3. 权限确认、附件、文件引用与文件回退。
4. 可选项目工作目录，而不是固定在服务端启动目录。
5. 基于以上核心能力实现 Skills、MCP、供应商管理和使用统计。

桌面应用包装会在这些能力稳定后进行，避免把未完成的 Web 原型直接封装成桌面程序。

## 参考资料

- `ccGUI源码.zip`：ccGUI 源码，仅用于功能与交互对标，不参与项目构建。
