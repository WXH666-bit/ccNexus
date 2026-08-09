# Windows 安装器流程设计

日期：2026-08-09
状态：设计稿，等待用户审核

## 1. 背景

ccNexus 当前使用 `electron-builder` 生成 Windows NSIS 安装器。`package.json` 只声明了 `win.target: "nsis"`，因此安装器使用默认的一键安装模式：用户不能在向导中修改安装目录，安装完成页也没有明确的启动选择。

本次需求包含两个行为：

1. 安装向导允许用户选择安装目录。
2. 安装完成页显示“启动 ccNexus”复选框，默认勾选；用户取消勾选时不启动应用。

无论用户是否启动应用，安装器进程都必须在完成页结束后退出，不等待 ccNexus 进程，也不能留下后台安装器进程。

## 2. 目标与验收标准

- 安装器从一键模式切换为标准 NSIS 向导模式。
- 向导包含安装目录选择页面。
- 完成页显示启动 ccNexus 的复选框，默认处于选中状态。
- 复选框保持选中并点击完成时，安装器启动已安装的 ccNexus，然后安装器自身退出。
- 取消复选框并点击完成时，安装器不启动 ccNexus，然后安装器自身退出。
- 升级安装仍由 electron-builder 默认 NSIS 流程处理，不改变现有应用数据和卸载入口。
- 不修改 Claude Code 配置、provider 文件、凭据、MCP 配置、项目 `.claude` 内容或 Claude Agent SDK 版本。

## 3. 方案比较

### 方案 A：使用 electron-builder 内置的 assisted NSIS 流程（采用）

在 `package.json` 的 `build.nsis` 中启用标准向导，并打开安装目录选择和完成页启动选项：

```json
{
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "runAfterFinish": true
}
```

这是当前版本 electron-builder 已支持的配置路径。它会复用 NSIS 自带的目录页和完成页；完成页通过 `MUI_FINISHPAGE_RUN` 提供默认选中的启动复选框。启动动作使用非阻塞的 shell 调用，安装器完成页面随后正常结束。

优点是改动小、行为接近主流 Windows 安装器、与现有 GitHub Actions 打包流程兼容，并且不需要维护自定义 NSIS 脚本。缺点是复选框文本和完成页布局使用 electron-builder/NSIS 的标准样式，定制程度有限。

### 方案 B：额外编写自定义 NSIS 脚本

通过 `buildResources` 和 `nsis.include` 自己创建完成页控件、启动逻辑和退出逻辑。

优点是可以完全控制文案、布局和行为。缺点是需要维护 NSIS 宏、不同安装模式和升级路径，容易重新引入安装器进程不退出、启动阻塞或权限问题。当前需求不需要这种定制程度。

### 方案 C：更换为 Inno Setup 等其他安装器

使用另一套安装器系统重新实现目录选择、完成页和启动行为。

优点是安装器选项非常丰富。缺点是偏离现有 electron-builder/GitHub Releases 架构，需要重新处理安装包命名、`latest.yml`、自动更新兼容性和卸载注册信息，不符合当前项目范围。

## 4. 采用方案的详细设计

### 4.1 配置边界

只修改 `package.json` 的 `build.nsis` 配置：

- `oneClick: false`：启用标准安装向导。
- `allowToChangeInstallationDirectory: true`：显示安装目录页面。
- `runAfterFinish: true`：保留完成页启动复选框，并让它默认选中。

不修改 `desktop/main.js`、`desktop/update/appUpdater.js`、`desktop/runtime/` 或 `desktop/daemon/`。安装器的生命周期属于 NSIS/electron-builder，不属于应用运行时。

### 4.2 完成页与进程退出

安装完成后，NSIS 的标准完成页根据复选框状态决定是否调用已安装程序：

```text
用户点击完成
       │
       ├─ 复选框选中 ──> 非阻塞启动 ccNexus ──┐
       │                                     │
       └─ 复选框未选中 ──────────────────────┤
                                             ▼
                                      NSIS 安装器退出
```

启动动作不能使用等待子进程结束的调用。electron-builder 的 assisted NSIS 模板使用 `StdUtils.ExecShellAsUser` 打开应用，不等待应用主进程；完成页结束后由 NSIS 正常退出。因此两种选择都共享同一个退出路径。

如果 ccNexus 启动失败，失败只影响应用启动，不应阻塞安装器退出。

### 4.3 安装目录和升级

首次安装时，目录页面允许用户选择父目录，electron-builder 会按其标准规则补齐应用目录名。升级安装继续使用 NSIS 的既有安装检测和卸载旧版本流程；本次不改应用数据路径，也不迁移 `.ccnexus` 或 Claude 历史数据。

## 5. 测试与验证

### 自动测试

在 `tests/desktop-packaging.test.mjs` 增加配置回归断言，确认：

- `build.nsis.oneClick === false`；
- `build.nsis.allowToChangeInstallationDirectory === true`；
- `build.nsis.runAfterFinish === true`；
- 原有 NSIS、GitHub Releases、Claude SDK 固定版本和 Vite 打包断言继续保留。

测试必须先在未修改配置时失败，再添加配置使其通过。

### 构建验证

依次执行项目要求的验证命令：

```powershell
node tests\desktop-packaging.test.mjs
npm.cmd run test:protocol
npx.cmd tsc --noEmit
npm.cmd run build
```

另外执行一次 Windows NSIS 安装器构建，检查生成物确实是 NSIS `.exe`，并手动验证：

1. 能进入安装目录选择页面；
2. 完成页的“启动 ccNexus”复选框默认勾选；
3. 保持勾选完成后，ccNexus 启动且安装器进程消失；
4. 取消勾选完成后，ccNexus 不启动且安装器进程消失。

## 6. 非目标

- 不新增应用内安装目录设置。
- 不把安装器逻辑放进 `chatController`、Claude runtime 或 daemon。
- 不改变应用自动更新检查、下载和 `quitAndInstall()` 流程。
- 不修改 Claude Code 的任何配置文件或凭据。
- 不更换 NSIS、不新增独立安装器框架、不维护自定义 NSIS 页面。
- 不在本次需求中独立升级 Claude Agent SDK。

## 7. 预期改动文件

- 修改：`package.json`
- 修改：`tests/desktop-packaging.test.mjs`
- 新增并提交：本设计文档

实现完成后，若要让用户通过 GitHub Releases 获取该安装器，需要按项目现有发布流程递增 ccNexus 版本、创建匹配的 `vX.Y.Z` tag，并让 GitHub Actions 生成新的 NSIS 安装包和 `latest.yml`。
