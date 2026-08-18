/**
 * @xyq-box/plugin-layout —— LayoutService：面板布局状态管理
 *
 * 管理面板布局状态（侧边栏折叠/宽度、面板停靠覆盖），
 * 持久化到 localStorage，支持 onChange 订阅（effect 语义）。
 */

import { Context, Service } from 'cordis'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 面板停靠覆盖：viewId → 目标 slot */
export type DockingMap = Record<string, string>

export interface LayoutState {
  sidebar: { collapsed: boolean; width: number }
  /** 停靠覆盖：把视图从注册 slot 拖到另一 slot */
  docking: DockingMap
}

export interface LayoutService {
  /** 获取当前布局状态 */
  getState(): LayoutState
  /** 更新侧边栏状态 */
  setSidebar(patch: Partial<LayoutState['sidebar']>): void
  /** 把视图停靠到指定 slot */
  dock(viewId: string, slot: string): void
  /** 移除视图的停靠覆盖（恢复注册 slot） */
  undock(viewId: string): void
  /** 重置布局为默认 */
  reset(): void
  /** 订阅布局状态变更（effect 语义） */
  onChange(listener: (state: LayoutState) => void): () => void
}

// ─── 默认与持久化 ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'xyq-box:layout:v1'

export const DEFAULT_LAYOUT: LayoutState = {
  sidebar: { collapsed: false, width: 240 },
  docking: {},
}

function loadState(): LayoutState {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return { ...DEFAULT_LAYOUT, sidebar: { ...DEFAULT_LAYOUT.sidebar } }
    const parsed = JSON.parse(raw) as Partial<LayoutState>
    return {
      sidebar: {
        collapsed: parsed.sidebar?.collapsed ?? DEFAULT_LAYOUT.sidebar.collapsed,
        width: parsed.sidebar?.width ?? DEFAULT_LAYOUT.sidebar.width,
      },
      docking: parsed.docking ?? {},
    }
  } catch {
    return { ...DEFAULT_LAYOUT, sidebar: { ...DEFAULT_LAYOUT.sidebar } }
  }
}

function saveState(state: LayoutState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
  } catch {
    // 静默忽略（私有模式或非浏览器环境）
  }
}

// ─── 实现 ────────────────────────────────────────────────────────────────────

export class LayoutServiceImpl extends Service implements LayoutService {
  private state: LayoutState
  private listeners = new Set<(state: LayoutState) => void>()
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context) {
    super(ctx, 'layout')
    this.logger = ctx.logger('layout')
    this.state = loadState()
    this.logger.info('layout service created, sidebar=%j', this.state.sidebar)
  }

  getState(): LayoutState {
    return this.state
  }

  setSidebar(patch: Partial<LayoutState['sidebar']>): void {
    this.state = {
      ...this.state,
      sidebar: { ...this.state.sidebar, ...patch },
    }
    this.persist()
  }

  dock(viewId: string, slot: string): void {
    this.state = {
      ...this.state,
      docking: { ...this.state.docking, [viewId]: slot },
    }
    this.logger.info('docked view %s → %s', viewId, slot)
    this.persist()
  }

  undock(viewId: string): void {
    const { [viewId]: _, ...rest } = this.state.docking
    this.state = {
      ...this.state,
      docking: rest,
    }
    this.logger.info('undocked view %s', viewId)
    this.persist()
  }

  reset(): void {
    this.state = { ...DEFAULT_LAYOUT, sidebar: { ...DEFAULT_LAYOUT.sidebar } }
    this.persist()
  }

  onChange(listener: (state: LayoutState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private persist(): void {
    saveState(this.state)
    for (const listener of this.listeners) {
      try {
        listener(this.state)
      } catch (error) {
        this.logger.warn('onChange listener threw: %s', error)
      }
    }
  }
}

// ─── 类型声明合并 ───────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    layout: LayoutService
  }
}
