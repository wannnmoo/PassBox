/**
 * VaultScreen.tsx — 保险库主界面组件
 *
 * 职责：解锁后的主工作区，管理所有 UI 状态和用户交互
 *
 * 这是整个应用最复杂的组件，包含以下子系统：
 *
 *   1. 视图模式管理（ViewMode）— 5 种模式的状态机
 *      'detail'          — 查看条目详情
 *      'add'             — 添加新条目表单
 *      'edit'            — 编辑现有条目表单
 *      'change-password' — 修改主密码界面
 *
 *   2. 搜索过滤 — 实时过滤侧边栏条目列表
 *      按服务名称、用户名、网址进行模糊匹配（不区分大小写）
 *
 *   3. 键盘快捷键 — 全局键盘快捷键系统
 *      Ctrl+N  — 新建条目
 *      Ctrl+S  — 保存当前表单（通过 submitRef 触发）
 *      Ctrl+F  — 聚焦搜索框（通过 searchInputRef）
 *      Esc     — 逐层退出（生成器 → 表单 → 选中 → 修改密码）
 *
 *   4. 自动锁定 — 闲置监控系统
 *      检测用户活动（鼠标/键盘），超时后自动锁定保险库
 *      可配置超时时间（1/5/10/15/30 分钟或关闭）
 *      锁定前 30 秒弹出预警通知
 *
 *   5. 拖拽排序 — 通过 EntryList 组件的 onReorder 回调
 *      接收新顺序的条目 ID 数组，调用 entries.reorder() 持久化
 *
 *   6. Toast 通知 — 操作反馈（添加/更新/删除/复制成功提示）
 *
 * 布局结构：
 *   ┌──────────┬─────────────────────────────┐
 *   │ 侧边栏   │                             │
 *   │ ・锁定    │  主面板                      │
 *   │ ・主题    │  根据 viewMode 显示：         │
 *   │ ・搜索    │  - EntryDetail              │
 *   │ ・列表    │  - EntryForm (add/edit)     │
 *   │          │  - PasswordGenerator        │
 *   │          │  - ChangePasswordScreen     │
 *   └──────────┴─────────────────────────────┘
 */

import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { Lock, Key, Sun, Moon, FolderOpen } from 'lucide-react'
import { vault, entries as entriesApi } from '../api'
import { useToast } from './Toast'
import type { PasswordEntry } from '../types'
import SearchBox from './SearchBox'
import EntryList from './EntryList'
import EntryDetail from './EntryDetail'
import EntryForm from './EntryForm'
import PasswordGenerator from './PasswordGenerator'
import ChangePasswordScreen from './ChangePasswordScreen'

/** 主面板视图模式 */
type ViewMode = 'detail' | 'add' | 'edit' | 'change-password'

interface Props {
  onLocked: () => void                // 锁定保险库回调（返回解锁界面）
  theme: 'dark' | 'light'            // 当前主题
  onToggleTheme: () => void          // 切换主题回调
}

export default memo(function VaultScreen({ onLocked, theme, onToggleTheme }: Props): JSX.Element {
  // ═══════════════════════════════════════════════════
  // 核心状态
  // ═══════════════════════════════════════════════════

  const [entries, setEntries] = useState<PasswordEntry[]>([])      // 所有条目
  const [selectedId, setSelectedId] = useState<string | null>(null) // 当前选中条目 ID
  const [searchQuery, setSearchQuery] = useState('')                // 搜索文本
  const [viewMode, setViewMode] = useState<ViewMode>('detail')      // 当前视图模式
  const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null) // 正在编辑的条目
  const [generatedPassword, setGeneratedPassword] = useState('')    // 密码生成器回传的密码
  const [showGenerator, setShowGenerator] = useState(false)         // 是否显示密码生成器
  const { showToast } = useToast()

  // ═══════════════════════════════════════════════════
  // 自动锁定设置
  // ═══════════════════════════════════════════════════

  /**
   * 自动锁定超时时间（分钟）
   *
   * 从 localStorage 读取配置，默认 5 分钟。
   * 值为 0 表示关闭自动锁定。
   */
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => {
    const stored = localStorage.getItem('autoLockMinutes')
    if (stored === null) return 5
    const n = Number(stored)
    return Number.isFinite(n) && n >= 0 ? n : 5
  })

  /** 自动锁定设置变化时保存到 localStorage */
  useEffect(() => {
    localStorage.setItem('autoLockMinutes', String(autoLockMinutes))
  }, [autoLockMinutes])

  /**
   * 闲置检测 Ref（使用 Ref 避免闭包过期问题）
   *
   * lastActivityRef    — 最后一次用户活动的时间戳
   * lockWarningShownRef — 是否已显示预警通知（防止每秒重复弹）
   * idleTimerRef        — setInterval 定时器句柄
   * handleLockRef       — 最新的 handleLock 函数引用（供定时器回调使用）
   * showToastRef        — 最新的 showToast 函数引用（供定时器回调使用）
   */
  const lastActivityRef = useRef<number>(Date.now())
  const lockWarningShownRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handleLockRef = useRef<() => void>(() => {})
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // ═══════════════════════════════════════════════════
  // Ref：供键盘快捷键使用
  // ═══════════════════════════════════════════════════

  const searchInputRef = useRef<HTMLInputElement>(null)    // 搜索框 DOM 引用（Ctrl+F）
  const formSubmitRef = useRef<(() => void) | null>(null)  // 表单提交函数引用（Ctrl+S）

  /**
   * 初始加载 — 从主进程获取条目列表
   *
   * 仅在组件挂载时执行一次。
   * 列表中的密码已被掩码处理（••••••••），显示明文需要调用 entries.get()。
   */
  useEffect(() => {
    entriesApi.list().then(setEntries)
  }, [])

  // ═══════════════════════════════════════════════════
  // 搜索过滤（useMemo 缓存）
  // ═══════════════════════════════════════════════════

  /**
   * 根据搜索文本过滤条目
   *
   * 匹配范围：服务名称、用户名、网址
   * 不区分大小写，实时过滤（每次输入都触发重新计算）
   */
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries
    const q = searchQuery.toLowerCase()
    return entries.filter(
      (e) =>
        e.service.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        (e.url && e.url.toLowerCase().includes(q))
    )
  }, [entries, searchQuery])

  /** 从 entries 数组中查找选中条目（用于传给详情组件） */
  const selectedEntry = selectedId
    ? entries.find((e) => e.id === selectedId) ?? null
    : null

  // ═══════════════════════════════════════════════════
  // 表单提交 Ref 注册（Ctrl+S 快捷键用）
  // ═══════════════════════════════════════════════════

  /**
   * 注册表单提交回调
   *
   * EntryForm 通过 submitRef prop 传入 handleSubmit 引用，
   * 此函数保存到 formSubmitRef，供 Ctrl+S 快捷键触发。
   */
  const registerFormSubmit = useCallback((fn: (() => void) | null) => {
    formSubmitRef.current = fn
  }, [])

  // ═══════════════════════════════════════════════════
  // 键盘快捷键
  // ═══════════════════════════════════════════════════

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey  // metaKey 支持 macOS Cmd 键

      // Ctrl+N — 新建条目
      if (isCtrl && e.key === 'n') {
        e.preventDefault()
        setEditingEntry(null)
        setGeneratedPassword('')
        setShowGenerator(false)
        setViewMode('add')
        return
      }

      // Ctrl+S — 保存当前表单
      if (isCtrl && e.key === 's') {
        e.preventDefault()
        formSubmitRef.current?.()
        return
      }

      // Ctrl+F — 聚焦搜索框
      if (isCtrl && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      // Esc — 逐层退出（生成器 → 表单 → 密码修改 → 选中 → 无操作）
      if (e.key === 'Escape') {
        if (showGenerator) {
          setShowGenerator(false)     // 第一层：关闭密码生成器，返回表单
          return
        }
        if (viewMode === 'add' || viewMode === 'edit') {
          setViewMode('detail')       // 第二层：取消表单编辑
          setEditingEntry(null)
          setShowGenerator(false)
          return
        }
        if (viewMode === 'change-password') {
          setViewMode('detail')       // 第三层：关闭修改密码界面
          return
        }
        if (selectedId) {
          setSelectedId(null)         // 第四层：取消条目选中
          setViewMode('detail')
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showGenerator, viewMode, selectedId])  // 依赖当前状态（Esc 的行为取决于当前模式）

  // ═══════════════════════════════════════════════════
  // 自动锁定 — 闲置监控
  // ═══════════════════════════════════════════════════

  useEffect(() => {
    // 自动锁定关闭 — 清理定时器
    if (autoLockMinutes === 0) {
      if (idleTimerRef.current) {
        clearInterval(idleTimerRef.current)
        idleTimerRef.current = null
      }
      return
    }

    const thresholdSeconds = autoLockMinutes * 60

    /** 用户活动处理：重置闲置计时器 */
    const handleActivity = () => {
      lastActivityRef.current = Date.now()
      lockWarningShownRef.current = false  // 有活动后重置预警标志
    }

    // 监听所有用户交互事件（passive: true 提升滚动性能）
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'click']
    events.forEach((e) =>
      document.addEventListener(e, handleActivity, { passive: true })
    )

    // 挂载时重置基线（防止组件挂载前的时间差导致误锁定）
    lastActivityRef.current = Date.now()
    lockWarningShownRef.current = false

    // 每秒检查一次闲置时间
    idleTimerRef.current = setInterval(() => {
      const idleSeconds = (Date.now() - lastActivityRef.current) / 1000

      // 锁定前 30 秒预警 — 仅通知一次
      if (idleSeconds >= thresholdSeconds - 30 && !lockWarningShownRef.current) {
        lockWarningShownRef.current = true
        showToastRef.current('即将自动锁定...', 'info')
      }

      // 闲置超时 → 锁定
      if (idleSeconds >= thresholdSeconds) {
        handleLockRef.current()
      }
    }, 1000)

    return () => {
      events.forEach((e) =>
        document.removeEventListener(e, handleActivity)
      )
      if (idleTimerRef.current) {
        clearInterval(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [autoLockMinutes])  // autoLockMinutes 变化时重建定时器

  // ═══════════════════════════════════════════════════
  // 业务操作处理函数
  // ═══════════════════════════════════════════════════

  /**
   * 锁定保险库
   *
   * 先清理闲置定时器（防止重复锁定），然后调用主进程锁定。
   */
  const handleLock = useCallback(async () => {
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current)
      idleTimerRef.current = null
    }
    await vault.lock()
    onLocked()  // 通知 App 切换到解锁界面
  }, [onLocked])

  // 保持 handleLockRef 同步最新引用（供闲置定时器使用）
  handleLockRef.current = handleLock

  /**
   * 拖拽排序处理
   *
   * 调用 entries.reorder() 通知主进程，然后刷新本地条目列表。
   * 主进程会根据 ID 顺序更新 order 字段并重新加密保存。
   */
  const handleReorder = useCallback(async (orderedIds: string[]) => {
    await entriesApi.reorder(orderedIds)
    const updated = await entriesApi.list()
    setEntries(updated)
  }, [])

  /** 添加新条目 */
  const handleAdd = useCallback(
    async (entry: Omit<PasswordEntry, 'id' | 'order' | 'createdAt' | 'updatedAt'>) => {
      const created = await entriesApi.create(entry)
      setEntries((prev) => [...prev, created])    // 追加到本地状态
      setSelectedId(created.id)                    // 自动选中新条目
      setViewMode('detail')                        // 切换到详情视图
      setGeneratedPassword('')
      setShowGenerator(false)
      showToast('条目已添加')
    },
    [showToast]
  )

  /** 更新现有条目 */
  const handleUpdate = useCallback(
    async (updates: Partial<PasswordEntry>) => {
      if (!editingEntry) return
      const updated = await entriesApi.update(editingEntry.id, updates)
      if (updated) {
        // 更新本地条目列表中的对应条目
        setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
        setEditingEntry(null)
        setViewMode('detail')
        setShowGenerator(false)
        showToast('条目已更新')
      }
    },
    [editingEntry, showToast]
  )

  /** 删除条目 */
  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await entriesApi.delete(id)
      if (ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id))
        // 如果删除的是当前选中的条目，清除选中状态
        if (selectedId === id) {
          setSelectedId(null)
          setViewMode('detail')
        }
        showToast('条目已删除')
      }
    },
    [selectedId, showToast]
  )

  // ═══════════════════════════════════════════════════
  // 视图切换处理函数
  // ═══════════════════════════════════════════════════

  /** 进入编辑模式 — 使用展开拷贝防止修改原条目 */
  const handleEdit = useCallback((entry: PasswordEntry) => {
    setEditingEntry({ ...entry })
    setViewMode('edit')
    setShowGenerator(false)
  }, [])

  /** 选中条目 → 详情视图 */
  const handleSelectEntry = useCallback((id: string) => {
    setSelectedId(id)
    setViewMode('detail')
    setEditingEntry(null)
    setShowGenerator(false)
  }, [])

  /** 开始添加新条目 */
  const handleStartAdd = useCallback(() => {
    setEditingEntry(null)
    setGeneratedPassword('')
    setShowGenerator(false)
    setViewMode('add')
  }, [])

  /** 取消表单 → 返回详情视图 */
  const handleCancelForm = useCallback(() => {
    setViewMode('detail')
    setEditingEntry(null)
    setShowGenerator(false)
  }, [])

  const handleOpenGenerator = useCallback(() => setShowGenerator(true), [])
  const handleCloseGenerator = useCallback(() => setShowGenerator(false), [])

  /** 进入修改主密码界面 */
  const handleChangePassword = useCallback(() => setViewMode('change-password'), [])

  /** 关闭修改主密码界面 */
  const handleCloseChangePassword = useCallback(() => setViewMode('detail'), [])

  /**
   * 使用密码生成器生成的密码
   *
   * 保存生成的密码并关闭生成器，密码通过 initialPassword prop 流回 EntryForm。
   */
  const handleUseGeneratedPassword = useCallback((pw: string) => {
    setGeneratedPassword(pw)
    setShowGenerator(false)
  }, [])

  // 视图模式判断（用于条件渲染）
  const isEditing = viewMode === 'edit' && editingEntry
  const isAdding = viewMode === 'add'

  // ═══════════════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════════════

  return (
    <div className="vault-screen">
      {/* ── 侧边栏 ─────────────────────────────────── */}
      <aside className="sidebar">
        {/* 顶部工具栏 */}
        <div className="sidebar-top">
          <span className="sidebar-brand">PassBox</span>
          <button className="btn-lock" onClick={handleLock} title="锁定保险库">
            <Lock size={14} /> 锁定
          </button>
          <button className="btn-change-password" onClick={handleChangePassword} title="修改主密码">
            <Key size={14} />
          </button>
          <button className="btn-theme-toggle" onClick={onToggleTheme} title={theme === 'dark' ? '切换白天模式' : '切换夜间模式'}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>

        {/* 自动锁定时间设置 — 下拉菜单 */}
        <div className="auto-lock-setting">
          <span className="auto-lock-label">自动锁定</span>
          <select
            className="auto-lock-select"
            value={autoLockMinutes}
            onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
          >
            <option value={1}>1 分钟</option>
            <option value={5}>5 分钟</option>
            <option value={10}>10 分钟</option>
            <option value={15}>15 分钟</option>
            <option value={30}>30 分钟</option>
            <option value={0}>关闭</option>
          </select>
        </div>

        {/* 搜索框（ref 供 Ctrl+F） */}
        <SearchBox ref={searchInputRef} value={searchQuery} onChange={setSearchQuery} />

        {/* 条目列表（支持拖拽排序） */}
        <EntryList
          entries={filteredEntries}
          selectedId={selectedId}
          onSelect={handleSelectEntry}
          onAdd={handleStartAdd}
          onReorder={handleReorder}
        />
      </aside>

      {/* ── 主面板 ─────────────────────────────────── */}
      <main className="main-panel">
        {/* 添加模式：显示空表单 */}
        {isAdding ? (
          <div style={{ display: showGenerator ? 'none' : 'block' }}>
            <EntryForm
              key="add"
              onSubmit={handleAdd}
              onCancel={handleCancelForm}
              onOpenGenerator={handleOpenGenerator}
              initialPassword={generatedPassword}
              submitRef={registerFormSubmit}
            />
          </div>
        ) : null}

        {/* 编辑模式：显示预填表单 */}
        {isEditing ? (
          <div style={{ display: showGenerator ? 'none' : 'block' }}>
            <EntryForm
              key={editingEntry!.id}
              onSubmit={handleUpdate}
              onCancel={handleCancelForm}
              onOpenGenerator={handleOpenGenerator}
              initialEntry={editingEntry!}
              submitRef={registerFormSubmit}
            />
          </div>
        ) : null}

        {/* 密码生成器（覆盖在表单上方） */}
        {showGenerator ? (
          <PasswordGenerator
            onUse={handleUseGeneratedPassword}
            onClose={handleCloseGenerator}
          />
        ) : null}

        {/* 默认视图：详情 / 修改密码 / 空状态 */}
        {!isAdding && !isEditing && !showGenerator ? (
          viewMode === 'change-password' ? (
            <ChangePasswordScreen onClose={handleCloseChangePassword} />
          ) : selectedEntry ? (
            <EntryDetail
              entry={selectedEntry}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ) : (
            // 空状态：无选中条目时显示提示
            <div className="main-empty">
              <div className="main-empty-icon"><FolderOpen size={36} /></div>
              <h2>选择一个条目</h2>
              <p>或 <button className="btn-link" onClick={handleStartAdd}>添加新记录 (Ctrl+N)</button></p>
            </div>
          )
        ) : null}
      </main>
    </div>
  )
})
