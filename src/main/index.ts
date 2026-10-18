/**
 * index.ts — Electron 主进程入口文件
 *
 * 职责：应用启动、窗口创建、图标落盘、IPC 注册、安全策略
 *
 * 这是整个 Electron 应用的启动入口。Node.js 环境，可访问：
 *   - 文件系统（fs）
 *   - 加密 API（crypto）
 *   - 操作系统 API（os）
 *   - Electron API（app, BrowserWindow, Menu 等）
 *
 * 启动流程：
 *   1. app.requestSingleInstanceLock() 单实例校验（多开会让两份内存副本互相覆盖写盘）
 *   2. app.whenReady() 等待 Electron 就绪
 *   3. registerIpcHandlers() 注册所有 IPC 通道
 *   4. Menu.setApplicationMenu(null) 隐藏菜单栏
 *   5. ensureIcon() 写出应用图标
 *   6. 创建 BrowserWindow（沙箱 + 上下文隔离 + 导航拦截）
 *   7. 加载渲染进程页面
 *   8. ready-to-show 事件触发后显示窗口（防止白屏闪烁）
 */

import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { ICON_PNG_BASE64, ICON_SIZE } from './app-icon'
import { registerIpcHandlers } from './ipc'

/** 开发模式下 Vite dev server 的地址（未设置说明是打包后的生产运行） */
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

/**
 * 确保应用图标落盘，返回可供 BrowserWindow 使用的路径
 *
 * 图标本体来自 ./app-icon.ts —— 由 `npm run icon`
 * （scripts/make-icon.js + scripts/icon-render.js）矢量渲染后内嵌为 base64。
 * 启动时只把字节写到 userData 下，好处是：
 *   - 不依赖 resources/ 在 asar / 便携 exe 中的解码路径是否可读
 *   - 窗口图标与打包进 exe 的图标同源（同一份渲染代码、同一张 PNG）
 *
 * @returns icon.png 的绝对路径；写入失败时返回 undefined（Electron 回退默认图标）
 */
function ensureIcon(): string | undefined {
  const pngPath = join(app.getPath('userData'), 'icon.png')
  try {
    writeFileSync(pngPath, Buffer.from(ICON_PNG_BASE64, 'base64'))
    return pngPath
  } catch (err) {
    console.error(`[icon] 写入 ${ICON_SIZE}px 图标失败，回退默认图标：`, err)
    return undefined
  }
}

/** 当前主窗口引用（供 second-instance 聚焦复用） */
let mainWindow: BrowserWindow | null = null

/**
 * 创建主窗口
 *
 * 安全配置说明：
 *   - sandbox: true       渲染进程跑在 Chromium 沙箱内（preload 仍可用 contextBridge）
 *   - contextIsolation    TS/Electron 默认 true，显式写出以防未来改动误关
 *   - nodeIntegration     false（默认），渲染进程拿不到 Node API
 *   - 导航拦截            will-navigate 阻止页面跳转到任意地址
 *   - 新窗口              setWindowOpenHandler 一律 deny，外链交给系统浏览器
 */
function createWindow(): void {
  const iconPath = ensureIcon()

  const win = new BrowserWindow({
    width: 900,                     // 窗口宽度
    height: 670,                    // 窗口高度
    // 最小尺寸：再小就会把侧边栏和详情面板挤成不可用的窄条（样式里没有响应式断点）
    minWidth: 720,
    minHeight: 520,
    icon: iconPath,                 // 窗口图标（显示在标题栏和任务栏）
    show: false,                    // 先隐藏，等 ready-to-show 再显示
    backgroundColor: '#0a0a0f',     // 窗口背景色与暗色主题一致，消除闪烁
    webPreferences: {
      // preload 脚本：contextBridge 暴露 API，不开启 nodeIntegration
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,                // 渲染进程沙箱化
      contextIsolation: true,       // 上下文隔离（默认值，显式声明）
      nodeIntegration: false,       // 渲染进程不可用 Node API（默认值，显式声明）
      webviewTag: false,            // 禁用 <webview>
      spellcheck: false             // 密码框不需要拼写检查，也避免输入内容外发
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // ── 安全：拦截页面内跳转 ──────────────────────────────
  // 开发模式只允许停留在 dev server 地址；生产模式不允许任何跳转
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = RENDERER_DEV_URL ? url.startsWith(RENDERER_DEV_URL) : false
    if (!allowed) event.preventDefault()
  })

  // ── 安全：拦截 window.open / target=_blank ────────────
  // 应用内没有任何合法的外部窗口，一律禁止；http(s) 链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 加载渲染进程页面（React 应用）
  // 开发模式（npm run dev）：加载 DEV URL 以获得 HMR；否则加载构建产物
  if (RENDERER_DEV_URL) {
    void win.loadURL(RENDERER_DEV_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 页面渲染就绪后再显示窗口，避免白屏/黑屏闪烁
  // 配合 show: false + backgroundColor + HTML 内联背景，三层防护
  win.once('ready-to-show', () => {
    win.show()
  })
}

// ═══════════════════════════════════════════════════
// 单实例锁
//
// 密码管理器会持有内存中的解密数据，并把整份保险库重写到 vault.dat。
// 若允许开第二个实例，两个进程各自持有一份内存副本，后保存者会覆盖前者
// —— 用户在 A 窗口新建的条目会被 B 窗口的一次保存静默抹掉。
// 因此这里强制单实例：第二个实例直接退出，并把已有窗口唤到前台。
// ═══════════════════════════════════════════════════

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 已有实例在运行 → 本进程立即退出（second-instance 事件会唤醒原窗口）
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    // 注册所有 IPC 通信通道（必须在创建窗口之前）
    registerIpcHandlers()

    // 隐藏 Electron 默认菜单栏（密码管理器不需要菜单）
    Menu.setApplicationMenu(null)

    createWindow()
  })
}
