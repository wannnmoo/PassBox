/**
 * smoke-test.js — 构建产物冒烟测试（用 Electron 真跑一遍渲染进程）
 *
 * 为什么需要：`npm run build` 只做转译，`tsc` 只检查类型，
 * 两者都发现不了「sandbox: true 下 preload 没挂上」「CSP 把入口脚本拦掉导致白屏」
 * 这类运行时问题 —— 这些恰恰是安全加固最容易引入的回归。
 *
 * 用法：npm run build && npx electron scripts/smoke-test.js
 * 退出码 0 = 渲染成功且 window.api 可用；1 = 有问题（打印原因）。
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('path')

const errors = []
const root = join(__dirname, '..')

app.disableHardwareAcceleration()

/**
 * 最小 IPC 桩：解锁界面启动时只调 vault:exists。
 * 这里返回 false（模拟首次使用），用于确认渲染层能拿到 IPC 响应并完成一次状态流转；
 * 完整的业务通道由真实主进程注册，不在冒烟范围内。
 */
ipcMain.handle('vault:exists', () => false)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(root, 'out/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 收集渲染进程的 error/warning，CSP 拦截会以 console error 形式出现
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(message)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push(`render-process-gone: ${JSON.stringify(details)}`)
  })
  win.webContents.on('preload-error', (_event, path, error) => {
    errors.push(`preload-error: ${path}: ${error.message}`)
  })

  try {
    await win.loadFile(join(root, 'out/renderer/index.html'))
  } catch (err) {
    console.error('SMOKE FAIL: 页面加载失败', err)
    app.exit(1)
    return
  }

  await new Promise((resolve) => setTimeout(resolve, 1500))

  const info = await win.webContents.executeJavaScript(`(() => ({
    title: document.title,
    rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 80),
    hasApi: typeof window.api === 'object' && window.api !== null,
    apiGroups: window.api ? Object.keys(window.api) : [],
    csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null
  }))()`)

  const problems = []
  if (info.rootChildren <= 0) problems.push('React 未渲染（#root 为空）')
  if (!info.hasApi) problems.push('window.api 不可用（preload 未生效或 contextIsolation 配置有误）')
  if (!info.csp) problems.push('CSP meta 缺失')
  // IPC 握手是否真的通：桩返回 false，界面应切到"首次使用"文案
  if (!/首次使用|输入主密码/.test(info.text)) {
    problems.push(`界面未完成 IPC 握手（当前文案：${info.text}）`)
  }
  if (errors.length) problems.push(`渲染进程报错 ${errors.length} 条`)

  console.log('SMOKE', JSON.stringify(info, null, 2))
  if (errors.length) console.log('ERRORS', JSON.stringify(errors, null, 2))

  if (problems.length) {
    console.error('SMOKE FAIL:', problems.join('; '))
    app.exit(1)
  } else {
    console.log('SMOKE OK')
    app.exit(0)
  }
})
