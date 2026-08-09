/**
 * EntryDetail.tsx — 条目详情组件
 *
 * 职责：显示单个密码条目的完整信息，提供查看、复制、编辑、删除操作
 *
 * 功能：
 *   - 显示条目的所有字段（服务名、用户名、密码、网址、备注）
 *   - 密码显示/隐藏切换（默认掩码 ••••••••••••••••）
 *   - 复制密码到剪贴板（30 秒后自动清除）
 *   - 编辑按钮 → 切换到编辑模式
 *   - 删除按钮 → 弹出确认对话框（自定义 ConfirmDialog，非原生 confirm）
 *   - 显示创建/更新时间戳
 *   - 服务首字母头像图标
 *   - 复制用户名功能（点击用户名即可复制，未来可扩展）
 *
 * 安全设计：
 *   - 默认密码掩码显示，防止肩窥（shoulder surfing）
 *   - 复制密码后显示 Toast 通知
 *   - 复制按钮有视觉反馈（Check 图标替换 Copy 图标）
 *   - 密码使用等宽字体（JetBrains Mono）防止混淆
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { Pencil, Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { password as passwordApi, entries as entriesApi } from '../api'
import { useToast } from './Toast'
import ConfirmDialog from './ConfirmDialog'
import type { PasswordEntry } from '../types'

interface Props {
  entry: PasswordEntry          // 选中的条目（密码已掩码）
  onEdit: (entry: PasswordEntry) => void  // 编辑回调
  onDelete: (id: string) => void          // 删除回调
}

export default memo(function EntryDetail({ entry, onEdit, onDelete }: Props): JSX.Element {
  const [showPassword, setShowPassword] = useState(false)     // 密码是否明文显示
  const [copied, setCopied] = useState(false)                  // 是否刚复制
  const [fullEntry, setFullEntry] = useState<PasswordEntry | null>(null)  // 含明文密码的完整条目
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)      // 删除确认对话框
  const { showToast } = useToast()

  /**
   * 加载条目的完整信息（含明文密码）
   *
   * 从列表传入的 entry 密码已掩码（••••••••），需要调用 get 获取明文。
   * 使用 cancelled 标志防止组件卸载后的状态更新（内存泄漏和 React 警告）。
   */
  useEffect(() => {
    let cancelled = false
    entriesApi.get(entry.id).then((result) => {
      if (!cancelled && result) {
        setFullEntry(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [entry.id])

  // 优先使用含明文的完整条目，加载中则使用列表中的掩码条目
  const displayEntry = fullEntry ?? entry

  // 格式化时间戳为可读格式（使用浏览器本地化）
  const created = useMemo(
    () => new Date(displayEntry.createdAt).toLocaleString(),
    [displayEntry.createdAt]
  )
  const updated = useMemo(
    () => new Date(displayEntry.updatedAt).toLocaleString(),
    [displayEntry.updatedAt]
  )

  /** 密码强度评估 */
  const strength = useMemo(() => {
    const pw = displayEntry.password
    let score = 0
    if (pw.length >= 8) score++
    if (pw.length >= 14) score++
    if (/[A-Z]/.test(pw)) score++
    if (/[a-z]/.test(pw)) score++
    if (/[0-9]/.test(pw)) score++
    if (/[^A-Za-z0-9]/.test(pw)) score++
    const levels = [
      { label: '非常弱', color: '#cf222e' },
      { label: '弱', color: '#cf222e' },
      { label: '一般', color: '#d97706' },
      { label: '中等', color: '#d2991b' },
      { label: '强', color: '#2ea043' },
      { label: '非常强', color: '#2ea043' },
      { label: '极强', color: '#2ea043' },
    ]
    return { score, ...levels[Math.min(score, 6)] }
  }, [displayEntry.password])

  /**
   * 复制密码到剪贴板
   *
   * 调用主进程 clipboard.writeText（而非 navigator.clipboard），
   * 以利用 30 秒自动清除功能。
   */
  const handleCopy = useCallback(async () => {
    await passwordApi.copy(displayEntry.id)
    setCopied(true)
    showToast('密码已复制')
    setTimeout(() => setCopied(false), 2000)
  }, [displayEntry.id, showToast])

  const handleDeleteClick = useCallback(() => setShowDeleteConfirm(true), [])

  const handleDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false)
    onDelete(displayEntry.id)
  }, [displayEntry.id, onDelete])

  const handleDeleteCancel = useCallback(() => setShowDeleteConfirm(false), [])

  const handleEdit = useCallback(() => onEdit(displayEntry), [displayEntry, onEdit])

  /** 切换密码显示/隐藏 */
  const togglePassword = useCallback(() => setShowPassword((v) => !v), [])

  return (
    <div className="entry-detail">
      {/* 头部：服务图标 + 名称 + 用户名 + 编辑/删除按钮 */}
      <div className="detail-header">
        <div className="detail-service-icon">
          {displayEntry.service.charAt(0).toUpperCase()}
        </div>
        <div>
          <h2>{displayEntry.service}</h2>
          <span className="detail-username-label">{displayEntry.username}</span>
        </div>
        <div className="detail-actions">
          <button className="btn-primary" onClick={handleEdit}>
            <Pencil size={14} /> 编辑
          </button>
          <button className="btn-danger" onClick={handleDeleteClick}>
            <Trash2 size={14} /> 删除
          </button>
        </div>
      </div>

      {/* 字段列表 */}
      <div className="detail-fields">
        {/* 用户名字段 */}
        <div className="detail-field">
          <label>用户名</label>
          <div className="detail-field-value">
            <span>{displayEntry.username}</span>
          </div>
        </div>

        {/* 密码字段 — 等宽字体 + 显示/隐藏 + 复制按钮 */}
        <div className="detail-field">
          <label>密码</label>
          <div className="detail-field-value password-field">
            <span className="password-text">
              {showPassword ? displayEntry.password : '••••••••••••••••'}
            </span>
            <button
              className="btn-toggle-password"
              onClick={togglePassword}
              title={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button
              className={`btn-copy ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
              title="复制密码"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
          {/* 密码强度条 — 仅在显示密码时展示 */}
          {showPassword && (
            <div className="password-strength">
              <div className="password-strength-label">
                密码强度: <span style={{ color: strength.color }}>{strength.label}</span>
              </div>
              <div className="password-strength-bar">
                <div
                  className="password-strength-fill"
                  style={{
                    width: `${(strength.score / 6) * 100}%`,
                    background: strength.color
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 网址字段 — 仅当有值时显示 */}
        {displayEntry.url && (
          <div className="detail-field">
            <label>网址</label>
            <div className="detail-field-value">
              <span>{displayEntry.url}</span>
            </div>
          </div>
        )}

        {/* 备注字段 — 仅当有值时显示，保留换行 */}
        {displayEntry.notes && (
          <div className="detail-field">
            <label>备注</label>
            <div className="detail-field-value">
              <span style={{ whiteSpace: 'pre-wrap' }}>{displayEntry.notes}</span>
            </div>
          </div>
        )}
      </div>

      {/* 底部元数据：创建时间 + 更新时间 */}
      <div className="detail-meta">
        <span>创建时间: {created}</span>
        <span>更新时间: {updated}</span>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认删除"
        message={`确定要删除 "${displayEntry.service}" 吗？此操作不可撤销。`}
        confirmLabel="删除"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  )
})
