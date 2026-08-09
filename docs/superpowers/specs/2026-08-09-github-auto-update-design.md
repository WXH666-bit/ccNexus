# ccNexus GitHub Releases 自动更新设计

日期：2026-08-09  
状态：设计稿，等待用户审阅

## 1. 背景

ccNexus 当前使用 Electron + Vite + React，已经通过 electron-builder 构建 Windows NSIS 安装包，但没有应用自身的版本检查、下载和安装流程。项目发布在公开 GitHub 仓库 `WXH666-bit/ccNexus`。

ccgui 中已有 SDK 依赖更新的完整模式，包括版本检查、更新状态、进度反馈和错误处理；ccgui 插件本体的升级由 IntelliJ/Marketplace 负责。因此本功能复用 ccgui 的状态和交互边界，但应用本体更新使用 Electron 的 `electron-updater` + GitHub Releases。

## 2. 目标

- 在打包后的 ccNexus 中检查 GitHub Releases 的最新稳定版本。
- 支持启动时检查、设置页手动检查和下载进度展示。
- 用户确认后下载，下载完成后由用户确认重启安装。
- 通过 GitHub Actions 构建并发布 NSIS 安装包及 updater 元数据。
- 保留现有聊天、daemon、会话和 `.ccnexus` 状态。
- 完全不修改 Claude Code 的配置文件、凭据、provider、MCP 或项目配置。

## 3. 非目标

- 第一版不做静默下载或强制升级。
- 第一版不跟踪 GitHub 提交或未发布的源码变化，只跟踪正式 Release 的语义化版本。
- 第一版不实现私有仓库认证、灰度发布或多更新频道。
- 不把更新逻辑放入 `chatController`、Claude runtime 或 daemon。
- 不通过自定义 GitHub API 和手写安装器替代 `electron-updater`。

## 4. 方案比较

### 方案 A：electron-updater + GitHub Releases（采用）

electron-builder 生成 `latest.yml`、安装包和校验元数据，Electron 主进程负责检查、下载和安装。它与当前 NSIS 构建目标直接匹配，支持更新事件和下载进度，客户端不需要 GitHub Token。

### 方案 B：GitHub API + 手动下载安装器

自行查询 Release、比较版本、下载 exe 并启动安装器。控制力更强，但需要自己维护校验、并发、失败恢复、安装时序和平台差异，容易偏离已有桌面架构。

### 方案 C：只显示 Release 页面链接

实现成本最低，但用户必须手动下载和安装，不满足自动检查及更新体验。

采用方案 A。

## 5. 架构

```text
GitHub Release (vX.Y.Z)
        │
        │ latest.yml + NSIS installer + checksum/blockmap
        ▼
desktop/runtime/appUpdater.js
        │
        ├── main-process update state
        ├── electron-updater events
        └── IPC handlers/events
                │
                ▼
desktop/preload.cjs
                │
                ▼
Settings / BasicConfigSection update UI
```

### 5.1 主进程更新服务

新增 `desktop/runtime/appUpdater.js`，职责仅限于应用更新：

- 读取当前版本和 `app.isPackaged`。
- 在非打包开发模式下跳过网络检查。
- 配置公开 GitHub provider、稳定版本策略和手动下载策略。
- 对重复检查和重复下载做 in-flight 防护。
- 缓存最新状态，使 renderer 初始化较慢或重挂载时不会丢失更新事件。
- 转换 updater 原始事件为 ccNexus 自己的状态对象。
- 在安装前触发现有 `before-quit` 清理流程。

第一版使用 `autoDownload = false` 和手动安装模式。应用只自动检查，不自动下载；用户点击“下载更新”后才产生网络和磁盘写入。

### 5.2 IPC 边界

`desktop/main.js` 注册以下 IPC：

- `desktop:get-update-state`
- `desktop:check-for-updates`
- `desktop:download-update`
- `desktop:install-update`

`desktop/preload.cjs` 只暴露对应窄 API，以及 `desktop:update-status` 的订阅/取消订阅函数。Renderer 不直接引入 Electron、文件系统或 `electron-updater`。

更新状态建议统一为：

- `idle`
- `checking`
- `not-available`
- `available`
- `downloading`
- `downloaded`
- `error`

状态可以携带当前版本、目标版本、Release 名称、Release Notes、下载百分比、传输字节、总字节和错误消息。

### 5.3 Renderer UI

更新入口放在设置页现有基础设置/关于区域，不新增独立窗口。UI 对齐 ccgui 的依赖更新体验：

- 显示当前版本。
- 手动检查按钮。
- 有更新时显示目标版本和 Release Notes。
- 下载中显示进度和速度。
- 下载完成后显示“重启并安装”。
- 网络错误只影响更新卡片，不阻塞聊天和工作区。

Release Notes 属于远程内容，展示时按不可信文本处理；如果支持 Markdown，必须经过现有 Markdown 安全清洗流程。

## 6. 更新数据流

1. `app.whenReady()` 完成并创建窗口后，异步触发一次检查，不阻塞窗口打开。
2. updater 发出 `checking-for-update`，主进程记录 `checking` 并推送给 renderer。
3. 没有新版本时推送 `not-available`。
4. 有新版本时只推送 `available`，不自动下载。
5. 用户点击下载，主进程调用下载 API，并转发 `download-progress`。
6. 下载完成后推送 `downloaded`。
7. 用户点击安装，主进程先执行 runtime/daemon 的退出清理，再调用 `quitAndInstall()`。
8. 下载失败或检查失败时推送 `error`，允许用户稍后重试。

启动检查和手动检查应有短暂冷却时间；不使用高频轮询。可以在应用运行期间增加 6～12 小时的定时检查，但不需要写入 Claude 配置或工作区。

## 7. GitHub 发布流程

### 7.1 electron-builder 配置

在 `package.json` 的 build 配置中明确 GitHub provider：

- owner：`WXH666-bit`
- repo：`ccNexus`
- release type：正式 release
- 默认更新频道：stable

不在配置文件中保存 Token。公开仓库的客户端检查不需要 Token；GitHub Actions 使用运行时提供的 `GITHUB_TOKEN`。

### 7.2 GitHub Actions

新增 `.github/workflows/release.yml`：

- 触发条件：推送 `v*` tag。
- Windows runner 上执行 `npm ci`、Vite build 和 electron-builder NSIS build。
- 使用 `contents: write` 权限创建/更新 Release。
- 使用 `--publish always` 发布安装包和 updater 元数据。
- Release 必须是正式发布状态，不能停留在 Draft。

发布流程要求先更新 `package.json` 版本，再创建匹配的 `vX.Y.Z` tag。只推送源码或 tag、但没有 NSIS 安装包和 `latest.yml`，客户端无法完成自动更新。

## 8. 安全和生命周期约束

- 更新服务只运行在 Electron 主进程。
- 不把 GitHub 写权限或私有 Token 打包到客户端。
- 使用 HTTPS、electron-updater 的 checksum 和签名校验。
- 生产发布应配置 Windows 代码签名，减少 SmartScreen 和安装信任问题。
- 更新安装必须复用 `app.on('before-quit')`，确保 daemon、runtime 和 IPC 通道先释放。
- 检查更新失败不能阻止打开工作区或继续聊天。
- 更新下载不会覆盖 `.ccnexus`、Claude 历史或 Claude 配置。
- 只处理版本高于当前版本的正式 Release；预发布版本默认忽略。

## 9. 测试和验收

### 自动测试

- updater 状态转换和错误归一化测试。
- IPC API 暴露和事件转发测试。
- 非打包模式不触发网络检查测试。
- 重复检查/重复下载防护测试。
- update state 类型检查。
- 构建配置测试，确认 GitHub provider、NSIS 和发布元数据配置存在。

### 手工验收

1. 构建并安装 `2.0.0`。
2. 发布包含安装包和 `latest.yml` 的 `2.0.1` Release。
3. 在 `2.0.0` 中手动检查，确认发现 `2.0.1`。
4. 确认下载进度、失败重试和 Release Notes 展示。
5. 点击重启安装，确认应用版本变为 `2.0.1`。
6. 确认聊天历史、工作区、provider 状态和 `.ccnexus` 数据仍然存在。
7. 在无网络场景启动应用，确认应用可正常聊天，只显示更新检查失败。

## 10. 预计改动范围

- `package.json`：依赖、发布配置和版本脚本。
- `desktop/runtime/appUpdater.js`：主进程更新服务。
- `desktop/main.js`：初始化 updater、注册 IPC 和安装退出流程。
- `desktop/preload.cjs`：暴露窄更新 API。
- `src/vite-env.d.ts`、`src/utils/desktopBridgeApi.ts`：类型和 renderer bridge。
- `src/views/SettingsView.tsx` 或现有基础设置组件：更新 UI。
- `src/i18n/locales/zh.json`、`src/i18n/locales/en.json`：文案。
- `.github/workflows/release.yml`：GitHub Release 自动发布。
- `tests/`：状态、IPC、构建配置和 updater 行为测试。

不修改 Claude Code 配置文件、provider 文件、凭据、MCP 配置或项目 `.claude` 内容。
