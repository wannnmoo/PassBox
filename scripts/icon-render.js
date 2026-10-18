/**
 * icon-render.js — PassBox 应用图标矢量渲染器（纯 Node.js，无原生依赖）
 *
 * 为什么不用 Canvas / sharp?
 *   项目刻意保持零原生模块依赖（打包体积小、无需 node-gyp 编译）。
 *   这里用 SDF（有向距离场）在浮点画布上逐像素合成，天然带抗锯齿：
 *   coverage = clamp(0.5 - d, 0, 1)，d 为像素单位的有向距离。
 *
 * 设计目标：
 *   1. 单一来源 —— scripts/make-icon.js 与主进程运行时共用同一份渲染代码/同一张 PNG
 *   2. 任意尺寸都清晰 —— 每个尺寸按矢量重新渲染（而非缩放位图），16px 也不糊
 *   3. 三种视觉方案可切换（见 VARIANTS）
 *
 * 用法：
 *   const { renderIcon, encodePng, VARIANTS } = require('./icon-render')
 *   const rgba = renderIcon(256, 'A')
 *
 * @typedef {{ id: string, name: string, note: string }} VariantInfo
 */

'use strict'

const zlib = require('zlib')

// ═══════════════════════════════════════════════════
// PNG 编码（逐行 filter=0，zlib 压缩）
// ═══════════════════════════════════════════════════

function crc32(buf) {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let d = n
    for (let k = 0; k < 8; k++) d = d & 1 ? 0xedb88320 ^ (d >>> 1) : d >>> 1
    table[n] = d
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crcBuf])
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * 将 RGBA 原始像素编码为 PNG（RGBA8，无调色板，filter 全 0）
 * @param {Uint8Array|Buffer} rgba 长度 = w*h*4，非预乘 alpha
 * @param {number} w
 * @param {number} h
 * @returns {Buffer}
 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // color type: RGBA
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace

  const rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4)
    row[0] = 0
    for (let i = 0; i < w * 4; i++) row[1 + i] = rgba[y * w * 4 + i]
    rows.push(row)
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 9 })
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ═══════════════════════════════════════════════════
// 数学 / 颜色工具
// ═══════════════════════════════════════════════════

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x)
const clamp01 = (x) => clamp(x, 0, 1)

/** 柔和解（用于渐变过渡），比线性更耐看 */
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** '#rrggbb' → [r, g, b]，取值 0..255 */
function hex(h) {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/** 线性插值两个颜色 */
function mix(c0, c1, t) {
  const k = clamp01(t)
  return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k]
}

/** 颜色整体变暗 / 变亮（k>0 提亮，k<0 压暗） */
function shade(c, k) {
  return k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k)
}

// ═══════════════════════════════════════════════════
// 有向距离场（SDF）：返回像素单位的距离，内部为负
// ═══════════════════════════════════════════════════

/** 圆角矩形（中心 + 半宽高 + 圆角半径） */
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r)
  const qy = Math.abs(py - cy) - (hy - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** 圆 */
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

/** 胶囊体（线段 + 半径） */
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay || 1))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

/** 多边形（凸/凹皆可），标量绕数法 */
function sdPolygon(poly, px, py) {
  const n = poly.length
  let d = (px - poly[0][0]) ** 2 + (py - poly[0][1]) ** 2
  let s = 1
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vix = poly[i][0]
    const viy = poly[i][1]
    const vjx = poly[j][0]
    const vjy = poly[j][1]
    const ex = vjx - vix
    const ey = vjy - viy
    const wx = px - vix
    const wy = py - viy
    const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey || 1))
    const bx = wx - ex * t
    const by = wy - ey * t
    d = Math.min(d, bx * bx + by * by)
    const b1 = py >= viy
    const b2 = py < vjy
    const b3 = ex * wy > ey * wx
    if ((b1 && b2 && b3) || (!b1 && !b2 && !b3)) s = -s
  }
  return s * Math.sqrt(d)
}

/** 并集 / 交集 / 差集 */
const sdUnion = (a, b) => Math.min(a, b)
const sdIntersect = (a, b) => Math.max(a, b)
const sdSubtract = (a, b) => Math.max(a, -b)

// ═══════════════════════════════════════════════════
// 浮点画布（直通 alpha，合成用 src-over）
// ═══════════════════════════════════════════════════

class Canvas {
  constructor(size) {
    this.size = size
    this.data = new Float64Array(size * size * 4)
  }

  /** 在像素索引 i 处以 src-over 方式合成一个颜色 */
  blend(i, r, g, b, a) {
    if (a <= 0.0005) return
    const d = this.data
    const da = d[i + 3]
    const oa = a + da * (1 - a)
    if (oa <= 0) return
    const wd = (da * (1 - a)) / oa
    const ws = a / oa
    d[i] = r * ws + d[i] * wd
    d[i + 1] = g * ws + d[i + 1] * wd
    d[i + 2] = b * ws + d[i + 2] * wd
    d[i + 3] = oa
  }

  /**
   * 按 SDF 填充一个形状，自动抗锯齿
   * @param {(x:number,y:number)=>number} sdf 像素坐标 → 有向距离
   * @param {(fx:number,fy:number)=>number[]} colorFn 归一到 0..1 的坐标 → [r,g,b]（0..255）
   * @param {(fx:number,fy:number)=>number} [alphaFn] 归一到 0..1 的坐标 → 透明度倍率
   */
  fill(sdf, colorFn, alphaFn) {
    const size = this.size
    for (let y = 0; y < size; y++) {
      const fy = y / size
      for (let x = 0; x < size; x++) {
        const fx = x / size
        const d = sdf(x + 0.5, y + 0.5)
        // 1px 覆盖宽度：d=-0.5 全内，d=+0.5 全外
        let cov = clamp01(0.5 - d)
        if (cov <= 0) continue
        if (alphaFn) cov *= alphaFn(fx, fy)
        if (cov <= 0) continue
        const c = colorFn(fx, fy)
        this.blend((y * size + x) * 4, c[0], c[1], c[2], cov)
      }
    }
  }

  /**
   * 软阴影：把同一形状多次向外膨胀填充，衰减叠加，模拟高斯模糊边缘
   * 比真实模糊便宜，且在 16px 下不会糊成一团。
   */
  softShadow(sdf, spreadPx, alpha, color = [0, 0, 0], steps = 4) {
    for (let k = steps; k >= 1; k--) {
      const grow = (spreadPx * k) / steps
      this.fill((x, y) => sdf(x, y) - grow, () => color, () => alpha / steps)
    }
  }

  toRGBA() {
    const n = this.size * this.size * 4
    const out = Buffer.alloc(n)
    const d = this.data
    for (let i = 0; i < n; i += 4) {
      const a = clamp01(d[i + 3])
      // 直通 alpha 输出（非预乘）
      out[i] = Math.round(clamp(d[i], 0, 255))
      out[i + 1] = Math.round(clamp(d[i + 1], 0, 255))
      out[i + 2] = Math.round(clamp(d[i + 2], 0, 255))
      out[i + 3] = Math.round(a * 255)
    }
    return out
  }
}

// ═══════════════════════════════════════════════════
// 图标几何（全部使用 0..1 归一化坐标，按尺寸缩放）
// ═══════════════════════════════════════════════════

/** 圆角方形底板（Windows 任务栏直接按位图显示，不做系统遮罩，故满幅绘制） */
function tileSdf(size, radiusRatio = 0.225) {
  const r = size * radiusRatio
  return (x, y) => sdRoundRect(x, y, size / 2, size / 2, size / 2, size / 2, r)
}

/**
 * 盾牌轮廓：顶部平直（四角小圆角）→ 两侧近垂直 → 下部平滑收束成尖
 *
 * 为什么用「半宽函数」而不是贝塞尔：
 *   taper(t) = halfW · (1 - t^1.6)^1.15
 *   t=0 处 dw/dt = 0，与垂直侧壁一阶连续（贝塞尔控制点一旦外扩就会在
 *   肩部留下折角）；t=1 处以 (1-t)^1.15 收束，末梢自然成尖而非钝头。
 *
 * @param {number} size
 * @param {{top?:number,width?:number,shoulder?:number,tip?:number,corner?:number,tExp?:number,wExp?:number}} o
 */
function shieldPoly(size, o = {}) {
  const top = (o.top ?? 0.185) * size
  const halfW = ((o.width ?? 0.60) / 2) * size
  const shoulder = (o.shoulder ?? 0.38) * size
  const tip = (o.tip ?? 0.845) * size
  const corner = (o.corner ?? 0.05) * size
  const tExp = o.tExp ?? 2.4
  const wExp = o.wExp ?? 0.7
  const cx = size / 2
  const ARC = 8
  const STEPS = 28

  /** 收束段半宽 */
  const taper = (t) => halfW * Math.pow(Math.max(0, 1 - Math.pow(t, tExp)), wExp)

  const pts = [[cx - halfW + corner, top]]

  // 顶边 → 右上圆角（-90° → 0°）
  pts.push([cx + halfW - corner, top])
  for (let i = 1; i <= ARC; i++) {
    const a = (-Math.PI / 2) * (1 - i / ARC)
    pts.push([cx + halfW - corner + corner * Math.cos(a), top + corner + corner * Math.sin(a)])
  }

  // 右侧直壁 → 收束至尖端
  pts.push([cx + halfW, shoulder])
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS
    pts.push([cx + taper(t), shoulder + (tip - shoulder) * t])
  }

  // 左侧收束回程（跳过与右侧共享的尖端）
  for (let i = STEPS - 1; i >= 0; i--) {
    const t = i / STEPS
    pts.push([cx - taper(t), shoulder + (tip - shoulder) * t])
  }

  // 左上圆角（180° → 270°），末点与起点重合，弹出以免零长边干扰绕数
  for (let i = 1; i <= ARC; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / ARC)
    pts.push([cx - halfW + corner + corner * Math.cos(a), top + corner + corner * Math.sin(a)])
  }
  pts.pop()

  return pts
}

/** 锁芯（圆 + 胶囊茎），经典钥匙孔轮廓 */
function keyholeSdf(size, o = {}) {
  const cx = size / 2
  const cy = (o.cy ?? 0.46) * size
  const r = (o.r ?? 0.098) * size
  const stemR = (o.stemR ?? 0.038) * size
  const stemEnd = (o.stemEnd ?? 0.68) * size
  return (x, y) =>
    sdUnion(
      sdCircle(x, y, cx, cy, r),
      sdCapsule(x, y, cx, cy + r * 0.45, cx, stemEnd, stemR)
    )
}

/** 挂锁：半环锁梁 + 圆角锁体 */
function padlockSdf(size, o = {}) {
  const cx = size / 2
  const bodyCY = (o.bodyCY ?? 0.655) * size
  const bodyHX = (o.bodyHX ?? 0.205) * size
  const bodyHY = (o.bodyHY ?? 0.135) * size
  const bodyR = (o.bodyR ?? 0.052) * size
  const ringCY = (o.ringCY ?? 0.47) * size
  const ringR = (o.ringR ?? 0.118) * size
  const ringTh = (o.ringTh ?? 0.034) * size

  return (x, y) => {
    const body = sdRoundRect(x, y, cx, bodyCY, bodyHX, bodyHY, bodyR)
    // 环：|距离 - 半径| ≤ 半环宽，再裁掉下半部分（保住上半环）
    const ring = Math.abs(sdCircle(x, y, cx, ringCY, ringR)) - ringTh
    const upperHalf = y - (bodyCY - bodyHY + bodyR * 0.4)
    const shackle = sdIntersect(ring, upperHalf)
    return sdUnion(body, shackle)
  }
}

// ═══════════════════════════════════════════════════
// 三种方案
// ═══════════════════════════════════════════════════

/** 方案元数据（供 CLI / 预览页展示） */
const VARIANTS = [
  {
    id: 'A',
    name: '翡翠盾牌',
    note: '翠绿渐变底板 + 白色盾牌 + 镂空锁芯：小尺寸辨识度最高，任务栏明亮环境下同样清晰'
  },
  {
    id: 'B',
    name: '深墨盾牌',
    note: '深墨底板 + 翠绿渐变盾牌 + 暗色锁芯：延续旧版暗色语言，但体积感与描边更精致'
  },
  {
    id: 'C',
    name: '翡翠挂锁',
    note: '翠绿底板 + 白色挂锁：最直白的「密码/上锁」语义，16px 仍可辨认'
  },
  {
    id: 'D',
    name: '哑光墨绿',
    note: '纯色墨绿底板 + 纯白盾牌 + 镂空锁芯，零渐变零高光：不反光、不油，Windows 11 扁平语言'
  },
  {
    id: 'E',
    name: '浅底绿盾',
    note: '近白底板 + 绿色盾牌 + 白色锁芯：清爽通透，浅色任务栏下最不抢眼'
  },
  {
    id: 'F',
    name: '哑光挂锁',
    note: '纯色正绿底板 + 纯白挂锁：语义最直白，同样去掉渐变与高光'
  }
]

/** 方案 A：翠绿底板 + 白盾 + 深绿钥匙孔 */
function drawVariantA(cv) {
  const size = cv.size
  const tile = tileSdf(size)
  const g0 = hex('#2fbf62')
  const g1 = hex('#0a5c2b')

  // 1) 底板：对角渐变
  cv.fill(tile, (fx, fy) => mix(g0, g1, clamp01(fy * 0.82 + (1 - fx) * 0.18)))

  // 2) 顶部高光（自上而下衰减），制造玻璃质感
  cv.fill(tile, () => [255, 255, 255], (fx, fy) => 0.14 * (1 - smoothstep(0.0, 0.55, fy)))

  // 3) 底部压暗，增加体积
  cv.fill(tile, () => [0, 0, 0], (fx, fy) => 0.18 * smoothstep(0.55, 1.0, fy))

  // 4) 内描边：1px 亮边，让底板边界更利落
  cv.fill(
    (x, y) => Math.abs(tile(x, y) + 0.9) - 0.55,
    () => [255, 255, 255],
    (fx, fy) => 0.22 * (1 - smoothstep(0.2, 1.0, fy))
  )

  // 5) 盾牌：软阴影 + 白色渐变
  const poly = shieldPoly(size)
  const shield = (x, y) => sdPolygon(poly, x, y)
  cv.softShadow(shield, size * 0.022, 0.28)
  cv.fill(shield, (fx, fy) => mix(hex('#ffffff'), hex('#e6f6ea'), clamp01((fy - 0.15) / 0.7)))

  // 6) 钥匙孔：用底的深绿，读作「挖穿」
  const hole = keyholeSdf(size)
  const holeColor = shade(mix(g0, g1, 0.72), -0.12)
  cv.fill(hole, () => holeColor)
  // 孔洞上沿一丝暗影，强化凹陷感
  cv.fill(
    (x, y) => Math.abs(hole(x, y) + 1.2) - 0.9,
    () => shade(holeColor, 0.25),
    (fx, fy) => 0.5 * (1 - smoothstep(0.3, 0.9, fy))
  )
}

/** 方案 B：深墨底板 + 翠绿渐变盾牌 */
function drawVariantB(cv) {
  const size = cv.size
  const tile = tileSdf(size, 0.235)
  const ink = hex('#0d1117')
  const g0 = hex('#5ce387')
  const g1 = hex('#0f9f45')

  // 1) 底板：近黑的墨色对角渐变
  cv.fill(tile, (fx, fy) => mix(hex('#1d2630'), hex('#080b0f'), clamp01(fy * 0.8 + (1 - fx) * 0.2)))
  // 2) 顶部高光
  cv.fill(tile, () => [255, 255, 255], (fx, fy) => 0.07 * (1 - smoothstep(0, 0.5, fy)))
  // 3) 翠绿内描边（品牌色钩边）
  cv.fill((x, y) => Math.abs(tile(x, y) + 1.6) - 0.75, () => hex('#2ea043'), (fx, fy) =>
    0.35 + 0.35 * (1 - fy)
  )

  // 4) 盾牌：翠绿渐变 + 软阴影
  const poly = shieldPoly(size, { top: 0.18, width: 0.585, shoulder: 0.385, tip: 0.845 })
  const shield = (x, y) => sdPolygon(poly, x, y)
  cv.softShadow(shield, size * 0.02, 0.45)
  cv.fill(shield, (fx, fy) => mix(g0, g1, clamp01((fy - 0.15) / 0.68)))

  // 5) 钥匙孔：底板墨色（同样读作挖穿）
  const hole = keyholeSdf(size)
  cv.fill(hole, () => ink)
}

/** 方案 C：翠绿底板 + 白色挂锁 */
function drawVariantC(cv) {
  const size = cv.size
  const tile = tileSdf(size)
  const g0 = hex('#31c265')
  const g1 = hex('#0b5f2d')

  cv.fill(tile, (fx, fy) => mix(g0, g1, clamp01(fy * 0.85 + (1 - fx) * 0.15)))
  cv.fill(tile, () => [255, 255, 255], (fx, fy) => 0.13 * (1 - smoothstep(0, 0.55, fy)))
  cv.fill(tile, () => [0, 0, 0], (fx, fy) => 0.16 * smoothstep(0.6, 1.0, fy))
  cv.fill((x, y) => Math.abs(tile(x, y) + 0.9) - 0.55, () => [255, 255, 255], (fx, fy) =>
    0.2 * (1 - smoothstep(0.2, 1.0, fy))
  )

  const lock = padlockSdf(size)
  cv.softShadow(lock, size * 0.02, 0.3)
  cv.fill(lock, (fx, fy) => mix(hex('#ffffff'), hex('#eaf7ee'), clamp01((fy - 0.35) / 0.55)))

  // 锁孔
  const cx = size / 2
  const cy = 0.625 * size
  const r = 0.045 * size
  const hole = (x, y) =>
    sdUnion(
      sdCircle(x, y, cx, cy, r),
      sdCapsule(x, y, cx, cy + r * 0.4, cx, (0.715 * size), 0.02 * size)
    )
  cv.fill(hole, () => shade(mix(g0, g1, 0.7), -0.1))
}

// ═══════════════════════════════════════════════════
// 哑光（flat）方案：去掉渐变 / 顶白高光 / 底部压暗 / 亮边
// ───────────────────────────────────────────────────
// 「绿色油乎乎」的成因是四层叠加：对角强渐变(#2fbf62→#0a5c2b) + 顶部 14% 白高光
// + 底部 18% 压暗 + 1px 白亮边 —— 正是 2010 年那种塑料反光质感。
// 这里改成纯色 + 极淡竖向亮度差(±1.5%) + 同色系细边，观感是"亚光漆"而不是"玻璃"。
// ═══════════════════════════════════════════════════

/** 纯色底板：可选极淡竖向亮度差与 1px 暗边（不带任何高光） */
function flatTile(cv, color, { border = null } = {}) {
  const size = cv.size
  const tile = tileSdf(size)
  const base = hex(color)
  cv.fill(tile, (fx, fy) => shade(base, (0.5 - fy) * 0.03))
  if (border) {
    cv.fill((x, y) => Math.abs(tile(x, y) + 0.9) - 0.55, () => hex(border))
  }
}

/** 方案 D（默认）：哑光墨绿底板 + 纯白盾牌 + 镂空锁芯 */
function drawVariantD(cv) {
  const size = cv.size
  const bg = '#0e6b3c'
  flatTile(cv, bg, { border: '#0a5430' })
  cv.fill((x, y) => sdPolygon(shieldPoly(size), x, y), () => hex('#ffffff'))
  cv.fill(keyholeSdf(size), () => hex(bg))
}

/** 方案 E：近白底板 + 绿色盾牌 + 白色锁芯 */
function drawVariantE(cv) {
  const size = cv.size
  const green = '#12804a'
  flatTile(cv, '#f1f4f2', { border: '#d7ded9' })
  cv.fill((x, y) => sdPolygon(shieldPoly(size), x, y), () => hex(green))
  cv.fill(keyholeSdf(size), () => hex('#ffffff'))
}

/** 方案 F：哑光正绿底板 + 纯白挂锁 */
function drawVariantF(cv) {
  const size = cv.size
  const bg = '#16864b'
  flatTile(cv, bg, { border: '#0f6d3c' })
  cv.fill(padlockSdf(size), () => hex('#ffffff'))

  const cx = size / 2
  const cy = 0.625 * size
  const r = 0.045 * size
  cv.fill(
    (x, y) =>
      sdUnion(
        sdCircle(x, y, cx, cy, r),
        sdCapsule(x, y, cx, cy + r * 0.4, cx, 0.715 * size, 0.02 * size)
      ),
    () => hex(bg)
  )
}

const PAINTERS = { A: drawVariantA, B: drawVariantB, C: drawVariantC, D: drawVariantD, E: drawVariantE, F: drawVariantF }

/**
 * 渲染指定尺寸与方案的图标
 * @param {number} size 像素边长
 * @param {'A'|'B'|'C'} [variant]
 * @returns {Buffer} RGBA 原始像素（非预乘）
 */
function renderIcon(size, variant = 'A') {
  const painter = PAINTERS[variant]
  if (!painter) throw new Error(`Unknown icon variant: ${variant}`)
  const cv = new Canvas(size)
  painter(cv)
  return cv.toRGBA()
}

module.exports = {
  renderIcon,
  encodePng,
  VARIANTS,
  // 供测试 / 二次设计使用
  _internals: { Canvas, sdPolygon, sdRoundRect, sdCircle, sdCapsule, shieldPoly, keyholeSdf, padlockSdf, hex, mix }
}
