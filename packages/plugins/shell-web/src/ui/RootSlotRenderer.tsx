/**
 * @xyq-box/plugin-shell-web —— RootSlotRenderer：root slot 渲染器
 *
 * M1：root slot 由布局插件（plugin-layout）占据，壳只负责把 root slot 的
 * 第一个视图渲染到 React 根。视图缺失时降级渲染 fallback（自身壳）。
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { Context } from 'cordis'

import type { ViewDescriptorLike, ViewsServiceLike } from '../types.js'

export interface RootSlotRendererProps {
  ctx: Context
  /** root slot 无视图时的兜底渲染 */
  fallback?: ReactNode
}

/** 渲染 root slot 的第一个视图（占据者通常只有一个） */
export function RootSlotRenderer({ ctx, fallback }: RootSlotRendererProps) {
  const [tick, setTick] = useState(0)
  const [rootView, setRootView] = useState<ViewDescriptorLike | null>(null)

  useEffect(() => {
    const views = ctx.get('views') as ViewsServiceLike | undefined
    if (!views) {
      setRootView(null)
      return
    }
    const refresh = () => {
      const roots = views
        .list('root')
        .filter((descriptor) => !descriptor.visible || descriptor.visible())
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      setRootView(roots[0] ?? null)
    }
    refresh()
    const dispose = views.onChange(refresh)
    return () => {
      dispose()
    }
  }, [ctx])

  void tick // 保留：若需强制重渲染

  if (!rootView) return <>{fallback}</>

  const viewContext = {
    connection: ctx.get('connection'),
    logger: ctx.logger(rootView.id),
    config: ctx.get('config'),
    commands: ctx.get('commands'),
    ctx,
  }

  if (rootView.component) {
    const Component = rootView.component as React.ComponentType<Record<string, unknown>>
    return (
      <div className="xyq-root" data-view={rootView.id}>
        {createElement(Component, viewContext as Record<string, unknown>)}
      </div>
    )
  }

  if (rootView.render) {
    return (
      <div className="xyq-root" data-view={rootView.id}>
        {rootView.render(viewContext) as ReactNode}
      </div>
    )
  }

  return <>{fallback}</>
}
