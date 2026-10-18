/**
 * make-icon.js — 生成应用图标资源（PNG 多尺寸 + ICO）与内嵌图标模块
 *
 * 产物：
 *   resources/icon.png        256×256 主图标（窗口/任务栏/Linux）
 *   resources/icon.ico        多尺寸 ICO（16/24/32/48/64/128/256，Windows exe）
 *   resources/icon-<n>.png    各尺寸 PNG（便于逐尺寸核对清晰度）
 *   src/main/app-icon.ts      内嵌 base64 图标（主进程运行时无需读盘）
 *
 * 用法：
 *   node scripts/make-icon.js            # 默认方案 A
 *   node scripts/make-icon.js B          # 指定方案
 *   node scripts/icon-preview.js         # 生成三方案对比图
 *
 * 说明：图标全部由 scripts/icon-render.js 矢量渲染，同一份代码产出
 * 所有尺寸与格式，保证「窗口图标 = 打包图标 = 内嵌图标」完全一致。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { renderIcon, encodePng, VARIANTS } = require('./icon-render')

const ROOT = path.resolve(__dirname, '..')
const RESOURCES = path.join(ROOT, 'resources')
const APP_ICON_TS = path.join(ROOT, 'src', 'main', 'app-icon.ts')

/** ICO 内嵌的尺寸集合（Windows 会在不同 DPI/位置自动挑用） */
const SIZES = [16, 24, 32, 48, 64, 128, 256]
/** 主图标尺寸 */
const MASTER = 256

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function renderPng(size, variant) {
  return encodePng(renderIcon(size, variant), size, size)
}

/** 生成多尺寸 ICO（每帧塞入 PNG，Vista 以上原生支持） */
async function makeIco(variant) {
  let pngToIco
  try {
    pngToIco = require('png-to-ico')
  } catch {
    console.warn('  ! 未安装 png-to-ico，跳过 ICO（exe 图标不会被替换）')
    return false
  }
  // 大尺寸优先，部分打包工具按顺序取帧
  const frames = SIZES.slice()
    .reverse()
    .map((s) => renderPng(s, variant))
  // png-to-ico 的导出形态随版本变化：可能是函数本身，也可能挂在 .default 上
  const toIco = typeof pngToIco === 'function' ? pngToIco : pngToIco.default
  const ico = await toIco(frames)
  fs.writeFileSync(path.join(RESOURCES, 'icon.ico'), ico)
  console.log(`  ✓ icon.ico          ${frames.length} 帧 · ${(ico.length / 1024).toFixed(1)} KB`)
  return true
}

/** 生成内嵌图标模块，供主进程运行时使用（无需读盘 / 不受 asar 影响） */
function writeEmbeddedModule(variant, masterPng) {
  const meta = VARIANTS.find((v) => v.id === variant)
  const b64 = masterPng.toString('base64')
  // 每 120 字符换行，避免单行超长
  const wrapped = b64.replace(/(.{120})/g, '$1\n  ')

  const source = `/**
 * app-icon.ts — 应用图标（自动生成，请勿手改）
 *
 * 由 scripts/make-icon.js 生成，源自 scripts/icon-render.js 的矢量渲染。
 * 内嵌为 base64 而非运行时读盘：打包成 asar / 便携 exe 后资源路径不可靠，
 * 内嵌常量在任何分发形态下都能拿到同一张图。
 *
 * 方案：${variant} · ${meta ? meta.name : ''}
 * 尺寸：${MASTER}×${MASTER}
 * 重新生成：npm run icon
 */
export const ICON_VARIANT = '${variant}'
export const ICON_SIZE = ${MASTER}
export const ICON_PNG_BASE64 = \`${wrapped}
\`
`
  fs.writeFileSync(APP_ICON_TS, source, 'utf8')
  console.log(
    `  ✓ src/main/app-icon.ts  ${(source.length / 1024).toFixed(1)} KB（内嵌 ${MASTER}px PNG）`
  )
}

async function main() {
  const argVariant = (process.argv[2] || process.env.ICON_VARIANT || 'D').toUpperCase()
  const variant = VARIANTS.some((v) => v.id === argVariant) ? argVariant : 'A'
  const meta = VARIANTS.find((v) => v.id === variant)

  console.log(`\n生成图标 —— 方案 ${variant}「${meta.name}」`)
  console.log(`  ${meta.note}\n`)

  ensureDir(RESOURCES)

  // 1) 各尺寸 PNG：逐尺寸矢量渲染（非缩放），小尺寸不会糊
  for (const size of SIZES) {
    const png = renderPng(size, variant)
    fs.writeFileSync(path.join(RESOURCES, `icon-${size}.png`), png)
    if (size === MASTER) fs.writeFileSync(path.join(RESOURCES, 'icon.png'), png)
    console.log(`  ✓ icon-${size}.png${' '.repeat(8 - String(size).length)}${(png.length / 1024).toFixed(1)} KB`)
  }

  // 2) ICO（多尺寸）
  await makeIco(variant)

  // 3) 内嵌图标模块
  writeEmbeddedModule(variant, renderPng(MASTER, variant))

  console.log('\n完成。窗口图标 / 任务栏图标 / 打包 exe 图标已同源。\n')
}

main().catch((err) => {
  console.error('图标生成失败：', err)
  process.exit(1)
})
