# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地密码管理器 — 基于 Electron + React + TypeScript 的桌面应用。使用 AES-256-GCM 加密保存密码，通过 PBKDF2 (SHA-512, 100,000 次迭代) 从主密码派生加密密钥。保险库数据存储在 `vault.dat` 文件中。

## 常用命令

```bash
npm run dev          # 开发模式（electron-vite dev → 启动 Electron）
npm run build        # 仅构建（electron-vite build）
npm start            # 从构建产物直接启动 Electron
npm run pack         # 完整打包流程：生成图标 → 构建 → electron-builder --dir → 修补 exe 图标
npm run dist         # 完整发布流程：生成图标 → 构建 → electron-builder（生成 portable exe）
npm run icon         # 单独生成图标（scripts/make-icon.js → resources/icon.png + icon.ico）
```

项目没有测试框架或 lint 配置，也没有 typecheck 脚本。

⚠️ **`npm run build` 不做类型检查**（electron-vite 用 Vite/esbuild 仅转译，不执行 `tsc`），构建通过不代表类型正确。需要类型检查时手动运行：
`npx tsc --noEmit -p tsconfig.node.json --composite false`（主进程 + preload）
`npx tsc --noEmit -p tsconfig.web.json --composite false`（渲染进程）
（两个 tsconfig 均设置了 `composite: true`，需用 `--composite false` 覆盖才能配合 `--noEmit`）

### 构建产物目录

| 目录 | 用途 |
|------|------|
| `out/` | electron-vite 构建产物（主进程、preload、渲染进程） |
| `dist/` | electron-builder 打包产物（portable exe） |
| `resources/` | 程序化生成的图标文件（icon.png + icon.ico） |
| `scripts/` | 构建辅助脚本（`make-icon.js` 生成图标 → PNG + ICO；`patch-icon.js` 用 rcedit 修补 exe 图标） |

### UI 技术栈

- **样式方案**：单一 [App.css](src/renderer/src/App.css) 文件，通过 CSS 自定义属性配合 `<html data-theme="dark|light">` 驱动主题切换。无 CSS Modules 或 CSS-in-JS
- **图标库**：[lucide-react](https://lucide.dev)（`package.json` 中唯一的运行时依赖），所有图标（Lock, Key, Sun, Moon, FolderOpen, Plus, GripVertical 等）均来自此库
- **状态管理**：无外部库，仅使用 React 内置的 `useState` / `useContext` / `useRef`
- **组件优化**：`VaultScreen` 和 `EntryList` 使用 `React.memo()` 避免不必要重渲染
- **拖拽排序**：使用原生 HTML5 Drag and Drop API（`draggable` 属性 + `dragStart` / `dragOver` / `drop` 事件），未引入第三方拖拽库
- **主题初始化**：`getInitialTheme()` 从 `localStorage('theme')` 恢复上次主题选择，无记录时默认 `'light'`。主题在渲染阶段通过 `applyTheme()` 同步到 DOM 与 localStorage（无 useEffect，确保首次渲染前生效、避免闪烁）

### 开发注意事项

- electron-vite dev 提供渲染进程 HMR（热模块替换），但**主进程和 preload 代码变更需重启 dev 服务**才能生效

## 键盘快捷键

VaultScreen 中通过 `keydown` 事件监听实现的全局快捷键：

| 快捷键 | 行为 | 实现机制 |
|--------|------|----------|
| `Ctrl+N` | 新建条目 | 切换到 add 视图 |
| `Ctrl+S` | 保存当前表单 | 通过 `formSubmitRef` 调用 EntryForm 的 `handleSubmit` |
| `Ctrl+F` | 聚焦搜索框 | 通过 `searchInputRef` 获取 DOM 引用并 focus |
| `Esc` | 逐层退出 | 见下方 ViewMode 状态机 |

快捷键使用 `useEffect` 注册在 `document` 上，依赖 `showGenerator`、`viewMode`、`selectedId`（Esc 行为依赖当前模式）。`metaKey` 也作为 Ctrl 的替代以支持 macOS。

## 架构

### 进程模型（Electron 三层架构）

```
┌─────────────────────────────────────────────────────────┐
│ 主进程 (Main Process) — src/main/                       │
│ Node.js 环境，可访问 fs/crypto/os 等 API                │
│                                                         │
│ index.ts    入口：创建窗口、注册 IPC、程序化生成图标     │
│ ipc.ts      IPC 通道注册（handle 模式）                  │
│ vault.ts    保险库状态管理（内存中解密后的条目 + CRUD）  │
│ crypto.ts   AES-256-GCM 加解密、PBKDF2 密钥派生、       │
│             随机密码生成                                 │
│ store.ts    文件读写封装（vault.dat 路径解析）           │
│ clipboard.ts 剪贴板操作（30 秒自动清除）                 │
└──────────────┬──────────────────────────────────────────┘
               │ IPC (invoke/handle)
┌──────────────▼──────────────────────────────────────────┐
│ 预加载脚本 (Preload) — src/preload/index.ts             │
│ contextBridge.exposeInMainWorld('api', {...})            │
│ 仅暴露类型安全的 API，不暴露任何 Node.js 能力            │
└──────────────┬──────────────────────────────────────────┘
               │ window.api
┌──────────────▼──────────────────────────────────────────┐
│ 渲染进程 (Renderer) — src/renderer/                     │
│ React 18 单页应用，通过 window.api 调用主进程            │
│                                                         │
│ api.ts     window.api 的类型化封装                       │
│ types.ts   从 shared/types 再导出的共享类型              │
│ env.d.ts   Window.api 全局类型声明（也引用 shared/types）│
│ App.tsx    根组件：主题切换 + 解锁/锁定状态切换          │
│                                                         │
│ 组件树：                                                 │
│ App                                                     │
│ ├─ UnlockScreen      （创建保险库 / 输入主密码解锁）     │
│ └─ VaultScreen        （主界面）                         │
│    ├─ 侧边栏                                           │
│    │  ├─ SearchBox     （实时过滤）                      │
│    │  └─ EntryList     （条目列表 + 添加按钮）           │
│    └─ 主面板                                          │
│       ├─ EntryDetail   （查看密码、复制、编辑、删除）     │
│       ├─ EntryForm     （添加/编辑条目）                 │
│       ├─ PasswordGenerator （随机密码生成器）            │
│       └─ ChangePasswordScreen（修改主密码）              │
│                                                         │
│ 通用组件：                                               │
│ Toast.tsx         通知系统（ToastProvider + useToast hook）│
│ ConfirmDialog.tsx 通用确认对话框（用于删除确认等操作）    │
└─────────────────────────────────────────────────────────┘
```

### 数据流

1. **保险库生命周期**：首次使用 → 创建保险库（`createVault`，生成随机 salt → 派生密钥 → 加密空条目列表 → 写入 vault.dat）。后续使用 → 解锁（`unlockVault`，读取文件 → 用 salt 派生密钥 → 尝试解密验证密码正确性 → 将条目加载到内存）。解锁时会做向后兼容迁移：为缺失 `order` 字段的旧版本条目按数组索引补齐

2. **条目 CRUD**：所有变更先更新内存中的 `state.entries`，然后立即调用 `saveVault()` 全量重新加密写入文件。每次保存生成新的随机 IV。

3. **密码安全**：`listEntries` 返回时密码被替换为 `••••••••`，只有 `getEntry` 返回完整密码。复制密码统一走主进程剪贴板模块（`copyToClipboard`），30 秒后自动清除：条目详情通过 `password:copy`，PasswordGenerator 通过 `password:copy-text`，两处行为一致。

4. **IPC 通道**（全部为 `ipcMain.handle` / `ipcRenderer.invoke` 模式）：
   - `vault:exists` / `vault:create` / `vault:unlock` / `vault:lock` / `vault:change-password` / `vault:status`
   - `entries:list` / `entries:get` / `entries:create` / `entries:update` / `entries:delete` / `entries:reorder`
   - `password:copy` / `password:copy-text` / `password:clear-clipboard` / `password:generate`

### ViewMode 状态机与 Esc 退出层级

VaultScreen 维护 `viewMode: 'detail' | 'add' | 'edit' | 'change-password'`，配合 `selectedId` 和 `showGenerator` 形成 5 层 Esc 退出逻辑：

```
showGenerator=true        → Esc → 关闭生成器（表单仍在后台以 display:none 保持状态）
viewMode='add'/'edit'     → Esc → 取消表单 → 回到 'detail'
viewMode='change-password' → Esc → 回到 'detail'
selectedId != null         → Esc → 清除选中条目
```

PasswordGenerator 与 EntryForm 的通信通过 VaultScreen 状态提升实现：`PasswordGenerator.onUse(pw)` → `setGeneratedPassword(pw)` + `setShowGenerator(false)` → EntryForm 通过 `initialPassword` prop 接收密码。生成器显示时表单以 `display:none` 隐藏（非卸载），已填字段不丢失。

### 自动锁定系统

VaultScreen 中的闲置监控机制，细节对维护很重要：

- **检测**：监听 `mousemove/keydown/mousedown/touchstart/scroll/click` 事件（`passive: true`），更新 `lastActivityRef` 时间戳
- **轮询**：`setInterval` 每秒比较当前时间与 `lastActivityRef`
- **预警**：锁定前 30 秒弹出 Toast 预警，`lockWarningShownRef` 标志位防止每秒重复弹窗
- **配置**：`localStorage('autoLockMinutes')`，默认 5 分钟，值为 0 则清除定时器关闭自动锁定
- **闭包处理**：`handleLockRef` 和 `showToastRef` 使用 Ref 模式，确保定时器回调始终能读取最新的锁定函数和 Toast 函数，避免闭包过期（stale closure）问题

### 加密方案

- **密钥派生**：PBKDF2，主密码 + 32 字节随机 salt → 100,000 次迭代 → SHA-512 → 256-bit key
- **加密**：AES-256-GCM，每次加密生成随机 16 字节 IV
- **存储格式**（vault.dat）：JSON `{ salt, iv, authTag, ciphertext }`，全部为 hex 字符串
- **修改主密码**：验证旧密码 → 生成新 salt → 重新加密 → 覆盖 vault.dat

### 类型定义（共享）

**所有跨进程类型统一在 [shared/types.ts](src/shared/types.ts) 定义一次**（`PasswordEntry` / `NewPasswordEntry` / `PasswordOptions` / `VaultStatus`），主进程 [vault.ts](src/main/vault.ts)、preload [index.ts](src/preload/index.ts)、渲染进程 [types.ts](src/renderer/src/types.ts) 与 [env.d.ts](src/renderer/src/env.d.ts) 均从该文件导入（types.ts 仅做 re-export，env.d.ts 在 `declare global` 中引用）。contextBridge 在编译期不共享类型，但类型形状由主进程 vault.ts 的序列化决定——改字段时只需改 shared/types.ts 一处。

### 安全实现细节

- `writeVault()` 采用**原子写入**（先写 `vault.dat.tmp` 再 `rename` 覆盖），写入中断不会损坏 vault.dat
- `lockVault()` 对 key Buffer 做显式清零（`fill(0)`）后置 null，修改主密码时也会清零旧密钥，防止密钥残留在内存中
- `generatePassword()` 使用**拒绝采样**（rejection sampling）消除 `% charset.length` 的取模偏差，保证每个字符等概率出现，且长度小于选中字符类型数时自动取类型数

### 文件存储路径

- **生产模式**（`app.isPackaged`）：`vault.dat` 在 exe 同级目录（便携模式）
- **开发模式**：`vault.dat` 在 `app.getPath('userData')` 目录

[store.ts](src/main/store.ts) 还导出了 `deleteVault()` 函数用于删除 vault.dat 文件，但当前未被任何代码调用（保留用于未来"重置保险库"功能）。

### 窗口管理

- 使用 `Menu.setApplicationMenu(null)` 隐藏菜单栏，使用系统原生标题栏
- 窗口启动防闪烁采用三层防护：`show: false` + `backgroundColor: '#0a0a0f'` + `ready-to-show` 事件后才调用 `win.show()`
- 窗口图标在 `ensureIcon()` 中程序化生成（64×64 像素，纯 Node.js 逐像素绘制盾牌+锁芯图案），同时保存到 `userData` 和 `resources` 目录

### 构建配置

- `electron.vite.config.ts`：主进程/preload 使用 `externalizeDepsPlugin`，渲染进程使用 `@vitejs/plugin-react`
- TypeScript 三个 config：根 `tsconfig.json`（references）、`tsconfig.node.json`（主进程+preload）、`tsconfig.web.json`（渲染进程，`jsx: "react-jsx"`）
- electron-builder 目标：Windows portable x64（单文件 exe，非安装器）。`package.json` 中保留有 NSIS 配置（允许选择安装目录、创建桌面快捷方式），但当前 portable 目标下该配置不生效
- 图标通过 `scripts/make-icon.js` 程序化生成（纯 Node.js PNG 编码器，无需 Canvas），然后 `scripts/patch-icon.js` 用 rcedit 修补 exe

### UI 主题

支持暗色/亮色主题切换，通过 CSS 自定义属性实现。主题选择存储在 `localStorage('theme')`，通过 `<html data-theme="...">` 属性驱动样式，重启后恢复上次选择；无记录时默认亮色（`getInitialTheme()` 从 localStorage 读取，兜底返回 `'light'`）。暗色主题使用 Matrix Green (`#00c853`) 配色，亮色主题使用相应调整后的绿色 (`#00a844`)。
