/**
 * logic-test.js — 主进程保险库逻辑回归测试
 *
 * 为什么需要：`tsc` 只查类型，`npm run build` 只做转译，两者都覆盖不到
 * 「删条目后新增导致 order 撞号」「文件损坏被误报成密码错误」这类逻辑缺陷 ——
 * 而这些正是本轮修复的内容，因此用真实 Electron 运行时跑一遍 vault.ts。
 *
 * 做法：用 esbuild 把 src/main/vault.ts 打成临时 CJS（electron 作为 external），
 * 在临时 userData 目录里跑一遍完整生命周期，逐项断言。
 *
 * 用法：npx electron scripts/logic-test.js   （退出码 0 = 全部通过）
 */

const { app } = require('electron')
const { mkdtempSync, writeFileSync, rmSync, readdirSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')

const root = join(__dirname, '..')
const tmpUserData = mkdtempSync(join(tmpdir(), 'passbox-logic-'))
const bundlePath = join(root, '.tmp', 'vault.cjs')

app.disableHardwareAcceleration()
// 必须在 require vault 之前设定，vaultPath() 每次调用都会读取该路径
app.setPath('userData', tmpUserData)

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

app.whenReady().then(() => {
  require('esbuild').buildSync({
    entryPoints: [join(root, 'src/main/vault.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: bundlePath,
    logLevel: 'silent'
  })

  // store.ts 单独打一份：resolveDataDir 是纯函数，需要脱离 app.isPackaged 单测
  require('esbuild').buildSync({
    entryPoints: [join(root, 'src/main/store.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(root, '.tmp', 'store.cjs'),
    logLevel: 'silent'
  })

  const vault = require(bundlePath)
  const vaultFile = join(tmpUserData, 'vault.dat')

  try {
    // ── 1. 创建 + 新增条目 ──────────────────────────────
    vault.createVault('master-password-1')
    const a = vault.createEntry({ service: 'A', username: 'a', password: 'p1' })
    const b = vault.createEntry({ service: 'B', username: 'b', password: 'p2' })
    const c = vault.createEntry({ service: 'C', username: 'c', password: 'p3' })
    check('新建 3 条后 order 为 0/1/2', a.order === 0 && b.order === 1 && c.order === 2,
      `实际 ${a.order}/${b.order}/${c.order}`)

    // ── 2. 回归：删中间条目后新增不得撞号 ───────────────
    vault.deleteEntry(b.id)
    const d = vault.createEntry({ service: 'D', username: 'd', password: 'p4' })
    const orders = vault.listEntries().map((e) => e.order)
    const unique = new Set(orders).size === orders.length
    check('删条目后新增的 order 不与既有重复', unique, `orders=${JSON.stringify(orders)}`)
    check('新条目 order = max+1（应为 3）', d.order === 3, `实际 ${d.order}`)
    check('排序结果与服务名一致', JSON.stringify(vault.listEntries().map((e) => e.service)) === JSON.stringify(['A', 'C', 'D']),
      JSON.stringify(vault.listEntries().map((e) => e.service)))

    // ── 3. 回归：错误密码 vs 文件损坏必须可区分 ─────────
    vault.lockVault()
    const wrong = vault.unlockVault('definitely-wrong')
    check('错误密码 → reason=bad-password', wrong.ok === false && wrong.reason === 'bad-password',
      JSON.stringify(wrong))

    const right = vault.unlockVault('master-password-1')
    check('正确密码 → 解锁成功且条目完整', right.ok === true && vault.listEntries().length === 3)

    vault.lockVault()
    writeFileSync(vaultFile, '{"salt":"not-hex","iv":"zz","authTag":"zz","ciphertext":"zz"}')
    const corrupt = vault.unlockVault('master-password-1')
    check('损坏文件 → reason=corrupt（而非 bad-password）',
      corrupt.ok === false && corrupt.reason === 'corrupt', JSON.stringify(corrupt))

    vault.lockVault()
    writeFileSync(vaultFile, 'not json at all')
    const broken = vault.unlockVault('master-password-1')
    check('非 JSON 文件 → reason=corrupt', broken.ok === false && broken.reason === 'corrupt',
      JSON.stringify(broken))

    // ── 4. 改主密码：错误旧密码 / 正确流程 ─────────────
    // 用一份新保险库，避免刚才写入的损坏文件干扰
    rmSync(vaultFile, { force: true })
    vault.createVault('old-password-1')
    vault.createEntry({ service: 'Keep', username: 'u', password: 'pw' })

    const badOld = vault.changeMasterPassword('wrong-old', 'new-password-1')
    check('旧密码错误 → reason=bad-password', badOld.ok === false && badOld.reason === 'bad-password',
      JSON.stringify(badOld))

    const changed = vault.changeMasterPassword('old-password-1', 'new-password-1')
    check('正确修改主密码 → ok', changed.ok === true, JSON.stringify(changed))

    vault.lockVault()
    check('旧密码已失效', vault.unlockVault('old-password-1').ok === false)
    const relock = vault.unlockVault('new-password-1')
    check('新密码可解锁且条目仍在', relock.ok === true && vault.listEntries().length === 1)

    // ── 5. 备份文件 ────────────────────────────────────
    const backups = readdirSync(tmpUserData).filter((f) => f.startsWith('vault.dat.bak-'))
    check('已生成 vault.dat.bak-* 备份', backups.length > 0, `${backups.length} 个`)

    // ── 6. 回归：便携版数据目录必须落在 exe 真实位置而非 %TEMP% ──
    // 背景：portable launcher 把 app 解压到 %TEMP% 再运行，app.getPath('exe')
    // 指向临时目录（实测 C:\Users\...\Temp\3KqgoGeJbGjodwkTFRZripBBIYW\PassBox.exe），
    // 直接用它当数据目录会导致 vault.dat 关闭即丢。
    const store = require(join(root, '.tmp/store.cjs'))
    const portableWithVault = store.resolveDataDir({
      isPackaged: true,
      portableDir: 'D:\\Tools\\PassBox',
      hasPortableVault: true,
      exePath: 'C:\\Users\\u\\AppData\\Local\\Temp\\3Kqgo\\PassBox.exe',
      userDataDir: 'C:\\Users\\u\\AppData\\Roaming\\PassBox'
    })
    check('便携目录里已有 vault.dat → 数据跟着 exe 走', portableWithVault === 'D:\\Tools\\PassBox', portableWithVault)

    const portableEmpty = store.resolveDataDir({
      isPackaged: true,
      portableDir: 'D:\\Tools\\PassBox',
      hasPortableVault: false,
      exePath: 'C:\\Users\\u\\AppData\\Local\\Temp\\3Kqgo\\PassBox.exe',
      userDataDir: 'C:\\Users\\u\\AppData\\Roaming\\PassBox'
    })
    check('便携目录没有库 → 用 userData（否则写进 %TEMP% 会丢）', portableEmpty === 'C:\\Users\\u\\AppData\\Roaming\\PassBox', portableEmpty)

    const installed = store.resolveDataDir({
      isPackaged: true,
      portableDir: undefined,
      hasPortableVault: false,
      exePath: 'C:\\Program Files\\PassBox\\PassBox.exe',
      userDataDir: 'C:\\Users\\u\\AppData\\Roaming\\PassBox'
    })
    check('安装版不会写 Program Files，改用 userData', installed === 'C:\\Users\\u\\AppData\\Roaming\\PassBox', installed)

    const dev = store.resolveDataDir({
      isPackaged: false,
      portableDir: undefined,
      hasPortableVault: false,
      exePath: 'D:\\PassBox\\node_modules\\electron\\dist\\electron.exe',
      userDataDir: 'C:\\Users\\u\\AppData\\Roaming\\passbox'
    })
    check('开发模式用 userData（与安装版同目录）', dev === 'C:\\Users\\u\\AppData\\Roaming\\passbox', dev)
  } catch (err) {
    check('测试执行未抛异常', false, err && err.message)
  } finally {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} 通过`)
    rmSync(tmpUserData, { recursive: true, force: true })
    rmSync(join(root, '.tmp'), { recursive: true, force: true })
    app.exit(failed.length === 0 ? 0 : 1)
  }
})
