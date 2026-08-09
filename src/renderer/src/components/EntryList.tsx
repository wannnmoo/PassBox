/**
 * EntryList.tsx — 条目列表组件
 *
 * 职责：侧边栏中的条目列表，支持选择、添加、拖拽排序
 *
 * 功能：
 *   - 展示保险库中所有条目（服务名称 + 用户名 + 相对更新时间）
 *   - 高亮当前选中的条目（绿色左边框 + 高亮背景）
 *   - 空状态提示（还没有保存任何密码）
 *   - 添加按钮（+ 圆形按钮）
 *   - HTML5 拖拽排序（原生拖拽 API，无需第三方库）
 *   - 搜索关键词命中高亮（<mark> 包裹匹配片段）
 *   - 服务首字母头像图标
 *
 * 拖拽实现（HTML5 Drag and Drop API）：
 *   - dragStart：记录被拖拽条目的索引
 *   - dragOver：在目标条目上方悬停，显示绿色指示线
 *   - dragLeave：离开目标条目，移除指示线
 *   - drop：交换源条目和目标条目 → 触发 onReorder 回调持久化
 *   - dragEnd：清理拖拽状态（无论拖拽成功或取消）
 *
 * 性能优化：
 *   - memo()：仅在 entries / selectedId 变化时重渲染
 *   - 拖拽状态（dragIndex, dropIndex）是组件内部状态，不影响父组件
 */

import { memo, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Plus, GripVertical } from 'lucide-react'
import type { PasswordEntry } from '../types'

interface Props {
  entries: PasswordEntry[]                 // 条目列表
  selectedId: string | null               // 当前选中的条目 ID
  query: string                           // 搜索关键词（用于命中高亮）
  onSelect: (id: string) => void          // 选择条目回调
  onAdd: () => void                       // 添加新条目回调（Ctrl+N）
  onReorder: (orderedIds: string[]) => void  // 排序变更回调（传入新的 ID 顺序）
}

/**
 * 相对时间格式化：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期
 */
function formatRelativeTime(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString()
}

/**
 * 搜索命中高亮：用 <mark> 包裹文本中匹配 query 的片段（不区分大小写）
 */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim().toLowerCase()
  if (!q || !text) return text
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let idx = lower.indexOf(q, from)
  while (idx !== -1) {
    if (idx > from) parts.push(text.slice(from, idx))
    parts.push(<mark key={idx}>{text.slice(idx, idx + q.length)}</mark>)
    from = idx + q.length
    idx = lower.indexOf(q, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}

export default memo(function EntryList({
  entries,
  selectedId,
  query,
  onSelect,
  onAdd,
  onReorder
}: Props): JSX.Element {
  // 拖拽状态
  const [dragIndex, setDragIndex] = useState<number | null>(null)   // 当前被拖拽的条目索引
  const [dropIndex, setDropIndex] = useState<number | null>(null)   // 当前悬停的目标索引

  /**
   * 拖拽开始 — 记录源索引，设置拖拽效果为"移动"
   */
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))  // 存储索引
    setDragIndex(index)
  }, [])

  /**
   * 拖拽悬停 — 阻止默认行为（允许 drop），设置目标索引
   */
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()  // 必须调用，否则 drop 事件不会触发
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(index)
  }, [])

  /** 拖拽离开 — 清除目标指示线 */
  const handleDragLeave = useCallback(() => {
    setDropIndex(null)
  }, [])

  /**
   * 放下 — 执行条目交换
   *
   *   1. 从数组中移除被拖拽条目
   *   2. 插入到目标位置
   *   3. 用新顺序的 ID 数组调用 onReorder 持久化
   */
  const handleDrop = useCallback(
    (e: React.DragEvent, dropIdx: number) => {
      e.preventDefault()
      const dragIdx = Number(e.dataTransfer.getData('text/plain'))

      // 位置未变化，不做任何操作
      if (dragIdx === dropIdx) {
        setDragIndex(null)
        setDropIndex(null)
        return
      }

      // 数组操作：移除 → 插入
      const newEntries = [...entries]
      const [removed] = newEntries.splice(dragIdx, 1)
      newEntries.splice(dropIdx, 0, removed)

      // 提取新顺序的 ID 数组并持久化
      onReorder(newEntries.map((entry) => entry.id))
      setDragIndex(null)
      setDropIndex(null)
    },
    [entries, onReorder]
  )

  /** 拖拽结束 — 无论成功或取消，清理拖拽状态 */
  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDropIndex(null)
  }, [])

  return (
    <div className="entry-list">
      {/* 头部：条目计数 + 添加按钮 */}
      <div className="entry-list-header">
        <span className="entry-count">{entries.length} 条记录</span>
        <button className="btn-add" onClick={onAdd} title="添加新条目 (Ctrl+N)">
          <Plus size={18} strokeWidth={3} />
        </button>
      </div>

      {/* 条目列表容器 */}
      <div className="entry-list-items">
        {entries.length === 0 ? (
          // 空状态：提示用户添加第一条记录
          <div className="entry-list-empty">
            <p>还没有保存任何密码</p>
            <button className="btn-primary" onClick={onAdd}>
              添加第一条记录
            </button>
            <p className="entry-list-hint">
              或按 <kbd>Ctrl</kbd> + <kbd>N</kbd>
            </p>
          </div>
        ) : (
          // 条目列表
          entries.map((entry, index) => (
            <div
              key={entry.id}
              className={`entry-item ${selectedId === entry.id ? 'selected' : ''} ${
                dragIndex === index ? 'dragging' : ''        // 被拖拽的条目 → 半透明
              } ${dropIndex === index ? 'drop-target' : ''}`} // 目标位置 → 绿色指示线
              onClick={() => onSelect(entry.id)}
              draggable                                       // 启用 HTML5 拖拽
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              {/* 拖拽抓手图标 — 仅 hover 时显示 */}
              <span className="entry-drag-handle" title="拖拽排序">
                <GripVertical size={14} />
              </span>
              {/* 服务首字母图标 */}
              <div className="entry-item-icon">
                {entry.service.charAt(0).toUpperCase()}
              </div>
              {/* 服务名称 + 用户名（搜索时高亮命中片段） */}
              <div className="entry-item-info">
                <div className="entry-item-service">
                  <Highlight text={entry.service} query={query} />
                </div>
                <div className="entry-item-username">
                  <Highlight text={entry.username} query={query} />
                </div>
              </div>
              {/* 相对更新时间 */}
              <span className="entry-item-time">{formatRelativeTime(entry.updatedAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
})
