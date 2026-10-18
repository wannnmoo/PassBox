/**
 * 把自定义图标与版本信息写进 exe（可被 after-pack.js 复用，也可单独跑）。
 *
 * 为什么不交给 electron-builder 自己处理：electron-builder 编辑 exe 资源
 * 依赖 winCodeSign 工具包，而它的 7z 解包会尝试创建 macOS 的符号链接，
 * 普通权限的 Windows 上必然失败（"客户端没有所需的特权"），导致 pack/dist
 * 直接中断。因此 build 配置里设了 win.signAndEditExecutable=false 跳过该
 * 步骤，改由 after-pack.js 在打包阶段调用本模块补齐图标与版本信息。
 */
const rcedit = require('rcedit')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..')
const DEFAULT_ICO = path.join(ROOT, 'resources', 'icon.ico')

/**
 * @param {string} exePath 要修补的 exe 绝对路径
 * @param {{ icoPath?: string, productName?: string, description?: string }} [options]
 */
async function patchExe(exePath, options = {}) {
  const icoPath = options.icoPath || DEFAULT_ICO
  if (!fs.existsSync(exePath)) throw new Error(`找不到 exe：${exePath}`)
  if (!fs.existsSync(icoPath)) throw new Error(`找不到图标：${icoPath}（先跑 npm run icon）`)

  const pkg = require(path.join(ROOT, 'package.json'))
  await rcedit(exePath, {
    icon: icoPath,
    'file-version': pkg.version,
    'product-version': pkg.version,
    'requested-execution-level': 'asInvoker',
    'version-string': {
      CompanyName: options.companyName || pkg.author || 'PassBox',
      FileDescription: options.description || pkg.description || 'PassBox',
      ProductName: options.productName || pkg.build?.productName || pkg.name,
      LegalCopyright: `Copyright © ${new Date().getFullYear()} ${pkg.author || 'PassBox'}`
    }
  })
  return exePath
}

module.exports = { patchExe, DEFAULT_ICO }

if (require.main === module) {
  const exePath = process.argv[2] || path.join(ROOT, 'dist', 'win-unpacked', 'PassBox.exe')
  patchExe(exePath)
    .then((p) => console.log(`✅ 已写入图标与版本信息：${path.relative(ROOT, p)}`))
    .catch((err) => {
      console.error('❌ ' + err.message)
      process.exit(1)
    })
}
