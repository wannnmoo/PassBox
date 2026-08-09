/**
 * types.ts — 渲染进程共享类型定义（re-export）
 *
 * 所有类型统一从 src/shared/types.ts 导入并重新导出，
 * 与主进程 vault.ts、preload 脚本共享同一份定义，避免多处重复。
 * 组件统一从 './types' 导入类型，无需感知其来源。
 */

export type {
  PasswordEntry,
  NewPasswordEntry,
  PasswordOptions,
  VaultStatus
} from '../../shared/types'
