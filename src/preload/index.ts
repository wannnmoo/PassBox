/**
 * preload/index.ts — Electron 预加载脚本
 *
 * 职责：在渲染进程和主进程之间建立安全的通信桥梁
 *
 * 安全架构（Electron 推荐模式）：
 *   contextBridge.exposeInMainWorld() 在主世界（Main World）暴露有限 API，
 *   渲染进程通过 window.api 调用，无法直接访问：
 *     - ipcRenderer（无法发送任意 IPC 消息）
 *     - Node.js API（fs, crypto, os 等）
 *     - Electron 内部模块
 *
 * 这遵循了"最小权限原则"（Principle of Least Privilege）：
 *   渲染进程只知道它需要的 API，不知道底层 IPC 机制的存在。
 *
 * 类型安全性：
 *   此文件还定义了 Entry、NewEntry、PasswordOptions 接口，
 *   与主进程的 vault.ts 和渲染进程的 types.ts 保持同步。
 *   env.d.ts 中声明了 Window.api 的类型，确保 TypeScript 类型检查。
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { PasswordEntry, NewPasswordEntry, PasswordOptions } from '../shared/types'

/**
 * 通过 contextBridge 暴露到渲染进程的 API 对象
 *
 * 每个方法都是 ipcRenderer.invoke 的薄封装，
 * 采用 invoke/handle 模式（请求-响应），支持 async/await。
 *
 * API 按功能分为三组：
 *   vault    — 保险库生命周期
 *   entries  — 条目管理
 *   password — 密码操作和生成
 */
const api = {
  vault: {
    /** 检查保险库文件是否存在 */
    exists: (): Promise<boolean> => ipcRenderer.invoke('vault:exists'),
    /** 创建新保险库（首次使用） */
    create: (masterPassword: string): Promise<void> =>
      ipcRenderer.invoke('vault:create', masterPassword),
    /** 解锁保险库（验证主密码） */
    unlock: (masterPassword: string): Promise<boolean> =>
      ipcRenderer.invoke('vault:unlock', masterPassword),
    /** 锁定保险库（清空内存数据） */
    lock: (): Promise<void> => ipcRenderer.invoke('vault:lock'),
    /** 修改主密码 */
    changePassword: (oldPassword: string, newPassword: string): Promise<boolean> =>
      ipcRenderer.invoke('vault:change-password', oldPassword, newPassword),
    /** 获取保险库当前状态 */
    status: (): Promise<{ isUnlocked: boolean; exists: boolean }> =>
      ipcRenderer.invoke('vault:status')
  },
  entries: {
    /** 列出所有条目（密码已掩码） */
    list: (): Promise<PasswordEntry[]> => ipcRenderer.invoke('entries:list'),
    /** 获取单个条目（含明文密码） */
    get: (id: string): Promise<PasswordEntry | null> => ipcRenderer.invoke('entries:get', id),
    /** 创建新条目 */
    create: (entry: NewPasswordEntry): Promise<PasswordEntry> =>
      ipcRenderer.invoke('entries:create', entry),
    /** 更新条目（支持部分更新） */
    update: (id: string, updates: Partial<PasswordEntry>): Promise<PasswordEntry | null> =>
      ipcRenderer.invoke('entries:update', id, updates),
    /** 删除条目（不可撤销） */
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('entries:delete', id),
    /** 重新排序条目（拖拽排序后调用） */
    reorder: (orderedIds: string[]): Promise<void> =>
      ipcRenderer.invoke('entries:reorder', orderedIds)
  },
  password: {
    /** 复制条目密码到剪贴板（30 秒后自动清除） */
    copy: (id: string): Promise<void> => ipcRenderer.invoke('password:copy', id),
    /** 复制任意文本到剪贴板（30 秒后自动清除），如生成器生成的密码 */
    copyText: (text: string): Promise<void> => ipcRenderer.invoke('password:copy-text', text),
    /** 手动清除剪贴板 */
    clearClipboard: (): Promise<void> => ipcRenderer.invoke('password:clear-clipboard'),
    /** 生成随机密码（密码学安全） */
    generate: (options?: PasswordOptions): Promise<string> =>
      ipcRenderer.invoke('password:generate', options)
  }
}

// 将 API 暴露到渲染进程的 window.api 上
contextBridge.exposeInMainWorld('api', api)

// ═══════════════════════════════════════════════════
// 类型说明
// 条目/密码相关类型统一从 src/shared/types.ts 导入，
// 与主进程 vault.ts、渲染进程 types.ts 共享同一份定义。
// ═══════════════════════════════════════════════════
