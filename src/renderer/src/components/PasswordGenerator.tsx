/**
 * PasswordGenerator.tsx — 随机密码生成器组件
 *
 * 职责：提供可配置的密码学安全随机密码生成器
 *
 * 功能：
 *   - 可配置密码长度（8-64 位，滑杆调节）
 *   - 可选字符类型（大写、小写、数字、符号 — 复选框）
 *   - 生成密码（调用主进程 crypto.randomBytes 确保密码学安全）
 *   - 复制生成的密码到剪贴板
 *   - "使用此密码"按钮 → 将密码回填到条目表单
 *
 * 安全说明：
 *   密码由主进程的 crypto.randomBytes() 生成，使用系统熵源，
 *   而非 Math.random()（伪随机，不安全）。
 *   每种选定字符类型至少保证出现一次，避免"20 位密码没有大写字母"的情况。
 *
 * 使用场景：
 *   在添加/编辑条目时，点击密码框旁的骰子图标 (Dices) 打开此组件。
 */

import { useState, useMemo, useCallback, memo } from 'react'
import { Copy, Check, Dices } from 'lucide-react'
import { password as passwordApi } from '../api'

interface Props {
  onUse: (password: string) => void   // 使用此密码 → 回填到父组件表单
  onClose: () => void                  // 关闭生成器，返回表单
}

export default memo(function PasswordGenerator({ onUse, onClose }: Props): JSX.Element {
  // ── 密码配置状态 ──────────────────────────────────
  const [length, setLength] = useState(20)          // 密码长度
  const [uppercase, setUppercase] = useState(true)   // 包含大写字母
  const [lowercase, setLowercase] = useState(true)   // 包含小写字母
  const [numbers, setNumbers] = useState(true)       // 包含数字
  const [symbols, setSymbols] = useState(true)       // 包含特殊符号
  const [generated, setGenerated] = useState('')     // 生成的密码文本
  const [copied, setCopied] = useState(false)        // 是否已复制

  /**
   * 生成按钮是否禁用
   *
   * 至少需要选择一种字符类型，否则无法生成密码。
   * 使用 useMemo 缓存计算结果，避免每次渲染都重新计算。
   */
  const disabled = useMemo(
    () => ![uppercase, lowercase, numbers, symbols].some(Boolean),
    [uppercase, lowercase, numbers, symbols]
  )

  /** 调用主进程生成随机密码 */
  const handleGenerate = useCallback(async () => {
    const pw = await passwordApi.generate({
      length,
      uppercase,
      lowercase,
      numbers,
      symbols
    })
    setGenerated(pw)
  }, [length, uppercase, lowercase, numbers, symbols])

  /** 复制密码到系统剪贴板 */
  const handleCopy = useCallback(async () => {
    if (!generated) return
    await navigator.clipboard.writeText(generated)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)  // 2 秒后恢复图标
  }, [generated])

  /** 使用此密码 → 回填到条目表单 */
  const handleUse = useCallback(() => onUse(generated), [generated, onUse])

  return (
    <div className="password-generator">
      <h2>密码生成器</h2>

      {/* 生成的密码展示区 */}
      <div className="generator-result">
        <div className="generator-password">
          {generated || '点击生成按钮创建密码'}
        </div>
        {generated && (
          <div className="generator-actions">
            {/* 复制按钮 — 用 Check 图标表示已复制状态 */}
            <button
              className={`btn-copy ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? ' 已复制' : ''}
            </button>
            <button className="btn-primary" onClick={handleUse}>
              使用此密码
            </button>
          </div>
        )}
      </div>

      {/* 密码配置选项 */}
      <div className="generator-options">
        {/* 长度滑杆 */}
        <div className="generator-option">
          <label>长度: {length}</label>
          <input
            type="range"
            min={8}
            max={64}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
          />
        </div>

        {/* 字符类型复选框 */}
        <div className="generator-checks">
          <label>
            <input
              type="checkbox"
              checked={uppercase}
              onChange={(e) => setUppercase(e.target.checked)}
            />
            大写字母 (A-Z)
          </label>
          <label>
            <input
              type="checkbox"
              checked={lowercase}
              onChange={(e) => setLowercase(e.target.checked)}
            />
            小写字母 (a-z)
          </label>
          <label>
            <input
              type="checkbox"
              checked={numbers}
              onChange={(e) => setNumbers(e.target.checked)}
            />
            数字 (0-9)
          </label>
          <label>
            <input
              type="checkbox"
              checked={symbols}
              onChange={(e) => setSymbols(e.target.checked)}
            />
            符号 (!@#$...)
          </label>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="generator-buttons">
        <button className="btn-primary" onClick={handleGenerate} disabled={disabled}>
          <Dices size={16} /> 生成密码
        </button>
        <button className="btn-secondary" onClick={onClose}>
          返回
        </button>
      </div>
    </div>
  )
})
