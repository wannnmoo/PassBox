/**
 * App.tsx — React 应用根组件
 *
 * 职责：整个渲染进程的入口组件
 *   - 主题管理（亮色/暗色切换，persist 到 localStorage）
 *   - 应用状态切换（解锁界面 ↔ 主界面）
 *   - Toast 通知上下文包装
 *
 * 组件树：
 *   App
 *   ├─ ToastProvider               （通知系统上下文）
 *   │   ├─ UnlockScreen            （创建保险库 / 输入主密码解锁）
 *   │   └─ ToastProvider
 *   │       └─ VaultScreen         （主界面：条目列表 + 详情 + 表单）
 *
 * 注意：解锁和主界面分别使用独立的 ToastProvider 实例，
 * 这是因为 React Context 在组件树不同分支中不会共享状态。
 * UnlockScreen 和 VaultScreen 各自需要独立的 Toast 通知。
 */

import { useState, useCallback } from 'react'
import UnlockScreen from './components/UnlockScreen'
import VaultScreen from './components/VaultScreen'
import { ToastProvider } from './components/Toast'
import './App.css'

/** 主题类型：dark（暗色）或 light（亮色） */
type Theme = 'dark' | 'light'

/**
 * 从 localStorage 获取初始主题设置
 *
 * 首次使用时默认返回 'light'（亮色主题），
 * 之后读取用户之前设置的主题偏好。
 */
function getInitialTheme(): Theme {
  return 'light'
}

/**
 * 应用主题到 DOM 并持久化
 *
 * 通过设置 <html data-theme="..."> 属性驱动 CSS 变量切换，
 * 同时保存到 localStorage 以便下次启动时恢复。
 */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('theme', theme)
}

/**
 * App 根组件
 *
 * 状态管理：
 *   - theme: 当前主题（dark/light）
 *   - unlocked: 保险库是否已解锁（决定显示哪个界面）
 */
export default function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [unlocked, setUnlocked] = useState(false)

  // 在渲染阶段同步应用主题（确保主题在首次渲染前就已生效）
  if (typeof document !== 'undefined') {
    applyTheme(theme)
  }

  // 解锁/锁定回调 — 使用 useCallback 避免子组件不必要的重渲染
  const handleUnlocked = useCallback(() => setUnlocked(true), [])
  const handleLocked = useCallback(() => setUnlocked(false), [])

  // 切换主题 — 函数式更新确保基于最新状态
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  // ── 未解锁状态：显示解锁界面 ──────────────────────
  if (!unlocked) {
    return (
      <ToastProvider>
        <UnlockScreen onUnlocked={handleUnlocked} />
      </ToastProvider>
    )
  }

  // ── 已解锁状态：显示主界面 ──────────────────────
  return (
    <ToastProvider>
      <VaultScreen onLocked={handleLocked} theme={theme} onToggleTheme={toggleTheme} />
    </ToastProvider>
  )
}
