/**
 * @xyq-box/plugin-views —— 视图服务
 *
 * docs/04 §5 定义的 ViewsService 实现。
 * 提供 ctx.views 服务：register/list/onChange，所有操作 effect 语义。
 * 插件卸载时自动清理已注册视图。
 *
 * 遵循 docs/03-插件规范.md：
 * - 服务名扁平命名空间（declare module 'cordis' 合并类型）；
 * - 注册返回 disposer，fiber 卸载时自动调用；
 * - 同时兼容 sdk defineView 的 slots 数组形态与 docs/04 的 slot 单数字段。
 */

import { Context, Service } from 'cordis'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 视图描述符（docs/04 §5） */
export interface ViewDescriptor {
  /** 全局唯一 id */
  id: string
  /** 挂载的扩展点（docs/04 单数形态） */
  slot?: string
  /** 挂载的扩展点列表（sdk defineView 形态） */
  slots?: string[]
  /** 显示标题 */
  title?: string
  /** 图标名 */
  icon?: string
  /** 组件引用（框架相关，由 UI 聚合插件解释） */
  component?: unknown
  /** 无框架渲染器（替代 component） */
  render?: (ctx: unknown) => unknown
  /** 排序权重 */
  order?: number
  /** 可用性条件 */
  visible?: () => boolean
  /** 挂载钩子 */
  setup?: (ctx: unknown) => void | Promise<void>
}

export interface ViewsService {
  /**
   * 注册视图描述符（effect 语义）。
   * @returns 退订函数，调用后视图从所有 slot 移除
   */
  register(descriptor: ViewDescriptor): () => void

  /**
   * 列出某 slot 下所有已注册视图（按 order 排序）。
   */
  list(slot: string): ViewDescriptor[]

  /**
   * 订阅变更通知（effect 语义）。
   * @returns 退订函数
   */
  onChange(listener: () => void): () => void
}

// ─── 实现 ────────────────────────────────────────────────────────────────────

export class ViewsServiceImpl extends Service implements ViewsService {
  /** slot → Map<id, descriptor> */
  private slotMap = new Map<string, Map<string, ViewDescriptor>>()
  /** 变更通知订阅者 */
  private listeners = new Set<() => void>()
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context) {
    super(ctx, 'views')
    this.logger = ctx.logger('views')
  }

  register(descriptor: ViewDescriptor): () => void {
    // 归一化：同时支持 slots 数组与 slot 单数字段
    const slots = descriptor.slots ?? (descriptor.slot ? [descriptor.slot] : [])
    if (slots.length === 0) {
      this.logger.warn('register called without slot/slots, id=%s', descriptor.id)
      return () => {}
    }

    for (const slot of slots) {
      let map = this.slotMap.get(slot)
      if (!map) {
        map = new Map()
        this.slotMap.set(slot, map)
      }
      // 同 id 重复注册：后注册覆盖
      const existing = map.get(descriptor.id)
      if (existing) {
        this.logger.warn('view %s re-registered in slot %s (overwrite)', descriptor.id, slot)
      }
      map.set(descriptor.id, descriptor)
    }

    this.logger.debug('registered view %s in slots %j', descriptor.id, slots)
    this.notify()

    // effect 语义：返回退订函数
    return () => {
      for (const slot of slots) {
        const map = this.slotMap.get(slot)
        if (!map) continue
        map.delete(descriptor.id)
        if (map.size === 0) {
          this.slotMap.delete(slot)
        }
      }
      this.logger.debug('unregistered view %s', descriptor.id)
      this.notify()
    }
  }

  list(slot: string): ViewDescriptor[] {
    const map = this.slotMap.get(slot)
    if (!map) return []
    return Array.from(map.values()).sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        this.logger.warn('onChange listener threw: %s', error)
      }
    }
  }
}

// ─── 类型声明合并 ───────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    views: ViewsService
  }
}

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-views'
export const inject = ['logger']
export const provide = ['views']

export function apply(ctx: Context) {
  const logger = ctx.logger('views')
  logger.info('plugin loaded')

  // Service 构造器即 effect 语义注册，卸载时自动撤销
  new ViewsServiceImpl(ctx)
}