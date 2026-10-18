/**
 * Toast.tsx — Toast 轻量级通知组件
 *
 * 职责：提供全局 Toast 通知系统，用于操作反馈（成功/错误/信息）
 *
 * 架构模式：React Context + Provider
 *   - ToastProvider：管理通知队列，渲染通知 DOM
 *   - useToast()：自定义 Hook，返回 { showToast } 函数
 *
 * 使用示例：
 *   const { showToast } = useToast()
 *   showToast('密码已复制')                    // 默认 success 类型
 *   showToast('操作失败', 'error')
 *   showToast('即将自动锁定...', 'info')
 *
 * 行为细节：
 *   - 每个 Toast 2.5 秒后自动消失
 *   - 点击 Toast 可立即关闭
 *   - 支持同时显示多条通知（从底部向上堆叠）
 *   - 三种类型各有独立颜色：success（绿）、error（红）、info（灰）
 *   - 支持亮色/暗色主题自适应
 */

import { createContext, useContext, useState, useCallback, memo } from 'react'
import { CheckCircle, XCircle, Info } from 'lucide-react'

/** Toast 通知类型 */
type ToastType = 'success' | 'error' | 'info'

/** 单条 Toast 通知的数据结构 */
interface ToastItem {
  id: number             // 唯一标识（用于移除），由 Date.now() + Math.random() 生成
  message: string        // 通知文本内容
  type: ToastType        // 通知类型，决定颜色和图标
}

/** Toast Context 暴露的值：仅提供 showToast 函数 */
interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

/** 创建 React Context，初始为 null，Provider 挂载后才赋值 */
const ToastContext = createContext<ToastContextValue | null>(null)

/** 各类型对应的图标组件（React 组件，非字符串） */
const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />
}

/**
 * useToast Hook
 *
 * 获取 Toast 通知函数的 Hook。
 * 必须在 ToastProvider 的子组件内调用，否则抛出错误。
 *
 * @returns { showToast } — 显示通知的函数
 * @throws 如果在 ToastProvider 外部调用
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

/**
 * ToastProvider 组件
 *
 * 管理通知队列的生命周期：
 *   1. showToast() 被调用 → 添加新通知到队列
 *   2. 2.5 秒后自动从队列移除
 *   3. 用户点击通知也可立即移除
 *
 * 使用 memo 优化性能：Provider 的子组件树通常较大，
 * 但 Provider 自身的状态变化（新增/移除通知）不应触发子组件重渲染。
 * 实际上这里 memo 效果有限，因为 value 中的 showToast 是稳定的 useCallback。
 */
export const ToastProvider = memo(function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  /**
   * 显示一条 Toast 通知
   *
   * @param message - 通知文本
   * @param type - 通知类型，默认 'success'
   */
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    // 生成唯一 ID（时间戳 + 随机数，避免同一毫秒创建多条时的冲突）
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type }])

    // 2.5 秒后自动移除
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2500)
  }, [])

  /** 点击通知时手动移除 */
  const handleRemove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {/* 子组件（应用内容） */}
      {children}

      {/* Toast 通知容器 — 使用 fixed 定位，独立于文档流
          role="status" + aria-live="polite"：屏幕阅读器会在不打断当前朗读的前提下
          播报新出现的通知（成功/错误反馈不能只靠颜色和位置传达） */}
      <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}  // 动态类名决定颜色
            onClick={() => handleRemove(toast.id)}     // 点击关闭
            // 错误通知按 alert 语义播报，优先级高于普通状态提示
            role={toast.type === 'error' ? 'alert' : undefined}
          >
            <span className="toast-icon" aria-hidden="true">{iconMap[toast.type]}</span>
            <span className="toast-message">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
})
