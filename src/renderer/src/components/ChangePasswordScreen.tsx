/**
 * ChangePasswordScreen.tsx — 修改主密码组件
 *
 * 职责：允许用户在已解锁状态下修改主密码
 *
 * 流程：
 *   1. 输入当前主密码（验证身份）
 *   2. 输入新主密码（至少 8 位）
 *   3. 确认新主密码（防止输错）
 *   4. 提交 → 主进程验证旧密码 → 生成新 salt → 重新加密 → 覆盖 vault.dat
 *
 * 安全策略：
 *   - 必须验证旧密码才能修改（防止未授权修改）
 *   - 新密码不能与旧密码相同
 *   - 新密码至少 8 位（与创建保险库时的下限保持一致）
 *   - 修改成功后显示确认界面和警告提示
 *   - 不显示密码明文（type="password"）
 */

import { useState, useCallback, memo } from 'react'
import { CircleCheck } from 'lucide-react'
import { vault } from '../api'

/** 新主密码最小长度 —— 与 UnlockScreen 创建保险库时的下限保持一致 */
const MIN_MASTER_PASSWORD_LENGTH = 8

interface Props {
  onClose: () => void  // 关闭修改密码界面，返回主界面
}

export default memo(function ChangePasswordScreen({ onClose }: Props): JSX.Element {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)    // 修改成功后显示成功页面
  const [loading, setLoading] = useState(false)

  /**
   * 处理密码修改提交
   *
   * 验证流程：
   *   1. 非空检查
   *   2. 新密码长度 ≥ 6
   *   3. 新密码 ≠ 旧密码
   *   4. 两次新密码输入一致
   *   5. 调用 IPC → 主进程验证旧密码并重新加密
   */
  const handleSubmit = useCallback(async () => {
    setError('')
    setSuccess(false)

    if (!oldPassword) {
      setError('请输入当前主密码')
      return
    }
    if (!newPassword) {
      setError('请输入新主密码')
      return
    }
    if (newPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
      setError(`新主密码至少需要 ${MIN_MASTER_PASSWORD_LENGTH} 位`)
      return
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与旧密码相同')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    setLoading(true)
    try {
      const result = await vault.changePassword(oldPassword, newPassword)
      if (!result.ok) {
        // 写盘失败时磁盘上仍是旧密码版本，必须如实告知，否则用户会以为已改
        setError(
          result.reason === 'write-failed'
            ? '写入失败：磁盘可能已满或无写入权限，主密码未改变'
            : '当前主密码错误'
        )
        setLoading(false)
        return
      }
      // 修改成功 → 显示成功页面
      setSuccess(true)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError('操作失败: ' + String(err))
    } finally {
      setLoading(false)
    }
  }, [oldPassword, newPassword, confirmPassword])

  return (
    <div className="entry-form">
      <h2>修改主密码</h2>

      {success ? (
        // 修改成功界面 — 绿色勾图标 + 警告提示
        <div className="change-password-success">
          <div className="success-icon">
            <CircleCheck size={48} />
          </div>
          <p>主密码修改成功！</p>
          <p className="success-hint">请牢记新密码，丢失将无法找回数据。</p>
          <button className="btn-primary" onClick={onClose}>
            返回
          </button>
        </div>
      ) : (
        // 表单界面
        <>
          <div className="form-fields">
            <div className="form-field">
              <label>当前主密码</label>
              <input
                type="password"
                aria-label="当前主密码"
                placeholder="输入当前主密码"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoFocus
              />
            </div>

            <div className="form-field">
              <label>新主密码</label>
              <input
                type="password"
                aria-label="新主密码"
                placeholder="至少 8 位" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>确认新主密码</label>
              <input
                type="password"
                aria-label="确认新主密码"
                placeholder="再次输入新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? '处理中...' : '修改主密码'}
            </button>
            <button className="btn-secondary" onClick={onClose}>
              取消
            </button>
          </div>
        </>
      )}
    </div>
  )
})
