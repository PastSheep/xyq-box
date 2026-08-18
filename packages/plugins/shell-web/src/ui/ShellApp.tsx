/**
 * @xyq-box/plugin-shell-web —— ShellApp：React UI 根（占据 root slot）
 *
 * 壳的渲染层：订阅 plugin-views 的变更事件，聚合渲染各扩展点的已注册视图。
 * 主题起步走 CSS 变量协议（docs/03 §8），样式见 shell.css（经 Vite 入口打包）。
 */

import { createContext, useContext, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { version as kernelVersion } from '@xyq-box/core'

import type { ViewsServiceLike } from '../types.js'
import { ViewSlot } from './ViewSlot.js'

/** 壳把内核 ctx 放入 React context，供视图组件与壳自身取用 */
export const ShellContext = createContext<Context | null>(null)

export interface ShellAppProps {
  /** 插件配置（可选：直接渲染时由插件传入；经 views 注册时缺失则用 context） */
  config?: {
    showKernelStatus?: boolean
  }
  /** 显式 ctx（可选；缺省从 ShellContext 取） */
  ctx?: Context | null
}

/** 壳的 UI 根：渲染 chrome（header/body/statusbar）并聚合各扩展点视图 */
export function ShellApp(props: ShellAppProps) {
  const fallbackCtx = useContext(ShellContext)
  const ctx = props.ctx ?? fallbackCtx

  const [tick, setTick] = useState(0)
  const [online, setOnline] = useState(true)

  useEffect(() => {
    if (!ctx) return
    const disposers: Array<() => void> = []
    const views = ctx.get('views') as ViewsServiceLike | undefined
    if (views) {
      disposers.push(views.onChange(() => setTick((value) => value + 1)))
    }
    disposers.push(ctx.system.onOnlineChange(setOnline))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [ctx])

  if (!ctx) return null

  void tick // 视图变更触发重渲染
  const showStatus = props.config?.showKernelStatus !== false

  return (
    <div className="xyq-shell" data-platform="web">
      <header className="xyq-shell__header">
        <span className="xyq-shell__brand">xyq-box</span>
        <div className="xyq-shell__toolbar">
          <ViewSlot ctx={ctx} slot="toolbar" />
        </div>
      </header>

      <div className="xyq-shell__body">
        <aside className="xyq-shell__sidebar">
          <ViewSlot ctx={ctx} slot="sidebar" />
        </aside>
        <main className="xyq-shell__main">
          <ViewSlot ctx={ctx} slot="panel" />
        </main>
      </div>

      <footer className="xyq-shell__statusbar">
        <ViewSlot ctx={ctx} slot="statusbar" />
        {showStatus && (
          <>
            <span className="xyq-shell__status-item" data-testid="kernel-status">
              kernel v{kernelVersion} · {ctx.registry.size} 插件
            </span>
            <span
              className={`xyq-shell__status-item xyq-shell__status-item--${online ? 'online' : 'offline'}`}
            >
              {online ? '在线' : '离线'}
            </span>
          </>
        )}
      </footer>
    </div>
  )
}
