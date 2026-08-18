/**
 * @xyq-box/plugin-shell-web —— ViewSlot：扩展点聚合渲染器
 *
 * 渲染某 slot 下所有已注册视图（docs/02 §4：壳只渲染「聚合结果」）。
 * views 服务缺失时渲染占位，不崩溃 —— 视图聚合随 plugin-views（M1）装载自动生效。
 */

import { createElement, type ReactNode } from 'react'
import type { Context } from 'cordis'

import type { ViewDescriptorLike, ViewsServiceLike } from '../types.js'

export interface ViewSlotProps {
  ctx: Context
  slot: string
  /** views 服务缺失或该 slot 无视图时的占位内容 */
  fallback?: ReactNode
}

/** 视图上下文（docs/04 §5 ViewContext） */
function buildViewContext(ctx: Context, descriptor: ViewDescriptorLike) {
  return {
    connection: ctx.get('connection'),
    logger: ctx.logger(descriptor.id),
    config: ctx.get('config'),
    commands: ctx.get('commands'),
  }
}

/** 渲染某 slot 下所有已注册视图 */
export function ViewSlot({ ctx, slot, fallback }: ViewSlotProps) {
  const views = ctx.get('views') as ViewsServiceLike | undefined

  if (!views) {
    return (
      <div className="xyq-slot xyq-slot--empty" data-slot={slot}>
        {fallback ?? `（${slot}：views 服务未装载）`}
      </div>
    )
  }

  const descriptors = views
    .list(slot)
    .filter((descriptor) => !descriptor.visible || descriptor.visible())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  if (descriptors.length === 0) {
    return (
      <div className="xyq-slot xyq-slot--empty" data-slot={slot}>
        {fallback ?? `（${slot}：暂无视图）`}
      </div>
    )
  }

  return (
    <div className="xyq-slot" data-slot={slot}>
      {descriptors.map((descriptor) => (
        <ViewItem key={descriptor.id} ctx={ctx} descriptor={descriptor} />
      ))}
    </div>
  )
}

/** 单个视图：组件渲染优先，无框架渲染器兜底 */
function ViewItem({ ctx, descriptor }: { ctx: Context; descriptor: ViewDescriptorLike }) {
  const viewContext = buildViewContext(ctx, descriptor)

  if (descriptor.component) {
    const component = descriptor.component as React.ComponentType<Record<string, unknown>>
    return (
      <div className="xyq-view" data-view={descriptor.id}>
        {createElement(component, viewContext as Record<string, unknown>)}
      </div>
    )
  }

  if (descriptor.render) {
    return (
      <div className="xyq-view" data-view={descriptor.id}>
        {descriptor.render(viewContext) as ReactNode}
      </div>
    )
  }

  return (
    <div className="xyq-view xyq-view--empty" data-view={descriptor.id}>
      （视图 {descriptor.id} 未提供 component/render）
    </div>
  )
}
