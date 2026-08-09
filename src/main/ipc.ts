/**
 * ipc.ts — IPC（进程间通信）通道注册模块
 *
 * 职责：注册所有主进程 IPC handler，作为渲染进程与主进程之间的桥梁
 *   渲染进程（React）通过 window.api → ipcRenderer.invoke → ipcMain.handle → 主进程函数
 *
 * 架构说明：
 *   Electron 三层架构中的中间层（IPC Bridge）：
 *     渲染进程 ←→ preload (contextBridge) ←→ IPC (invoke/handle) ←→ 主进程模块
 *
 *   所有通道使用 ipcMain.handle / ipcRenderer.invoke 模式（请求-响应），
 *   而非 ipcMain.on / ipcRenderer.send 模式（单向消息）。
 *   这种模式支持 async/await 和返回值，更符合业务逻辑需求。
 *
 *   安全性：preload 脚本通过 contextBridge 仅暴露类型安全的 API，
 *   渲染进程无法直接调用 ipcRenderer，也无法访问 Node.js API。
 *
 * 通道分类：
 *   vault:*    — 保险库生命周期（创建、解锁、锁定、修改密码、状态）
 *   entries:*  — 条目 CRUD + 排序
 *   password:* — 密码复制、剪贴板清除、密码生成
 */

import { ipcMain } from 'electron'
import {
  createVault,
  unlockVault,
  lockVault,
  changeMasterPassword,
  isUnlocked,
  hasVault,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  reorderEntries
} from './vault'
import { copyToClipboard, clearClipboard } from './clipboard'
import { generatePassword } from './crypto'

/**
 * 注册所有 IPC 通信通道
 *
 * 在 app.whenReady() 中调用，确保在创建窗口之前就注册好 handler。
 * 每个 handler 都是主进程模块函数的薄封装，仅负责参数转发。
 */
export function registerIpcHandlers(): void {
  // ═══════════════════════════════════════════════════
  // Vault — 保险库生命周期管理
  // ═══════════════════════════════════════════════════

  /** 检查保险库文件是否存在 → 用于判断首次使用还是已有保险库 */
  ipcMain.handle('vault:exists', () => {
    return hasVault()
  })

  /** 创建新保险库 → 首次使用时设置主密码 */
  ipcMain.handle('vault:create', (_event, masterPassword: string) => {
    createVault(masterPassword)
  })

  /** 解锁保险库 → 验证主密码，成功后加载条目到内存 */
  ipcMain.handle('vault:unlock', (_event, masterPassword: string) => {
    return unlockVault(masterPassword)
  })

  /** 锁定保险库 → 清空内存中的密钥和条目 */
  ipcMain.handle('vault:lock', () => {
    lockVault()
  })

  /** 修改主密码 → 验证旧密码 + 重新加密 */
  ipcMain.handle('vault:change-password', (_event, oldPassword: string, newPassword: string) => {
    return changeMasterPassword(oldPassword, newPassword)
  })

  /** 获取保险库状态 → 解锁状态 + 存在性 */
  ipcMain.handle('vault:status', () => {
    return {
      isUnlocked: isUnlocked(),
      exists: hasVault()
    }
  })

  // ═══════════════════════════════════════════════════
  // Entries — 条目 CRUD 操作
  // ═══════════════════════════════════════════════════

  /** 列出所有条目 → 密码已掩码处理（••••••••） */
  ipcMain.handle('entries:list', () => {
    return listEntries()
  })

  /** 获取单个条目 → 包含明文密码 */
  ipcMain.handle('entries:get', (_event, id: string) => {
    return getEntry(id) ?? null  // 找不到返回 null 而非 undefined
  })

  /** 创建新条目 → 自动生成 UUID 和时间戳 */
  ipcMain.handle('entries:create', (_event, entry) => {
    return createEntry(entry)
  })

  /** 更新条目 → 支持部分字段更新 */
  ipcMain.handle('entries:update', (_event, id: string, updates) => {
    return updateEntry(id, updates) ?? null
  })

  /** 删除条目 → 永久删除，不可撤销 */
  ipcMain.handle('entries:delete', (_event, id: string) => {
    return deleteEntry(id)
  })

  /** 重新排序条目 → 拖拽排序后持久化 */
  ipcMain.handle('entries:reorder', (_event, orderedIds: string[]) => {
    reorderEntries(orderedIds)
  })

  // ═══════════════════════════════════════════════════
  // Password / Clipboard — 密码操作与剪贴板管理
  // ═══════════════════════════════════════════════════

  /** 复制密码到剪贴板 → 根据条目 ID 获取密码并复制，30 秒后自动清除 */
  ipcMain.handle('password:copy', (_event, id: string) => {
    const entry = getEntry(id)
    if (entry) {
      copyToClipboard(entry.password)
    }
  })

  /** 复制任意文本到剪贴板（30 秒后自动清除）→ 密码生成器等场景 */
  ipcMain.handle('password:copy-text', (_event, text: string) => {
    copyToClipboard(text)
  })

  /** 手动清除剪贴板 → 取消定时器并清空内容 */
  ipcMain.handle('password:clear-clipboard', () => {
    clearClipboard()
  })

  /** 生成随机密码 → 密码学安全随机（crypto.randomBytes），可配置长度和字符类型 */
  ipcMain.handle('password:generate', (_event, options) => {
    return generatePassword(options)
  })
}
