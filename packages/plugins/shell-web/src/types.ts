/**
 * @xyq-box/plugin-shell-web —— 结构类型
 *
 * 壳与 plugin-views 协作所需的最小结构类型（docs/04 §5、docs/03 §3.2）。
 * 不 import plugin-views 实现（插件间禁止包级依赖，docs/05 §2），
 * 任何满足该形状的 views 服务都可被结构识别。
 */

/** 视图描述符（结构子集：兼容 sdk defineView 的 slots 与 docs/04 的 slot 单数形态） */
export interface ViewDescriptorLike {
  /** 全局唯一 id */
  id: string
  /** 挂载的扩展点列表（sdk defineView 形态） */
  slots?: string[]
  /** 挂载的扩展点（docs/04 §5 单数形态，二者取一） */
  slot?: string
  /** 显示标题 */
  title?: string
  /** 图标名 */
  icon?: string
  /** 组件引用（框架相关，由 UI 聚合插件解释） */
  component?: unknown
  /** 无框架渲染器（替代 component） */
  render?: (viewContext: unknown) => unknown
  /** 排序权重 */
  order?: number
  /** 可用性条件 */
  visible?: () => boolean
  /** 挂载钩子 */
  setup?: (viewContext: unknown) => void | Promise<void>
}

/** views 服务（docs/04 §5）的结构子集 */
export interface ViewsServiceLike {
  register(descriptor: ViewDescriptorLike): () => void
  list(slot: string): ViewDescriptorLike[]
  onChange(listener: () => void): () => void
}

/** 内置扩展点（docs/02 §4） */
export type SlotName =
  'root' | 'sidebar' | 'panel' | 'toolbar' | 'statusbar' | 'context-menu' | 'theme' | 'command'

/**
 * 壳聚合渲染的扩展点集合。
 * root 由壳自身占据（docs/02 §4：通常只由壳或布局插件占据），不参与聚合，避免自渲染循环。
 */
export const SHELL_SLOTS: SlotName[] = ['sidebar', 'toolbar', 'statusbar', 'panel']

/** 取描述符声明的扩展点列表（兼容 slots 数组与 slot 单数） */
export function slotsOf(descriptor: ViewDescriptorLike): string[] {
  const list = descriptor.slots ?? (descriptor.slot ? [descriptor.slot] : [])
  return list
}
