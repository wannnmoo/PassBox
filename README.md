# 🔐 PassBox — 本地密码管理器

> 安全 · 离线 · 便携的本地密码管理器
> 所有数据 AES-256-GCM 加密后保存在本地，**绝不联网**，无任何云端依赖。

PassBox 是一个基于 Electron + React + TypeScript 的桌面密码管理器。保险库数据加密存储在本地 `vault.dat` 文件中，支持便携模式（exe + vault.dat 放 U 盘即走）。

## ✨ 功能特性

- **🔒 本地加密存储** — 数据不出本机，AES-256-GCM 认证加密 + PBKDF2 密钥派生
- **🎲 密码生成器** — 密码学安全随机（拒绝采样消除取模偏差），可配置长度与字符类型
- **⏱ 剪贴板自动清除** — 复制密码 30 秒后自动从剪贴板清除，配倒计时圆环可见反馈
- **🔍 实时搜索** — 按服务名 / 用户名 / 网址过滤，命中关键词高亮
- **📂 拖拽排序** — 原生 HTML5 拖拽，自由调整条目顺序
- **🛡 自动锁定** — 闲置自动锁定保险库（可配置 1~30 分钟或关闭），锁定前 30 秒提醒
- **💾 自动备份** — 每次保存前自动备份当前版本，滚动保留最近 5 份，双重保险
- **🌙 明暗主题** — 深色 / 浅色主题切换，记忆上次选择
- **💻 便携模式** — 打包为单文件 exe，`vault.dat` 与 exe 同目录，U 盘即插即用
- **🧩 单实例运行** — 重复启动只激活已打开的窗口，避免两个进程并发写同一个 `vault.dat`
- **♿ 键盘可用** — 全量焦点环、对话框语义（`role=dialog` / `aria-modal`）、Toast `aria-live`

## 🔐 安全设计

| 环节 | 方案 |
|------|------|
| 密钥派生 | PBKDF2（SHA-512，100,000 次迭代）+ 32 字节随机盐 → 256-bit 密钥 |
| 加密算法 | AES-256-GCM（认证加密，防篡改检测），每次保存生成新随机 IV |
| 存储格式 | `vault.dat` JSON `{ salt, iv, authTag, ciphertext }`，全部 hex 编码 |
| 密码掩码 | 列表返回掩码 `••••••`，仅详情视图按需获取明文 |
| 内存安全 | 锁定保险库时对密钥 Buffer 显式清零，防止残留内存 |
| 剪贴板 | 统一走主进程剪贴板模块，30 秒后自动清除 |
| 渲染隔离 | `contextIsolation` + `sandbox: true` + `nodeIntegration: false`，渲染进程拿不到 Node 能力 |
| 内容安全策略 | `Content-Security-Policy: default-src 'self'`（无 `unsafe-eval`、禁 object/frame），阻断注入脚本外连 |
| 导航拦截 | 页面跳转与 `window.open` 一律拒绝，外链交给系统浏览器 |
| 主密码要求 | 最短 8 位；解锁失败区分「密码错误」与「文件损坏」，后者不会误导为重输密码 |

> 数据安全性取决于主密码强度。建议使用足够长的随机主密码，并启用自动锁定。
>
> ⚠️ 备份文件是旧密文的副本：修改主密码后，旧备份仍可用**旧密码**解开。若主密码曾泄露，请一并删除同目录下的 `vault.dat.bak-*`。

## 📷 截图

（待补充截图）

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- Windows（当前打包目标为 Windows x64 portable）

### 开发模式

```bash
npm install
npm run dev        # 启动开发模式（HMR 热更新）
```

### 打包发布

```bash
npm run typecheck  # 类型检查（npm run build 本身不做类型检查）
npm test           # 类型检查 + 构建 + 逻辑回归（13 项）+ 渲染冒烟
npm run build      # 仅构建（不打包）
npm run pack       # 打包为解压目录（调试用）
npm run dist       # 打包为单文件 portable exe
```

构建产物在 `dist/` 目录，双击即可运行，无需安装。

## 📁 数据存储位置

| 模式 | 位置 |
|------|------|
| **生产模式**（打包 exe） | 与用户双击的 exe 同目录（便携模式） |
| **开发模式**（`npm run dev`） | `C:\Users\<用户名>\AppData\Roaming\passbox\` |

> 便携版 exe 运行时会被解压到 `%TEMP%\` 临时目录，程序读取的是你放置 exe 的真实目录
> （通过 `PORTABLE_EXECUTABLE_DIR` 得到），所以把 exe 放进 U 盘、桌面都能正常读写同目录数据。

- **保险库文件**：`vault.dat`（加密数据）
- **自动备份**：`vault.dat.bak-<时间戳>`（与 vault.dat 同目录，滚动保留最近 5 份）
- **恢复备份**：将某个 `.bak` 文件复制并重命名为 `vault.dat` 即可

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + N` | 新建条目 |
| `Ctrl + S` | 保存当前表单 |
| `Ctrl + F` | 聚焦搜索框 |
| `Esc` | 逐层退出（生成器 → 表单 → 修改密码 → 取消选中） |

## 🛠 技术栈

- **Electron 33** — 桌面应用框架（主进程 / preload / 渲染进程三层架构）
- **React 18** + **TypeScript** — 渲染层，无外部状态管理库
- **electron-vite** — 构建工具
- **lucide-react** — 图标库（唯一运行时依赖）
- **electron-builder** — 打包（Windows portable x64）
- **图标** — 纯 Node.js 矢量渲染（无 Canvas/ImageMagick）：`npm run icon` 一次生成 7 个尺寸 PNG + 多尺寸 ICO + 运行时内嵌 PNG，窗口 / 任务栏 / exe 三处同源；哑光扁平造型，`node scripts/make-icon.js D|E|F` 换方案

## 📂 项目结构

```
src/
├── main/          # 主进程（Node.js 环境）
│   ├── index.ts   # 窗口管理、IPC 注册
│   ├── app-icon.ts # 图标 PNG 的 base64（npm run icon 生成）
│   ├── ipc.ts     # IPC 通道注册
│   ├── vault.ts   # 保险库状态管理（内存解密 + CRUD）
│   ├── crypto.ts  # AES-256-GCM / PBKDF2 / 密码生成
│   ├── store.ts   # 文件读写（原子写入 + 自动备份）
│   └── clipboard.ts # 剪贴板（30 秒自动清除）
├── preload/       # 预加载脚本（contextBridge 安全桥接）
├── renderer/      # React 渲染进程
│   └── src/components/  # 解锁、条目列表/详情/表单、密码生成器等
└── shared/        # 跨进程共享类型（单一来源）
```

## 📄 许可证

（待补充）
