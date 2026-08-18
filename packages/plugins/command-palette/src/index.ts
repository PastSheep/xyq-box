/**
 * @xyq-box/plugin-command-palette —— 命令面板 UI（M1）
 *
 * docs/04 §6：消费 commands 服务，提供 Ctrl+K / Ctrl+P 搜索执行面板。
 *
 * 遵循 docs/03-插件规范.md：
 * - 注册命令「打开命令面板」（快捷键 Ctrl+K / Ctrl+P）走 effect 语义；
 * - 依赖 commands 服务（可选：缺失时降级为仅打日志，不渲染）；
 * - React overlay 由 PaletteHost 统一管理开合，模块级 emitter 供命令触发。
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from 'cordis'

import { PaletteHost } from './ui/PaletteHost.js'
import './ui/palette.css'

// ─── 开合事件（模块级，命令回调与 React 组件解耦） ──────────────────────────

const listeners = new Set<() => void>()

/** 切换面板开合（命令 run() 调用） */
export function togglePalette(): void {
  for (const listener of listeners) listener()
}

/** 订阅开合事件（PaletteHost 内部使用，effect 语义） */
export function onPaletteToggle(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-command-palette'
export const inject = ['logger']

export function apply(ctx: Context) {
  const logger = ctx.logger('command-palette')
  logger.info('plugin loaded')

  // 检测 commands 服务是否可用（可选依赖，docs/03 §4）
  const commands = ctx.get('commands') as {
    register: (command: {
      id: string; title: string; shortcut?: string[]
      icon?: string
      run: (ctx: { id: string }) => void | Promise<void>
      when?: () => boolean
    }) => () => void
  } | undefined
  if (!commands?.register) {
    logger.warn('commands 服务不可用（plugin-commands 未装载）—— 命令面板无法工作')
    return
  }

  // 1. 注册命令：Ctrl+K / Ctrl+P 打开面板
  const disposeCommand = commands.register({
    id: '@xyq-box/plugin-command-palette/open',
    title: '打开命令面板',
    shortcut: ['Ctrl+K', 'Ctrl+P'],
    run: () => { togglePalette() },
  })

  // 2. 创建自身挂载点并渲染 React 根
  if (typeof document === 'undefined') {
    logger.warn('document 不可用（非浏览器环境）—— 跳过 overlay 渲染')
    return
  }
  const mount = document.createElement('div')
  mount.id = 'xyq-command-palette-root'
  document.body.appendChild(mount)
  const root: Root = createRoot(mount)

  ctx.effect(() => {
    root.render(
      createElement(PaletteHost, { commands: commands as never }),
    )
    return () => {
      root.unmount()
      if (mount.parentNode) mount.parentNode.removeChild(mount)
      disposeCommand()
      logger.info('command palette disposed')
    }
  })

  logger.info('command palette registered (Ctrl+K / Ctrl+P)')
}