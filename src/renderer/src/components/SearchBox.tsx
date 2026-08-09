/**
 * SearchBox.tsx — 搜索框组件
 *
 * 职责：提供条目列表的实时搜索过滤功能
 *
 * 特性：
 *   - 搜索图标（Search）在输入框左侧
 *   - 输入内容时右侧显示清除按钮（X）
 *   - 支持 Ctrl+F 快捷键聚焦（由父组件通过 ref 控制）
 *   - 实时搜索（每次输入都触发 onChange，父组件负责过滤逻辑）
 *   - 使用 forwardRef 暴露原生 input 引用给父组件
 *
 * 性能优化：
 *   - memo()：搜索框本身无内部状态变化，父组件重渲染时避免不必要的重渲染
 *   - forwardRef：允许父组件直接操作 DOM（聚焦），避免受控组件的额外渲染
 */

import { forwardRef, memo } from 'react'
import { Search, X } from 'lucide-react'

interface Props {
  value: string                       // 当前搜索文本（受控组件）
  onChange: (value: string) => void   // 搜索文本变化回调
}

/**
 * SearchBox 组件
 *
 * 同时使用 memo 和 forwardRef：
 *   - memo 在外层：防止因父组件重渲染导致不必要的渲染
 *   - forwardRef 在内层：将 ref 转发到原生 <input> 元素
 *
 * 布局结构：
 *   [Search图标] [输入框.........X清除按钮]
 */
const SearchBox = memo(
  forwardRef<HTMLInputElement, Props>(function SearchBox({ value, onChange }, ref) {
    return (
      <div className="search-box">
        {/* 搜索图标 — flex-shrink: 0 防止被压缩 */}
        <Search size={16} className="search-icon-svg" />
        <input
          ref={ref}                           // 转发 ref，供 Ctrl+F 快捷键使用
          type="text"
          placeholder="搜索... (Ctrl+F)"      // 提示用户有快捷键可用
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {/* 清除按钮 — 仅在有输入内容时显示 */}
        {value && (
          <span className="search-clear" onClick={() => onChange('')}>
            <X size={14} />
          </span>
        )}
      </div>
    )
  })
)

export default SearchBox
