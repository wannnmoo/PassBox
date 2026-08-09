/**
 * clipboard.ts — 剪贴板管理模块
 *
 * 职责：安全的剪贴板操作
 *   - 将密码文本写入系统剪贴板
 *   - 30 秒后自动清除剪贴板，防止密码长时间残留
 *   - 再次复制时重置计时器（覆盖之前的定时清除）
 *   - 支持手动清除
 *
 * 安全考量：
 *   剪贴板是系统级共享资源，其他应用可以读取其内容。
 *   30 秒的自动清除窗口在"方便用户粘贴"和"减少密码泄露风险"之间取得平衡。
 *   大多数密码管理器使用 30-60 秒的自动清除时间。
 */

import { clipboard } from 'electron'

/** 清除剪贴板的定时器句柄，用于取消和重置定时器 */
let clearTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 将文本复制到系统剪贴板，并设置 30 秒自动清除
 *
 * 行为细节：
 *   - 如果已有定时器在运行（上次复制还未清除），先取消旧定时器再设置新的
 *   - 每次复制都获得完整的 30 秒窗口，不会因为上次复制缩短时间
 *   - 使用 Electron 的 clipboard.writeText()，支持跨平台剪贴板
 *
 * @param text - 要复制到剪贴板的文本（密码明文）
 */
export function copyToClipboard(text: string): void {
  // 写入系统剪贴板
  clipboard.writeText(text)

  // 如果已有定时器（上次复制的密码还在等待清除），取消它
  if (clearTimer) {
    clearTimeout(clearTimer)
  }

  // 设置新的 30 秒自动清除定时器
  clearTimer = setTimeout(() => {
    clearClipboard()
  }, 30_000)
}

/**
 * 手动清除剪贴板
 *
 * 取消定时器（如果有）并清空剪贴板内容。
 * 可用于：
 *   - 用户主动清除（例如点击"清除剪贴板"按钮）
 *   - 30 秒自动清除定时器触发
 *   - 应用退出前的清理
 */
export function clearClipboard(): void {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  // 清空剪贴板，防止密码残留
  clipboard.clear()
}
