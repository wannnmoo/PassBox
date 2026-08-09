/**
 * index.ts — Electron 主进程入口文件
 *
 * 职责：应用启动、窗口创建、图标生成、IPC 注册
 *
 * 这是整个 Electron 应用的启动入口。Node.js 环境，可访问：
 *   - 文件系统（fs）
 *   - 加密 API（crypto）
 *   - 操作系统 API（os）
 *   - Electron API（app, BrowserWindow, Menu 等）
 *
 * 启动流程：
 *   1. app.whenReady() 等待 Electron 就绪
 *   2. registerIpcHandlers() 注册所有 IPC 通道
 *   3. Menu.setApplicationMenu(null) 隐藏菜单栏
 *   4. ensureIcon() 生成应用图标
 *   5. 创建 BrowserWindow（设置窗口属性、预加载脚本）
 *   6. 加载渲染进程页面
 *   7. ready-to-show 事件触发后显示窗口（防止白屏闪烁）
 */

import { app, BrowserWindow, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { registerIpcHandlers } from './ipc'

/**
 * 确保应用图标存在，如果不存在则程序化生成
 *
 * 生成策略：
 *   - 纯 Node.js 实现，不依赖 Canvas 或任何原生模块
 *   - 在 64×64 像素的缓冲区中逐像素绘制盾牌图标
 *   - 保存为 PNG 格式（使用原生 raw RGBA → PNG 转换）
 *   - 同时保存到 userData 目录和 resources 目录
 *
 * 图标设计（64×64 像素）：
 *   - 背景：深色圆角矩形 (#0a0a0f)
 *   - 主体：盾牌形状（从顶部白色渐变到底部 Matrix Green #00c853）
 *   - 细节：锁芯图案（深绿色 #00963c），表示安全/锁定
 *
 * @returns 生成的 icon.png 文件路径
 */
function ensureIcon(): string {
  // 图标保存在 userData 目录，确保开发模式和生产模式都能找到
  const pngPath = join(app.getPath('userData'), 'icon.png')

  const size = 64  // 像素尺寸
  // 创建 RGBA 原始像素缓冲区（每个像素 4 字节：R, G, B, A）
  const buf = Buffer.alloc(size * size * 4)

  // 颜色定义（RGBA 格式）
  const bg = [10, 10, 15, 255]          // #0a0a0f — 深色背景
  const green = [0, 200, 83, 255]       // #00c853 — Matrix Green 主色调
  const darkGreen = [0, 150, 60, 255]   // #00963c — 深绿色（锁芯）
  const white = [255, 255, 255, 255]    // 白色（盾牌上半部）

  /** 在像素缓冲区中设置指定坐标的颜色 */
  function setPixel(x: number, y: number, color: number[]): void {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = color[0]       // R
    buf[i + 1] = color[1]   // G
    buf[i + 2] = color[2]   // B
    buf[i + 3] = color[3]   // A
  }

  // ── 第一步：绘制圆角矩形背景 ────────────────────
  const r = 12  // 圆角半径
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 检查当前像素是否在圆角矩形内部
      // 四个角落：如果像素在圆角之外（距离圆心 > 半径），则跳过
      let inside = true
      if (x < r && y < r && (x - r) ** 2 + (y - r) ** 2 > r ** 2) inside = false
      if (x >= size - r && y < r && (x - (size - 1 - r)) ** 2 + (y - r) ** 2 > r ** 2) inside = false
      if (x < r && y >= size - r && (x - r) ** 2 + (y - (size - 1 - r)) ** 2 > r ** 2) inside = false
      if (x >= size - r && y >= size - r && (x - (size - 1 - r)) ** 2 + (y - (size - 1 - r)) ** 2 > r ** 2) inside = false
      if (inside) setPixel(x, y, bg)
    }
  }

  // ── 第二步：绘制盾牌形状 ──────────────────────
  const cx = size / 2      // 水平中心
  const top = 10           // 盾牌顶部 Y 坐标
  const bottom = 54        // 盾牌底部 Y 坐标
  const width = 22         // 盾牌最大半宽度

  for (let y = top; y <= bottom; y++) {
    const progress = (y - top) / (bottom - top)  // 0 → 1 从上到下
    // 盾牌形状：上半部逐渐变宽，下半部收窄到尖端
    let halfW: number
    if (progress < 0.7) {
      halfW = width * (0.6 + progress * 0.57)    // 0.6w → 1.0w（上半部逐渐变宽）
    } else {
      halfW = width * (1.0 - (progress - 0.7) / 0.3)  // 1.0w → 0（下半部收窄至尖端）
    }
    // 上半部白色，下半部绿色渐变
    const color = progress < 0.5 ? white : green
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      setPixel(x, y, color)
    }
  }

  // ── 第三步：绘制锁芯图案 ──────────────────────
  const keyholeY = 36
  // 锁芯圆形部分（半径 3 像素）
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy <= 9) setPixel(cx + dx, keyholeY + dy, darkGreen)
    }
  }
  // 锁芯矩形部分（向下延伸 8 像素）
  for (let dy = 0; dy < 8; dy++) {
    setPixel(cx - 2, keyholeY + 4 + dy, darkGreen)
    setPixel(cx - 1, keyholeY + 4 + dy, darkGreen)
    setPixel(cx + 1, keyholeY + 4 + dy, darkGreen)
    setPixel(cx + 2, keyholeY + 4 + dy, darkGreen)
  }
  setPixel(cx, keyholeY + 4, darkGreen)
  setPixel(cx, keyholeY + 5, darkGreen)

  // ── 第四步：将原始像素数据转换为 PNG 并保存 ──
  // nativeImage.createFromBuffer 接受原始 RGBA 像素数据
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size })
  const pngData = img.toPNG()
  writeFileSync(pngPath, pngData)

  // 同时保存到 resources 目录（用于打包时嵌入 exe）
  try {
    const resPath = join(__dirname, '../../resources/icon.png')
    writeFileSync(resPath, pngData)
  } catch {
    // resources 目录在生产构建中可能不存在，忽略错误
  }

  return pngPath
}

// ═══════════════════════════════════════════════════
// 应用启动入口
// ═══════════════════════════════════════════════════

app.whenReady().then(() => {
  // 注册所有 IPC 通信通道（必须在创建窗口之前）
  registerIpcHandlers()

  // 隐藏 Electron 默认菜单栏（密码管理器不需要菜单）
  Menu.setApplicationMenu(null)

  // 生成应用图标
  const iconPath = ensureIcon()

  // 创建浏览器窗口
  const win = new BrowserWindow({
    width: 900,                     // 窗口宽度
    height: 670,                    // 窗口高度
    icon: iconPath,                 // 窗口图标（显示在标题栏和任务栏）
    show: false,                    // 先隐藏，等 ready-to-show 再显示
    backgroundColor: '#0a0a0f',     // 窗口背景色与暗色主题一致，消除闪烁
    webPreferences: {
      // preload 脚本：contextBridge 暴露 API，不开启 nodeIntegration
      preload: join(__dirname, '../preload/index.js')
    }
  })

  // 加载渲染进程页面（React 应用）
  // 开发模式（npm run dev）：electron-vite 注入 ELECTRON_RENDERER_URL（Vite dev server 地址），
  // 必须加载该 URL 才能获得 HMR；否则加载构建产物 out/renderer/index.html
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 页面渲染就绪后再显示窗口，避免白屏/黑屏闪烁
  // 配合 show: false + backgroundColor + HTML 内联背景，三层防护
  win.once('ready-to-show', () => {
    win.show()
  })
})
