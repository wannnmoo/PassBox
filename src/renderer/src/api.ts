/**
 * api.ts — 渲染进程 API 封装层
 *
 * 职责：对 window.api（preload 暴露的 IPC 桥接）进行类型化封装，
 *       提供按功能分组的、类型安全的 API 调用接口。
 *
 * 为什么需要这一层？
 *   1. 集中管理所有 IPC 调用，便于查找和修改
 *   2. 提供 JSDoc 注释，方便 IDE 智能提示
 *   3. 类型安全：泛型 Promise 返回值，编译时类型检查
 *   4. 如果未来需要添加请求拦截、错误处理、重试逻辑，只需修改这一层
 *
 * 使用示例：
 *   import { vault, entries, password } from '../api'
 *   const list = await entries.list()
 *   await vault.lock()
 */

import type {
  PasswordEntry,
  NewPasswordEntry,
  PasswordOptions,
  VaultStatus,
  UnlockResult,
  UnlockFailureReason,
  ChangePasswordResult,
  ChangePasswordFailureReason
} from './types'

// 重新导出类型，方便其他模块通过 './api' 一站式导入
export type {
  PasswordEntry,
  NewPasswordEntry,
  PasswordOptions,
  VaultStatus,
  UnlockResult,
  UnlockFailureReason,
  ChangePasswordResult,
  ChangePasswordFailureReason
}

/** 获取 preload 脚本暴露的 API 对象引用 */
const api = window.api

/**
 * 保险库 API — 管理保险库的生命周期
 */
export const vault = {
  /** 检查保险库文件是否存在 */
  exists: (): Promise<boolean> => api.vault.exists(),
  /** 创建新保险库 */
  create: (masterPassword: string): Promise<void> => api.vault.create(masterPassword),
  /** 解锁保险库（验证主密码）→ 成功与否 + 失败原因 */
  unlock: (masterPassword: string): Promise<UnlockResult> => api.vault.unlock(masterPassword),
  /** 锁定保险库 */
  lock: (): Promise<void> => api.vault.lock(),
  /** 修改主密码 → 成功与否 + 失败原因 */
  changePassword: (oldPassword: string, newPassword: string): Promise<ChangePasswordResult> =>
    api.vault.changePassword(oldPassword, newPassword),
  /** 获取保险库当前状态 */
  status: (): Promise<VaultStatus> => api.vault.status()
}

/**
 * 条目 API — 管理密码条目的 CRUD 操作
 */
export const entries = {
  /** 列出所有条目（密码已掩码） */
  list: (): Promise<PasswordEntry[]> => api.entries.list(),
  /** 获取单个条目（含明文密码） */
  get: (id: string): Promise<PasswordEntry | null> => api.entries.get(id),
  /** 创建新条目 */
  create: (entry: NewPasswordEntry): Promise<PasswordEntry> => api.entries.create(entry),
  /** 更新条目（支持部分字段更新） */
  update: (id: string, updates: Partial<PasswordEntry>): Promise<PasswordEntry | null> =>
    api.entries.update(id, updates),
  /** 删除条目（不可撤销） */
  delete: (id: string): Promise<boolean> => api.entries.delete(id),
  /** 重新排序条目（拖拽排序后持久化） */
  reorder: (orderedIds: string[]): Promise<void> => api.entries.reorder(orderedIds)
}

/**
 * 密码 API — 密码操作和生成
 */
export const password = {
  /** 复制条目密码到剪贴板（30 秒后自动清除） */
  copy: (id: string): Promise<void> => api.password.copy(id),
  /** 复制任意文本到剪贴板（30 秒后自动清除），如生成器生成的密码 */
  copyText: (text: string): Promise<void> => api.password.copyText(text),
  /** 手动清除剪贴板 */
  clearClipboard: (): Promise<void> => api.password.clearClipboard(),
  /** 生成密码学安全的随机密码 */
  generate: (options?: PasswordOptions): Promise<string> => api.password.generate(options)
}
