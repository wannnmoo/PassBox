/**
 * UnlockScreen.tsx — 解锁界面组件
 *
 * 职责：应用启动后的第一个界面，处理两种场景
 *   1. 已有保险库 → 用户输入主密码解锁
 *   2. 首次使用 → 用户设置新主密码并确认，创建新保险库
 *
 * 交互流程：
 *   加载中（checking）→ 显示相应表单 → 用户输入 → 验证/创建 → 触发 onUnlocked 回调
 *
 * 安全策略：
 *   - 首次设置时要求确认密码（防止输错导致无法解锁）
 *   - 密码最小长度 6 位
 *   - 首次使用时显示警告：主密码无法找回
 *   - 密码错误时显示错误提示，不清空输入框
 */

import { useState, useEffect, useCallback, memo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { vault } from '../api'

interface Props {
  onUnlocked: () => void  // 解锁成功后触发的回调（由父组件 App 切换界面）
}

export default memo(function UnlockScreen({ onUnlocked }: Props): JSX.Element {
  const [vaultExists, setVaultExists] = useState(false)    // 保险库文件是否存在
  const [checking, setChecking] = useState(true)            // 是否正在检查状态
  const [masterPassword, setMasterPassword] = useState('')  // 主密码
  const [confirmPassword, setConfirmPassword] = useState('') // 确认密码（仅首次设置时使用）
  const [error, setError] = useState('')                    // 错误提示信息
  const [loading, setLoading] = useState(false)             // 是否正在处理中（禁用按钮）
  const [shaking, setShaking] = useState(false)              // 密码错误时卡片抖动

  // 应用启动后检查保险库是否存在
  useEffect(() => {
    vault.exists().then((exists) => {
      setVaultExists(exists)
      setChecking(false)  // 检查完成，停止显示"加载中..."
    })
  }, [])

  /**
   * 处理表单提交
   *
   * 两种场景：
   *   1. 保险库已存在 → 调用 vault.unlock() 验证密码
   *   2. 首次使用 → 调用 vault.create() 创建新保险库
   */
  const handleSubmit = useCallback(async () => {
    setError('')

    // 表单验证
    if (!masterPassword) {
      setError('请输入主密码')
      return
    }

    if (masterPassword.length < 6) {
      setError('主密码至少需要 6 位')
      return
    }

    // 首次创建时验证两次密码一致
    if (!vaultExists && masterPassword !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setLoading(true)

    try {
      if (vaultExists) {
        // 场景 1：已有保险库，尝试解锁
        const ok = await vault.unlock(masterPassword)
        if (!ok) {
          setError('主密码错误')  // GCM authTag 验证失败 = 密码错误
          setLoading(false)
          setShaking(true)
          setTimeout(() => setShaking(false), 400)
          return
        }
      } else {
        // 场景 2：首次使用，创建新保险库
        await vault.create(masterPassword)
      }
      onUnlocked()  // 通知父组件切换到主界面
    } catch (err) {
      setError('操作失败: ' + String(err))
    } finally {
      setLoading(false)
    }
  }, [masterPassword, vaultExists, confirmPassword, onUnlocked])

  /** 键盘事件：Enter 键提交表单 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit()
    },
    [handleSubmit]
  )

  // 加载中状态：显示简单的加载提示
  if (checking) {
    return (
      <div className="unlock-screen">
        <div className="unlock-card">
          <h1>Pass<span>Box</span></h1>
          <p className="unlock-subtitle">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="unlock-screen">
      <div className={`unlock-card ${shaking ? 'shake' : ''}`}>
        <h1>Pass<span>Box</span></h1>
        <p className="unlock-subtitle">
          {vaultExists ? '输入主密码解锁' : '首次使用，请设置主密码'}
        </p>

        <div className="unlock-form">
          {/* 主密码输入框 — letter-spacing 增加间距使密码更易辨认 */}
          <input
            type="password"
            placeholder="主密码"
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />

          {/* 确认密码 — 仅在首次创建保险库时显示 */}
          {!vaultExists && (
            <input
              type="password"
              placeholder="确认主密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          )}

          {/* 错误提示 — 红色，位于按钮上方 */}
          {error && <p className="unlock-error">{error}</p>}

          <button onClick={handleSubmit} disabled={loading}>
            {loading ? '处理中...' : vaultExists ? '解锁' : '创建保险库'}
          </button>
        </div>

        {/* 首次使用警告 — 黄色背景，提醒用户记住主密码 */}
        {!vaultExists && (
          <p className="unlock-warning">
            <TriangleAlert size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            请牢记你的主密码，它无法找回。丢失主密码将永久失去所有数据。
          </p>
        )}
      </div>
    </div>
  )
})
