/**
 * env.d.ts — Vite 客户端类型声明 + Window API 类型扩展
 *
 * 此文件提供两层类型声明：
 *   1. Vite 客户端类型引用（/// <reference types="vite/client" />）
 *      提供 import.meta.env 等 Vite 特定 API 的类型
 *   2. Window.api 的类型声明
 *      扩展全局 Window 接口，声明 preload 脚本暴露的 API 形状
 *      这使得 TypeScript 可以类型检查所有 window.api.* 调用
 *
 * 类型必须与 preload/index.ts 的实际暴露对象保持同步，
 * 否则会导致编译时通过但运行时出错的情况。
 */

/// <reference types="vite/client" />

/**
 * 扩展全局 Window 接口
 *
 * Window.api 是 preload 脚本通过 contextBridge.exposeInMainWorld('api', ...)
 * 注入到渲染进程的全局对象。
 * 渲染进程中的代码通过 window.api.* 或直接 api.* 访问这些方法。
 */
interface Window {
  api: {
    /** 保险库生命周期 API */
    vault: {
      exists: () => Promise<boolean>
      create: (masterPassword: string) => Promise<void>
      unlock: (masterPassword: string) => Promise<boolean>
      lock: () => Promise<void>
      changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
      status: () => Promise<{ isUnlocked: boolean; exists: boolean }>
    }
    /** 条目 CRUD API */
    entries: {
      list: () => Promise<Entry[]>
      get: (id: string) => Promise<Entry | null>
      create: (entry: NewEntry) => Promise<Entry>
      update: (id: string, updates: Partial<Entry>) => Promise<Entry | null>
      delete: (id: string) => Promise<boolean>
      reorder: (orderedIds: string[]) => Promise<void>
    }
    /** 密码操作 API */
    password: {
      copy: (id: string) => Promise<void>
      clearClipboard: () => Promise<void>
      generate: (options?: PasswordOptions) => Promise<string>
    }
  }
}

/** 条目接口（与 preload/index.ts 的类型保持一致） */
interface Entry {
  id: string
  service: string
  username: string
  password: string
  url?: string
  notes?: string
  order: number
  createdAt: number
  updatedAt: number
}

/** 新条目输入接口（不含自动生成字段） */
interface NewEntry {
  service: string
  username: string
  password: string
  url?: string
  notes?: string
}

/** 密码生成选项接口 */
interface PasswordOptions {
  length?: number
  uppercase?: boolean
  lowercase?: boolean
  numbers?: boolean
  symbols?: boolean
}
