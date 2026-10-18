/**
 * electron-builder afterPack 钩子。
 *
 * 运行时机：app 目录已组装完、目标产物（portable exe / 安装包）尚未生成。
 * 在这里修补 exe，图标才能真正进到最终交付的那个文件里 —— 如果等
 * electron-builder 跑完再补，portable exe 早已从“未修补的 exe”复制出来了，
 * 最终产物仍会是 Electron 默认图标。
 */
const path = require('node:path')
const { patchExe } = require('./patch-icon')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  try {
    await patchExe(exePath, {
      productName: context.packager.appInfo.productName,
      description: context.packager.appInfo.description
    })
    console.log(`  • 已写入图标与版本信息：${exeName}`)
  } catch (err) {
    // 图标修补失败不应该让整个打包流程前功尽弃，但必须让人看得见
    console.warn(`  • 图标修补失败（${exeName}）：${err.message}`)
  }
}
