/**
 * @xyq-box/plugin-command-palette —— PaletteHost：面板开合宿主
 *
 * 管理命令面板 overlay 的开合状态。
 * 订阅模块级 togglePalette 事件，切换 open 状态。
 * 打开时渲染 CommandPalettePanel，关闭时渲染空片段。
 */

import { useCallback, useEffect, useState } from 'react'
import { onPaletteToggle } from '../index.js'
import { CommandPalettePanel } from './CommandPalettePanel.js'
import type { PaletteCommandsService } from './CommandPalettePanel.js'

export interface PaletteHostProps {
  commands: PaletteCommandsService
}

export function PaletteHost({ commands }: PaletteHostProps) {
  const [open, setOpen] = useState(false)

  // 订阅开合事件
  useEffect(() => {
    let disposed = false
    const unsub = onPaletteToggle(() => {
      if (!disposed) setOpen((v) => !v)
    })
    return () => {
      disposed = true
      unsub()
    }
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  if (!open) return null
  return (
    <CommandPalettePanel commands={commands} onClose={handleClose} />
  )
}