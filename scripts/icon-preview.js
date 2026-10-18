/**
 * icon-preview.js — 生成图标对比图，用于人工挑选方案 / 检查各尺寸清晰度
 *
 * 产物：
 *   resources/preview-variants.png  三种方案在亮色 + 暗色背景下的 256px 对比
 *   resources/preview-sizes.png     选定方案的多尺寸阶梯（16→256）
 *
 * 用法：node scripts/icon-preview.js [A|B|C|D|E|F]
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { renderIcon, encodePng, VARIANTS } = require('./icon-render')

const RESOURCES = path.resolve(__dirname, '..', 'resources')

const LIGHT = [244, 246, 249]
const DARK = [22, 26, 32]

/** 简易 RGBA 位图，支持把带 alpha 的图标贴到背景上 */
class Sheet {
  constructor(w, h, bg) {
    this.w = w
    this.h = h
    this.data = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      this.data[i * 4] = bg[0]
      this.data[i * 4 + 1] = bg[1]
      this.data[i * 4 + 2] = bg[2]
      this.data[i * 4 + 3] = 255
    }
  }

  /** 在 (ox, oy) 处 1:1 贴一张 size×size 的 RGBA 图标 */
  blit(rgba, size, ox, oy) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const si = (y * size + x) * 4
        const a = rgba[si + 3] / 255
        if (a <= 0) continue
        const dx = ox + x
        const dy = oy + y
        if (dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) continue
        const di = (dy * this.w + dx) * 4
        for (let c = 0; c < 3; c++) {
          this.data[di + c] = Math.round(rgba[si + c] * a + this.data[di + c] * (1 - a))
        }
      }
    }
  }
}

const PAD = 28
const GAP = 24

/** 三方案 256px 对比（上排亮色、下排暗色） */
function variantsSheet() {
  const cell = 256
  const w = PAD * 2 + cell * VARIANTS.length + GAP * (VARIANTS.length - 1)
  const h = PAD * 3 + cell * 2 + GAP
  const sheet = new Sheet(w, h, LIGHT)

  // 下半部分铺暗色底
  for (let y = 0; y < h; y++) {
    const darkZone = y >= PAD * 2 + cell + GAP
    if (!darkZone) continue
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      sheet.data[i] = DARK[0]
      sheet.data[i + 1] = DARK[1]
      sheet.data[i + 2] = DARK[2]
    }
  }

  VARIANTS.forEach((v, idx) => {
    const ox = PAD + idx * (cell + GAP)
    sheet.blit(renderIcon(cell, v.id), cell, ox, PAD)
    sheet.blit(renderIcon(cell, v.id), cell, ox, PAD * 2 + cell + GAP)
  })

  fs.writeFileSync(path.join(RESOURCES, 'preview-variants.png'), encodePng(sheet.data, w, h))
  console.log(`✓ preview-variants.png  ${w}×${h}（上排亮色 / 下排暗色；列序 ${VARIANTS.map((v) => v.id).join(' / ')}）`)
}

/** 单方案多尺寸阶梯（亮 / 暗各一排） */
function sizesSheet(variant) {
  const SIZES = [256, 128, 64, 48, 32, 24, 16]
  const w = PAD * 2 + SIZES.reduce((s, x) => s + x, 0) + GAP * (SIZES.length - 1)
  const rowH = 256 + PAD * 2
  const h = rowH * 2
  const sheet = new Sheet(w, h, LIGHT)

  for (let y = rowH; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      sheet.data[i] = DARK[0]
      sheet.data[i + 1] = DARK[1]
      sheet.data[i + 2] = DARK[2]
    }
  }

  const draw = (rowY) => {
    let x = PAD
    for (const s of SIZES) {
      // 每档底部对齐，便于观察细节随尺寸的损失
      const y = rowY + 256 - s
      sheet.blit(renderIcon(s, variant), s, x, y)
      x += s + GAP
    }
  }
  draw(PAD)
  draw(rowH + PAD)

  fs.writeFileSync(path.join(RESOURCES, 'preview-sizes.png'), encodePng(sheet.data, w, h))
  console.log(`✓ preview-sizes.png     ${w}×${h}（尺寸序 ${SIZES.join(' / ')}；方案 ${variant}）`)
}

const variant = (process.argv[2] || 'D').toUpperCase()
fs.mkdirSync(RESOURCES, { recursive: true })
variantsSheet()
sizesSheet(VARIANTS.some((v) => v.id === variant) ? variant : 'D')
