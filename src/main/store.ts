/**
 * store.ts — 文件存储模块
 *
 * 职责：封装保险库文件（vault.dat）的底层读写操作
 *   - 确定文件路径（便携模式 vs 开发模式）
 *   - 文件存在性检查
 *   - 同步读写操作（因为主进程的 IPC handler 在异步上下文中调用，同步读写足够快）
 *   - 保存前自动备份（滚动保留最近 N 份）
 *   - 删除保险库文件
 *
 * 存储路径策略：
 *   - 生产模式（打包后）：vault.dat 在 exe 同级目录（便携模式）
 *     好处：用户可以将 exe + vault.dat 放在 U 盘等便携设备上
 *   - 开发模式（npm run dev）：vault.dat 在 Electron userData 目录
 *     好处：不会在项目源码目录中产生数据文件
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * 纯函数：决定保险库数据目录（抽出来是为了能脱离 Electron 单测）
 *
 * 优先级：
 *   1. 便携版 launcher 注入的 PORTABLE_EXECUTABLE_DIR（用户双击 exe 的真实目录）
 *   2. 打包模式回退：exe 同级目录（`--dir` 打出来的 win-unpacked 走这条）
 *   3. 开发模式：userData 目录
 */
export function resolveDataDir(opts: {
  isPackaged: boolean
  portableDir?: string | undefined
  exePath: string
  userDataDir: string
}): string {
  if (!opts.isPackaged) return opts.userDataDir
  if (opts.portableDir) return opts.portableDir
  return path.dirname(opts.exePath)
}

/**
 * 获取保险库文件的完整路径
 *
 * ⚠️ 便携版为什么必须先看 PORTABLE_EXECUTABLE_DIR：
 * electron-builder 的 portable launcher 会把 app 解压到 `%TEMP%\<随机名>\` 再运行，
 * 退出后清理该目录。所以 app.getPath('exe') 指向的是那个临时目录，
 * 直接拿它当数据目录 → vault.dat 写进临时目录 → 关闭即丢（实测临时路径形如
 * `C:\Users\<用户名>\AppData\Local\Temp\3KqgoGeJbGjodwkTFRZripBBIYW\PassBox.exe`）。
 * launcher 会额外注入 PORTABLE_EXECUTABLE_DIR 指回用户双击 exe 的真实位置。
 *
 * @returns vault.dat 的绝对路径
 */
function vaultPath(): string {
  return path.join(
    resolveDataDir({
      isPackaged: app.isPackaged,
      portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
      exePath: app.getPath('exe'),
      userDataDir: app.getPath('userData')
    }),
    'vault.dat'
  )
}

/** 供测试 / 诊断使用：暴露实际使用的数据目录 */
export function resolveVaultDir(): string {
  return path.dirname(vaultPath())
}

/**
 * 检查保险库文件是否存在
 *
 * @returns true 表示 vault.dat 存在
 */
export function vaultExists(): boolean {
  return fs.existsSync(vaultPath())
}

/**
 * 读取保险库文件内容
 *
 * 读取整个 vault.dat 文件，返回其 UTF-8 文本内容。
 * 文件内容是加密后的 JSON 字符串。
 *
 * @returns vault.dat 的文本内容（加密的 JSON）
 * @throws 如果文件不存在，fs.readFileSync 会抛出异常
 */
export function readVault(): string {
  return fs.readFileSync(vaultPath(), 'utf8')
}

/** 备份滚动保留份数 —— 太多占用磁盘，太少失去历史价值，5 份是合理平衡 */
const BACKUP_KEEP = 5

/**
 * 生成备份文件名的固定宽度时间戳
 *
 * YYYYMMDD-HHmmss-SSS 格式保证按文件名字典序排序 == 按时间先后排序，
 * 便于清理旧备份；毫秒精度避免同一秒内多次保存导致文件名冲突。
 */
function backupTimestamp(date = new Date()): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return (
    pad(date.getFullYear(), 4) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds()) +
    '-' +
    pad(date.getMilliseconds(), 3)
  )
}

/** 清理超出保留份数的旧备份（文件名按字典序排序，最旧在前） */
function pruneBackups(file: string): void {
  const dir = path.dirname(file)
  const prefix = `${path.basename(file)}.bak-`
  const backups = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort()
  while (backups.length > BACKUP_KEEP) {
    const oldest = backups.shift()!
    fs.unlinkSync(path.join(dir, oldest))
  }
}

/**
 * 保存前备份当前 vault.dat（滚动保留最近 BACKUP_KEEP 份）
 *
 * 在原子写入覆盖 vault.dat 之前，先把当前版本复制为带时间戳的备份
 * （如 vault.dat.bak-20260809-120000-123）。这样即使新写入损坏，
 * 仍有历史版本可恢复，与原子写入构成双重保险。
 * 备份是尽力而为（best-effort）：失败只记录警告，不阻塞保存。
 */
function backupVault(file: string): void {
  try {
    if (!fs.existsSync(file)) return
    fs.copyFileSync(file, `${file}.bak-${backupTimestamp()}`)
    pruneBackups(file)
  } catch (err) {
    // 备份失败不应阻塞保存 —— 主文件仍会正常写入
    console.warn('[store] 保险库备份失败:', err)
  }
}

/**
 * 写入保险库文件
 *
 * 将加密后的 JSON 数据写入 vault.dat，分两步保护数据：
 *   1. 先备份当前版本（滚动保留最近 BACKUP_KEEP 份）
 *   2. 原子写入：先写临时文件，再重命名为正式文件
 *      避免写入过程中断导致 vault.dat 损坏（直接覆盖时，进程崩溃/断电
 *      可能留下截断的坏文件）。rename 在 Windows 上会覆盖已存在的目标文件。
 *
 * @param data - 要写入的字符串（加密后的 JSON）
 */
export function writeVault(data: string): void {
  const file = vaultPath()
  backupVault(file)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data, 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 删除保险库文件
 *
 * 仅在确认文件存在时才执行删除，避免不必要的异常。
 * 注意：此函数已导出但当前未被使用，保留用于未来功能（如重置保险库）。
 */
export function deleteVault(): void {
  if (vaultExists()) {
    fs.unlinkSync(vaultPath())
  }
}
