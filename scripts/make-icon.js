/**
 * Generates icon.png + icon.ico with multiple resolutions.
 * Uses png-to-ico for proper BMP-format ICO.
 *
 * Usage: node scripts/make-icon.js
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const pngToIco = require('png-to-ico')

const OUT_DIR = path.join(__dirname, '..', 'resources')
const SIZES = [16, 32, 48, 256]

// ── PNG encoder (pure Node.js) ─────────────────────

function crc32(buf) {
  let c = 0xffffffff
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let d = n
    for (let k = 0; k < 8; k++) d = d & 1 ? (0xedb88320 ^ (d >>> 1)) : (d >>> 1)
    table[n] = d
  }
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crcBuf])
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(6, 9)

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0
    rgba.copy(row, 1, y * size * 4, (y + 1) * size * 4)
    rows.push(row)
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows))
  return Buffer.concat([SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))])
}

// ── Generate icon RGBA at given size ───────────────

function generateIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0)

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
  }

  // Background rounded rect
  const radius = Math.round(size * 0.19)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true
      if (x < radius && y < radius && (x - radius) ** 2 + (y - radius) ** 2 > radius ** 2) inside = false
      if (x >= size - radius && y < radius && (x - (size - 1 - radius)) ** 2 + (y - radius) ** 2 > radius ** 2) inside = false
      if (x < radius && y >= size - radius && (x - radius) ** 2 + (y - (size - 1 - radius)) ** 2 > radius ** 2) inside = false
      if (x >= size - radius && y >= size - radius && (x - (size - 1 - radius)) ** 2 + (y - (size - 1 - radius)) ** 2 > radius ** 2) inside = false
      if (inside) setPixel(x, y, 10, 10, 15)
    }
  }

  // Shield
  const cx = size / 2
  const top = Math.round(size * 0.16)
  const bottom = Math.round(size * 0.86)
  const shieldW = Math.round(size * 0.36)

  for (let y = top; y <= bottom; y++) {
    const progress = (y - top) / (bottom - top)
    let halfW = progress < 0.65 ? shieldW * (0.55 + progress * 0.7) : shieldW * (1.0 - (progress - 0.65) / 0.35)
    const [r, g, b] = progress < 0.55 ? [255, 255, 255] : [0, 200, 83]
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) setPixel(x, y, r, g, b)
  }

  // Keyhole
  const keyY = Math.round(size * 0.59)
  const holeR = Math.round(size * 0.07)
  for (let dy = -holeR; dy <= holeR; dy++)
    for (let dx = -holeR; dx <= holeR; dx++)
      if (dx * dx + dy * dy <= holeR * holeR) setPixel(cx + dx, keyY + dy, 0, 140, 50)

  const keyH = Math.round(size * 0.13)
  for (let dy = 0; dy < keyH; dy++)
    for (let dx = -holeR; dx <= holeR; dx++)
      setPixel(cx + dx, keyY + holeR + dy, 0, 140, 50)

  return buf
}

// ── Main ───────────────────────────────────────────

const pngs = []
for (const size of SIZES) {
  const rgba = generateIcon(size)
  const pngBuf = encodePng(rgba, size)
  const filePath = path.join(OUT_DIR, `icon-${size}.png`)
  fs.writeFileSync(filePath, pngBuf)
  pngs.push(pngBuf)
  console.log('  icon-' + size + '.png (' + pngBuf.length + ' bytes)')
}

// Save 256px as default icon.png
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), pngs[pngs.length - 1])

// Build ICO
pngToIco(pngs).then((icoBuf) => {
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), icoBuf)
  console.log('✅ icon.ico generated (' + icoBuf.length + ' bytes) with sizes: ' + SIZES.join(', '))

  // Clean up temp PNGs
  for (const size of SIZES) {
    fs.unlinkSync(path.join(OUT_DIR, 'icon-' + size + '.png'))
  }
}).catch((err) => {
  console.error('❌ png-to-ico failed:', err.message)
  process.exit(1)
})
