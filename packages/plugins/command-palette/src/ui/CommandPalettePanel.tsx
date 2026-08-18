/**
 * @xyq-box/plugin-command-palette —— CommandPalettePanel：搜索/执行面板
 *
 * docs/04 §6：列出 commands 服务中的命令，支持关键字过滤、键盘导航与执行。
 * 键盘：
 * - ↑/↓ 选择，Enter 执行，Esc 关闭；
 * - 命令 when()===false 时灰显且不可选中。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/** commands 服务结构子集（不 import plugin-commands 实现，docs/05 §2） */
export interface PaletteCommand {
  id: string
  title: string
  shortcut?: string[]
  icon?: string
  when?: () => boolean
}

export interface PaletteCommandsService {
  list(): PaletteCommand[]
  run(id: string): Promise<void>
  onChange(listener: () => void): () => void
}

export interface CommandPalettePanelProps {
  commands: PaletteCommandsService
  onClose: () => void
}

export function CommandPalettePanel({ commands, onClose }: CommandPalettePanelProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [version, setVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 订阅命令集合变更（卸载自动退订）
  useEffect(() => {
    let disposed = false
    let unsubscribe = () => {}
    if (typeof commands.onChange === 'function') {
      unsubscribe = commands.onChange(() => {
        if (!disposed) setVersion((v) => v + 1)
      })
    }
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [commands])

  // 过滤 + 排序
  const available = useMemo(() => {
    const q = query.trim().toLowerCase()
    return commands
      .list()
      .filter((command) => !command.when || command.when())
      .filter((command) => {
        if (!q) return true
        return (
          command.title.toLowerCase().includes(q) ||
          command.id.toLowerCase().includes(q) ||
          (command.shortcut ?? []).some((s) => s.toLowerCase().includes(q))
        )
      })
  }, [commands, query, version])

  // 查询变化时重置选中
  useEffect(() => {
    setSelected(0)
  }, [query])

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 键盘导航
  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        event.preventDefault()
        setSelected((s) => (s + 1) % Math.max(available.length, 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setSelected((s) => (s - 1 + Math.max(available.length, 1)) % Math.max(available.length, 1))
        break
      case 'Enter': {
        const command = available[selected]
        if (command) {
          event.preventDefault()
          onClose()
          void commands.run(command.id).catch((error) => {
            console.error('[command-palette] run failed:', command.id, error)
          })
        }
        break
      }
    }
  }

  function handleClick(command: PaletteCommand, index: number) {
    setSelected(index)
    onClose()
    void commands.run(command.id).catch((error) => {
      console.error('[command-palette] run failed:', command.id, error)
    })
  }

  return (
    <div className="xyq-palette__mask" onMouseDown={onClose}>
      <div
        className="xyq-palette"
        role="dialog"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="xyq-palette__header">
          <span className="xyq-palette__icon" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            className="xyq-palette__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令名 / id / 快捷键搜索…"
            spellCheck={false}
          />
          <kbd className="xyq-palette__esc">Esc</kbd>
        </div>
        <ul className="xyq-palette__list" role="listbox">
          {available.length === 0 ? (
            <li className="xyq-palette__empty">没有匹配的命令</li>
          ) : (
            available.map((command, index) => {
              const disabled = Boolean(command.when) && !(command.when as () => boolean)()
              return (
                <li
                  key={command.id}
                  role="option"
                  aria-selected={index === selected}
                  className={
                    'xyq-palette__item' +
                    (index === selected ? ' xyq-palette__item--active' : '') +
                    (disabled ? ' xyq-palette__item--disabled' : '')
                  }
                  onMouseDown={() => {
                    if (!disabled) handleClick(command, index)
                  }}
                >
                  <span className="xyq-palette__shortcut">
                    {(command.shortcut ?? []).join(' / ')}
                  </span>
                  <span className="xyq-palette__title">{command.title}</span>
                  <span className="xyq-palette__id">{command.id}</span>
                </li>
              )
            })
          )}
        </ul>
        <div className="xyq-palette__footer">
          <span>{available.length} 个命令</span>
          <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}