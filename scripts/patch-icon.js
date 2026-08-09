/**
 * Patches the packaged exe with the custom icon.
 * Run after electron-builder.
 */
const rcedit = require('rcedit')
const path = require('path')
const fs = require('fs')

const exePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'PassBox.exe')
const icoPath = path.join(__dirname, '..', 'resources', 'icon.ico')

if (!fs.existsSync(exePath)) {
  console.error('❌ ' + exePath + ' not found. Run electron-builder first.')
  process.exit(1)
}

if (!fs.existsSync(icoPath)) {
  console.error('❌ ' + icoPath + ' not found. Run npm run icon first.')
  process.exit(1)
}

rcedit(exePath, { icon: icoPath })
  .then(() => console.log('✅ App icon patched successfully!'))
  .catch((err) => {
    console.error('❌ Failed to patch icon:', err.message)
    process.exit(1)
  })
