/**
 * @xyq-box/plugin-layout —— PanelContainer：面板容器（占据 root slot）
 *
 * 渲染完整的面板布局：
 * - header：品牌 + toolbar slot 视图；
 * - sidebar：可折叠、可调宽，渲染 sidebar slot 视图；
 * - main：渲染 panel slot 视图（支持拖拽停靠到 sidebar）；
 * - statusbar：渲染 statusbar slot 视图。
 *
 * 特性：
 * - 折叠：侧边栏展开/收起（本地 + localStorage 持久化）；
 * - 拖拽停靠：panel 视图标题栏可拖到 sidebar（layout.dock 覆盖停靠，持久化）；
 * - 订阅：views.onChange 与 layout.onChange 驱动重渲染。
 */

import { useEffect, useState, type ReactNode } from 'react'

// ─── 结构类型（不依赖 shell-web / views 实现，docs/05 §2） ──────────────────

export interface LayoutViewDescriptor {
  id: string
  slots?: string[]
  slot?: string
  title?: string
  icon?: string
  component?: unknown
  render?: (viewContext: unknown) => unknown
  order?: number
  visible?: () => boolean
}

export interface LayoutViewsService {
  register(descriptor: LayoutViewDescriptor): () => void
  list(slot: string): LayoutViewDescriptor[]
  onChange(listener: () => void): () => void
}

export interface LayoutLike {
  getState(): {
    sidebar: { collapsed: boolean; width: number }
    docking: Record<string, string>
  }
  setSidebar(patch: Partial<{ collapsed: boolean; width: number }>): void
  dock(viewId: string, slot: string): void
  undock(viewId: string): void
  reset(): void
  onChange(listener: (state: unknown) => void): () => void
}

/** 视图上下文（由壳的 ViewSlot 传入的 props） */
export interface PanelContainerProps {
  ctx?: { get(name: string): unknown }
  connection?: unknown
  logger?: unknown
  config?: unknown
  commands?: unknown
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

function slotsOf(descriptor: LayoutViewDescriptor): string[] {
  return descriptor.slots ?? (descriptor.slot ? [descriptor.slot] : [])
}

function buildViewContext(descriptor: LayoutViewDescriptor, props: PanelContainerProps) {
  return {
    connection: props.connection,
    logger: props.logger,
    config: props.config,
    commands: props.commands,
  }
}

function renderView(descriptor: LayoutViewDescriptor, props: PanelContainerProps): ReactNode {
  const viewContext = buildViewContext(descriptor, props)
  if (descriptor.component) {
    const Component = descriptor.component as React.ComponentType<Record<string, unknown>>
    const React = require('react') as typeof import('react')
    return React.createElement(Component, viewContext)
  }
  if (descriptor.render) {
    return descriptor.render(viewContext) as ReactNode
  }
  return <span className="xyq-pane-empty">({descriptor.id} 无渲染器)</span>
}

// ─── 面板卡片（带拖拽句柄 + 折叠按钮） ──────────────────────────────────────

interface PaneProps {
  descriptor: LayoutViewDescriptor
  props: PanelContainerProps
  dockSlot: string
  showCollapse?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
}

function Pane({ descriptor, props, dockSlot, showCollapse, collapsed, onToggleCollapse }: PaneProps) {
  const title = descriptor.title ?? descriptor.id
  const targetSlot = dockSlot === 'panel' ? 'sidebar' : 'panel'
  const dockHint = '拖拽到' + (targetSlot === 'sidebar' ? '侧边栏' : '主区域') + '停靠'
  return (
    <div
      className={'xyq-pane' + (collapsed ? ' xyq-pane--collapsed' : '')}
      data-view={descriptor.id}
      data-slot={dockSlot}
    >
      <div
        className="xyq-pane__header"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/xyq-view', descriptor.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        title={dockHint}
      >
        {descriptor.icon && <span className="xyq-pane__icon">{descriptor.icon}</span>}
        <span className="xyq-pane__title">{title}</span>
        {showCollapse && onToggleCollapse && (
          <button
            className="xyq-pane__toggle"
            onClick={(event) => {
              event.stopPropagation()
              onToggleCollapse()
            }}
            title={collapsed ? '展开' : '折叠'}
          >
            {collapsed ? '\u25B8' : '\u25BE'}
          </button>
        )}
      </div>
      {!collapsed && <div className="xyq-pane__body">{renderView(descriptor, props)}</div>}
    </div>
  )
}

// ─── 面板容器 ────────────────────────────────────────────────────────────────

export function PanelContainer(props: PanelContainerProps) {
  const ctx = props.ctx
  const views = ctx?.get('views') as LayoutViewsService | undefined
  const layout = ctx?.get('layout') as LayoutLike | undefined

  const [tick, setTick] = useState(0)
  const layoutState = layout?.getState()
  const [local, setLocal] = useState(() => ({
    collapsed: layoutState?.sidebar.collapsed ?? false,
    width: layoutState?.sidebar.width ?? 260,
  }))

  useEffect(() => {
    const disposers: Array<() => void> = []
    if (views) disposers.push(views.onChange(() => setTick((t) => t + 1)))
    if (layout) disposers.push(layout.onChange(() => setTick((t) => t + 1)))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [views, layout])

  void tick

  const sidebar: LayoutViewDescriptor[] = views ? listViews(views, 'sidebar') : []
  const panel: LayoutViewDescriptor[] = views ? listViews(views, 'panel') : []
  const toolbar: LayoutViewDescriptor[] = views ? listViews(views, 'toolbar') : []
  const statusbar: LayoutViewDescriptor[] = views ? listViews(views, 'statusbar') : []

  const docking = layoutState?.docking ?? localDocking()
  const effectiveSidebar = applyDocking(sidebar, panel, docking, 'sidebar')
  const effectivePanel = applyDocking(panel, sidebar, docking, 'panel')

  const collapsed = layoutState?.sidebar.collapsed ?? local.collapsed
  const width = layoutState?.sidebar.width ?? local.width

  return (
    <div className="xyq-panels" data-layout="docked">
      <header className="xyq-panels__header">
        <span className="xyq-panels__brand">xyq-box</span>
        <div className="xyq-panels__toolbar">
          {toolbar.map((descriptor) => (
            <Pane
              key={descriptor.id}
              descriptor={descriptor}
              props={props}
              dockSlot="toolbar"
              showCollapse
              collapsed={false}
              onToggleCollapse={undefined}
            />
          ))}
        </div>
      </header>

      <div className="xyq-panels__body">
        <aside
          className={'xyq-panels__sidebar' + (collapsed ? ' xyq-panels__sidebar--collapsed' : '')}
          style={collapsed ? undefined : { width }}
          onDragOver={allowDrop}
          onDrop={(event) => onDock(event, 'sidebar', props.ctx, layout)}
        >
          <div className="xyq-panels__sidebar-head">
            <span className="xyq-panels__sidebar-title">侧边栏</span>
            <button
              className="xyq-panels__collapse"
              onClick={() => toggleSidebar(props.ctx, layout, collapsed, local, setLocal)}
              title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            >
              {collapsed ? '\u00BB' : '\u00AB'}
            </button>
          </div>
          {!collapsed &&
            (effectiveSidebar.length > 0 ? (
              effectiveSidebar.map((descriptor) => (
                <Pane
                  key={descriptor.id}
                  descriptor={descriptor}
                  props={props}
                  dockSlot="sidebar"
                  showCollapse
                  collapsed={false}
                  onToggleCollapse={undefined}
                />
              ))
            ) : (
              <div className="xyq-panels__empty">（sidebar：暂无视图）</div>
            ))}
        </aside>

        <main
          className="xyq-panels__main"
          onDragOver={allowDrop}
          onDrop={(event) => onDock(event, 'panel', props.ctx, layout)}
        >
          {effectivePanel.length > 0 ? (
            effectivePanel.map((descriptor) => (
              <Pane
                key={descriptor.id}
                descriptor={descriptor}
                props={props}
                dockSlot="panel"
                showCollapse={false}
              />
            ))
          ) : (
            <div className="xyq-panels__empty xyq-panels__empty--main">
              （panel：暂无视图，拖拽侧边栏面板到此停靠）
            </div>
          )}
        </main>
      </div>

      <footer className="xyq-panels__statusbar">
        {statusbar.length > 0 ? (
          statusbar.map((descriptor) => (
            <Pane key={descriptor.id} descriptor={descriptor} props={props} dockSlot="statusbar" />
          ))
        ) : (
          <span className="xyq-panels__status-empty">就绪</span>
        )}
      </footer>
    </div>
  )
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function listViews(views: LayoutViewsService, slot: string): LayoutViewDescriptor[] {
  return views
    .list(slot)
    .filter((descriptor) => !descriptor.visible || descriptor.visible())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

function localDocking(): Record<string, string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('xyq-box:docking:v1') : null
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function applyDocking(
  own: LayoutViewDescriptor[],
  other: LayoutViewDescriptor[],
  docking: Record<string, string>,
  slot: string,
): LayoutViewDescriptor[] {
  const inflow = other.filter((descriptor) => docking[descriptor.id] === slot)
  const outflow = new Set(
    Object.entries(docking)
      .filter(([id, target]) => target !== slot && own.some((d) => d.id === id))
      .map(([id]) => id),
  )
  const result = [...own.filter((d) => !outflow.has(d.id)), ...inflow]
  const seen = new Set<string>()
  const unique = result.filter((d) => {
    if (seen.has(d.id)) return false
    seen.add(d.id)
    return true
  })
  return unique.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

function allowDrop(event: React.DragEvent): void {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

function onDock(
  event: React.DragEvent,
  slot: string,
  ctx?: { get(name: string): unknown },
  layout?: LayoutLike,
): void {
  event.preventDefault()
  const id = event.dataTransfer.getData('text/xyq-view')
  if (!id || !ctx) return
  const views = ctx.get('views') as LayoutViewsService | undefined
  if (!views) return
  const registered = [...views.list('panel'), ...views.list('sidebar')].find((d) => d.id === id)
  if (!registered) return
  const currentSlot = slotsOf(registered)[0] ?? 'panel'
  if (currentSlot === slot) {
    if (layout) layout.undock(id)
    return
  }
  if (layout) {
    layout.dock(id, slot)
  } else {
    const docking = { ...localDocking(), [id]: slot }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('xyq-box:docking:v1', JSON.stringify(docking))
      }
    } catch {
      // 忽略
    }
  }
}

function toggleSidebar(
  _ctx: { get(name: string): unknown } | undefined,
  layout: LayoutLike | undefined,
  collapsed: boolean,
  local: { collapsed: boolean; width: number },
  setLocal: (patch: { collapsed: boolean; width: number }) => void,
): void {
  const next = !collapsed
  if (layout) {
    layout.setSidebar({ collapsed: next })
  } else {
    setLocal({ ...local, collapsed: next })
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('xyq-box:sidebar:v1', JSON.stringify(next))
      }
    } catch {
      // 忽略
    }
  }
}
