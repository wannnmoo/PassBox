/**
 * EntryForm.tsx — 条目表单组件
 *
 * 职责：添加/编辑密码条目的表单，同时支持两种模式
 *
 * 模式切换（通过 Props 判别）：
 *   - 添加模式（AddProps）：无 initialEntry → 所有字段为空
 *   - 编辑模式（EditProps）：有 initialEntry → 预填现有数据
 *
 * 表单字段：
 *   - 服务名称 *（必填）
 *   - 用户名 *（必填）
 *   - 密码 *（必填，支持显示/隐藏 + 密码生成器）
 *   - 网址（可选）
 *   - 备注（可选，多行文本框）
 *
 * 关键设计：
 *   - submitRef：将 handleSubmit 函数通过 ref 暴露给父组件，
 *     父组件通过 Ctrl+S 快捷键可以触发表单提交
 *   - 密码生成器集成：点击骰子图标打开生成器，
 *     生成器"使用此密码"后将密码回填到表单
 *   - 添加模式下监听 initialPassword 变化（来自密码生成器）
 *
 * 类型安全：
 *   Props 是 AddProps | EditProps 的联合类型，
 *   通过 isEdit 判别确保 onSubmit 参数类型正确。
 */

import { useState, useEffect, useCallback, memo } from 'react'
import { Eye, EyeOff, Dices } from 'lucide-react'
import type { PasswordEntry, NewPasswordEntry } from '../types'

/** 添加模式 Props：没有 initialEntry，initialPassword 来自密码生成器 */
interface AddProps {
  onSubmit: (entry: NewPasswordEntry) => Promise<void>
  onCancel: () => void
  onOpenGenerator: () => void
  initialPassword: string
  initialEntry?: undefined
  submitRef: (fn: (() => void) | null) => void   // 注册表单提交函数
}

/** 编辑模式 Props：有 initialEntry，无 initialPassword */
interface EditProps {
  onSubmit: (updates: Partial<PasswordEntry>) => Promise<void>
  onCancel: () => void
  onOpenGenerator: () => void
  initialEntry: PasswordEntry
  initialPassword?: undefined
  submitRef: (fn: (() => void) | null) => void   // 注册表单提交函数
}

type Props = AddProps | EditProps

export default memo(function EntryForm({
  onSubmit,
  onCancel,
  onOpenGenerator,
  initialEntry,
  initialPassword,
  submitRef
}: Props): JSX.Element {
  // 编辑模式为 true，添加模式为 false
  const isEdit = !!initialEntry

  // 表单字段状态（编辑模式下从 entry 预填，添加模式下为空）
  const [service, setService] = useState(initialEntry?.service ?? '')
  const [username, setUsername] = useState(initialEntry?.username ?? '')
  const [password, setPassword] = useState(initialEntry?.password ?? initialPassword ?? '')
  const [url, setUrl] = useState(initialEntry?.url ?? '')
  const [notes, setNotes] = useState(initialEntry?.notes ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  /**
   * 监听密码生成器回传的密码
   *
   * 仅在添加模式下生效（编辑模式下不应该被密码生成器影响）。
   * 当用户在 PasswordGenerator 中点击"使用此密码"后，
   * 父组件 setGeneratedPassword → 流入此组件的 initialPassword prop → 填入密码字段。
   */
  useEffect(() => {
    if (!isEdit && initialPassword) {
      setPassword(initialPassword)
    }
  }, [initialPassword, isEdit])

  /**
   * 表单提交处理
   *
   *   1. 验证必填字段（服务名、用户名、密码）
   *   2. 根据模式调用不同的 onSubmit
   *   3. 添加模式：提交 NewPasswordEntry（不含自动生成字段）
   *   4. 编辑模式：提交 Partial<PasswordEntry>（仅更新变更字段）
   */
  const handleSubmit = useCallback(async () => {
    setError('')

    if (!service.trim()) {
      setError('请输入服务名称')
      return
    }
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }
    if (!password) {
      setError('请输入密码')
      return
    }

    setLoading(true)
    try {
      const payload = {
        service: service.trim(),
        username: username.trim(),
        password,
        url: url.trim() || undefined,       // 空字符串 → undefined（不在 JSON 中存储空值）
        notes: notes || undefined           // 同上
      }

      if (isEdit) {
        // 编辑模式：强制类型转换为 Partial<PasswordEntry>
        await (onSubmit as EditProps['onSubmit'])(payload)
      } else {
        // 添加模式：强制类型转换为 NewPasswordEntry
        await (onSubmit as AddProps['onSubmit'])(payload)
      }
    } catch (err) {
      setError('保存失败: ' + String(err))
    } finally {
      setLoading(false)
    }
  }, [service, username, password, url, notes, isEdit, onSubmit])

  /**
   * 向父组件注册/注销表单提交函数
   *
   * 父组件（VaultScreen）通过 submitRef 获得 handleSubmit 的引用，
   * 在 Ctrl+S 快捷键触发时调用。组件卸载时清理引用防止内存泄漏。
   */
  useEffect(() => {
    submitRef(handleSubmit)
    return () => submitRef(null)
  }, [handleSubmit, submitRef])

  /** 切换密码显示/隐藏 */
  const togglePassword = useCallback(() => setShowPassword((v) => !v), [])

  return (
    <div className="entry-form">
      <h2>{isEdit ? '编辑条目' : '添加新条目'}</h2>

      <div className="form-fields">
        {/* 服务名称 — 自动聚焦 */}
        <div className="form-field">
          <label>服务名称 *</label>
          <input
            type="text"
            placeholder="例如: Google, GitHub..."
            value={service}
            onChange={(e) => setService(e.target.value)}
            autoFocus
          />
        </div>

        {/* 用户名 */}
        <div className="form-field">
          <label>用户名 *</label>
          <input
            type="text"
            placeholder="邮箱或用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        {/* 密码 — 带显示/隐藏切换 + 密码生成器按钮 */}
        <div className="form-field">
          <label>密码 *</label>
          <div className="form-password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* 显示/隐藏密码 — 眼睛图标 */}
            <button
              type="button"
              className="btn-toggle"
              onClick={togglePassword}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            {/* 打开密码生成器 — 骰子图标 */}
            <button
              type="button"
              className="btn-generate"
              onClick={onOpenGenerator}
              title="生成随机密码"
            >
              <Dices size={18} />
            </button>
          </div>
        </div>

        {/* 网址（可选） */}
        <div className="form-field">
          <label>网址（可选）</label>
          <input
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        {/* 备注（可选）— 多行文本框 */}
        <div className="form-field">
          <label>备注（可选）</label>
          <textarea
            placeholder="额外信息..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      {/* 表单错误提示 */}
      {error && <p className="form-error">{error}</p>}

      {/* 操作按钮 */}
      <div className="form-actions">
        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? '保存中...' : isEdit ? '保存修改' : '添加'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
})
