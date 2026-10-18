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

import { memo, useEffect, useCallback, useRef, useId } from 'react'
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

/** 卡片内可聚焦元素的选择器（用于 Tab 焦点循环） */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * ConfirmDialog 组件
 *
 * 交互特性：
 *   - 点击遮罩层（overlay）→ 取消
 *   - 点击对话框卡片内部 → 阻止冒泡，不关闭
 *   - 按 Esc 键 → 取消
 *   - 确认按钮 autoFocus → 支持键盘 Enter 快速确认
 *   - Tab / Shift+Tab 在卡片内循环（焦点不跑到背后的界面上）
 *
 * 无障碍：
 *   - role="dialog" + aria-modal="true"：读屏软件进入对话框语境
 *   - aria-labelledby / aria-describedby 关联标题与正文
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
  const titleId = useId()
  const descId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  /** 打开前的焦点元素 —— 关闭后归还焦点，避免焦点丢失到 body */
  const previousFocusRef = useRef<HTMLElement | null>(null)

  /**
   * 键盘事件处理 — Esc 关闭、Tab 循环
   *
   * 注意：这里用捕获阶段（第三个参数 true）注册并在 Esc 时
   * stopImmediatePropagation。VaultScreen 与 EntryDetail 也在 document 上
   * 监听 keydown 处理 Esc（退出编辑/清除选中），不拦住会出现"一次 Esc 退两层"。
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onCancel()
        return
      }

      if (e.key !== 'Tab') return

      // 焦点循环：避免 Tab 把焦点移到遮罩背后的界面元素上
      const card = cardRef.current
      if (!card) return
      const nodes = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement

      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onCancel]
  )

  // 仅在对话框打开时注册监听器；打开时记住原焦点，关闭时归还
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      previousFocusRef.current?.focus?.()
    }
  }, [open, handleKeyDown])

  // 对话框关闭时不渲染任何 DOM
  if (!open) return null

  return (
    // 遮罩层 — 点击遮罩关闭对话框
    <div className="dialog-overlay" onClick={onCancel}>
      {/* 对话框卡片 — stopPropagation 防止点击卡片内部触发遮罩关闭 */}
      <div
        className="dialog-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
      >
        {/* danger 模式：显示红色三角形警告图标 */}
        {danger && (
          <div className="dialog-icon" aria-hidden="true">
            <TriangleAlert size={28} />
          </div>
        )}
        <h3 className="dialog-title" id={titleId}>{title}</h3>
        <p className="dialog-message" id={descId}>{message}</p>
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
