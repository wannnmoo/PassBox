/**
 * ConfirmDialog.tsx — 确认对话框组件
 *
 * 职责：替代浏览器原生 confirm() 的自定义模态对话框
 *
 * 为什么需要自定义对话框？
 *   1. 原生 confirm() 外观无法自定义，与应用的 Matrix Green 主题不协调
 *   2. 原生 confirm() 在不同操作系统上的外观不一致
 *   3. 支持 danger 模式（红色警告样式），原生 API 不支持
 *   4. 支持动画效果（fade + scale）
 *   5. 完全可控的交互行为（点击遮罩关闭、Esc 关闭）
 *
 * 使用示例：
 *   <ConfirmDialog
 *     open={showConfirm}
 *     title="确认删除"
 *     message="确定要删除这条记录吗？此操作不可撤销。"
 *     confirmLabel="删除"
 *     danger
 *     onConfirm={handleDelete}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 *
 * Props 接口:
 * - open        控制对话框的显示/隐藏
 * - title       对话框标题
 * - message     对话框主体文本
 * - confirmLabel 确认按钮文字（默认"确认"）
 * - cancelLabel  取消按钮文字（默认"取消"）
 * - danger      是否使用危险样式（红色警告图标 + 红色确认按钮）
 * - onConfirm   确认回调
 * - onCancel    取消回调
 */

import { memo, useEffect, useCallback } from 'react'
import { TriangleAlert } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * ConfirmDialog 组件
 *
 * 交互特性：
 *   - 点击遮罩层（overlay）→ 取消
 *   - 点击对话框卡片内部 → 阻止冒泡，不关闭
 *   - 按 Esc 键 → 取消
 *   - 确认按钮 autoFocus → 支持键盘 Enter 快速确认
 *
 * 性能优化：
 *   - memo()：dialog 内部状态（如动画）不影响父组件重渲染
 *   - !open 时返回 null，不渲染 DOM
 */
export default memo(function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel
}: Props): JSX.Element | null {
  /**
   * 键盘事件处理 — Esc 关闭对话框
   *
   * 使用 useCallback 配合 useEffect 依赖数组，
   * 确保事件监听器中的 onCancel 始终是最新的引用。
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    },
    [onCancel]
  )

  // 仅在对话框打开时注册 Esc 监听器，关闭时自动移除
  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleKeyDown])

  // 对话框关闭时不渲染任何 DOM
  if (!open) return null

  return (
    // 遮罩层 — 点击遮罩关闭对话框
    <div className="dialog-overlay" onClick={onCancel}>
      {/* 对话框卡片 — stopPropagation 防止点击卡片内部触发遮罩关闭 */}
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        {/* danger 模式：显示红色三角形警告图标 */}
        {danger && (
          <div className="dialog-icon">
            <TriangleAlert size={28} />
          </div>
        )}
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          {/* 取消按钮：始终使用次要样式 */}
          <button className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          {/* 确认按钮：danger 模式使用红色，否则使用主色调 */}
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            autoFocus  // 自动聚焦，方便键盘操作
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
})
