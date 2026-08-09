/**
 * store.ts — 文件存储模块
 *
 * 职责：封装保险库文件（vault.dat）的底层读写操作
 *   - 确定文件路径（便携模式 vs 开发模式）
 *   - 文件存在性检查
 *   - 同步读写操作（因为主进程的 IPC handler 在异步上下文中调用，同步读写足够快）
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
 * 获取保险库文件的完整路径
 *
 * 路径判断逻辑：
 *   - app.isPackaged === true  → 生产打包模式 → exe 同级目录（便携模式）
 *   - app.isPackaged === false → 开发模式 → Electron 用户数据目录
 *
 * @returns vault.dat 的绝对路径
 */
function vaultPath(): string {
  if (app.isPackaged) {
    // 便携模式：vault.dat 与 exe 放在同一目录下
    // 例如：D:\PassBox\PassBox.exe  →  D:\PassBox\vault.dat
    return path.join(path.dirname(app.getPath('exe')), 'vault.dat')
  }
  // 开发模式：vault.dat 存放在 Electron 用户数据目录
  // 例如：C:\Users\<用户名>\AppData\Roaming\passbox\vault.dat
  return path.join(app.getPath('userData'), 'vault.dat')
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

/**
 * 写入保险库文件
 *
 * 将加密后的 JSON 数据写入 vault.dat，采用原子写入：
 *   先写临时文件，再重命名为正式文件，避免写入过程中断导致 vault.dat 损坏
 *   （直接覆盖写入时，进程崩溃/断电可能留下截断的坏文件）。
 * rename 在 Windows 上会覆盖已存在的目标文件。
 *
 * @param data - 要写入的字符串（加密后的 JSON）
 */
export function writeVault(data: string): void {
  const file = vaultPath()
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
