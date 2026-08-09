/**
 * shared/types.ts — 跨进程共享类型定义（唯一来源）
 *
 * 主进程（vault.ts）、preload 脚本（index.ts）与渲染进程（types.ts / env.d.ts）
 * 都从这里导入类型，避免在多处重复定义导致字段不一致。
 * 注意：contextBridge 在编译期不共享类型，本文件仅提供编译期类型安全，
 * 运行时数据形状由主进程 vault.ts 的序列化决定。
 */

/** 密码条目（完整模型） */
export interface PasswordEntry {
  id: string           // 唯一标识符（UUID v4）
  service: string      // 服务名称，例如 "Google", "GitHub"
  username: string     // 用户名或邮箱
  password: string     // 明文密码（仅在详情视图展示，列表视图显示掩码）
  url?: string         // 可选：关联网址
  notes?: string       // 可选：备注信息
  order: number        // 排序序号，用于拖拽排序
  createdAt: number    // 创建时间戳（Unix 毫秒）
  updatedAt: number    // 最后更新时间戳（Unix 毫秒）
}

/** 新条目输入类型 — 排除自动生成的字段（id, order, createdAt, updatedAt） */
export type NewPasswordEntry = Omit<PasswordEntry, 'id' | 'order' | 'createdAt' | 'updatedAt'>

/** 密码生成选项 — 传递给 password:generate IPC 通道 */
export interface PasswordOptions {
  length?: number       // 密码长度，默认 20
  uppercase?: boolean   // 是否包含大写字母 A-Z
  lowercase?: boolean   // 是否包含小写字母 a-z
  numbers?: boolean     // 是否包含数字 0-9
  symbols?: boolean     // 是否包含特殊符号 !@#$...
}

/** 保险库状态 — 从 vault:status IPC 通道返回 */
export interface VaultStatus {
  isUnlocked: boolean   // 保险库是否已解锁
  exists: boolean       // 保险库文件是否存在
}
