/**
 * env.d.ts — Vite 客户端类型声明 + Window API 类型扩展
 *
 * 此文件提供两层类型声明：
 *   1. Vite 客户端类型引用（/// <reference types="vite/client" />）
 *      提供 import.meta.env 等 Vite 特定 API 的类型
 *   2. Window.api 的类型声明
 *      扩展全局 Window 接口，声明 preload 脚本暴露的 API 形状，
 *      使 TypeScript 可以类型检查所有 window.api.* 调用
 *
 * 类型统一从 src/shared/types.ts 导入（与主进程 vault.ts、preload 共享），
 * 不在本地重复定义，避免多份类型因手工同步而漂移。
 */

/// <reference types="vite/client" />

import type { PasswordEntry, NewPasswordEntry, PasswordOptions, VaultStatus } from '../../shared/types'

/**
 * 扩展全局 Window 接口
 *
 * Window.api 是 preload 脚本通过 contextBridge.exposeInMainWorld('api', ...)
 * 注入到渲染进程的全局对象。渲染进程中的代码通过 window.api.* 访问这些方法。
 * 此文件通过 import 变成模块，因此全局扩展需放在 declare global 内。
 */
declare global {
  interface Window {
    api: {
      /** 保险库生命周期 API */
      vault: {
        exists: () => Promise<boolean>
        create: (masterPassword: string) => Promise<void>
        unlock: (masterPassword: string) => Promise<boolean>
        lock: () => Promise<void>
        changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
        status: () => Promise<VaultStatus>
      }
      /** 条目 CRUD API */
      entries: {
        list: () => Promise<PasswordEntry[]>
        get: (id: string) => Promise<PasswordEntry | null>
        create: (entry: NewPasswordEntry) => Promise<PasswordEntry>
        update: (id: string, updates: Partial<PasswordEntry>) => Promise<PasswordEntry | null>
        delete: (id: string) => Promise<boolean>
        reorder: (orderedIds: string[]) => Promise<void>
      }
      /** 密码操作 API */
      password: {
        copy: (id: string) => Promise<void>
        copyText: (text: string) => Promise<void>
        clearClipboard: () => Promise<void>
        generate: (options?: PasswordOptions) => Promise<string>
      }
    }
  }
}

export {}
