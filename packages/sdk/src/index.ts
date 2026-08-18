/**
 * @xyq-box/sdk —— xyq-box 插件 SDK
 *
 * 约定：零运行时依赖（纯类型 + 小工具）。
 * 提供 defineView / definePlugin / Context 合并助手。
 */

// ─── 版本 ────────────────────────────────────────────────────────────────────

/** SDK 版本 */
export const version = '0.1.0'

// ─── ViewDescriptor / defineView ─────────────────────────────────────────────

/** 视图描述符（views 服务识别的最小协议，见 docs/03 §3.2） */
export interface ViewDescriptor {
  /** 挂载的扩展点 */
  slots: string[]
  /** 显示标题 */
  title: string
  /** 图标名 */
  icon?: string
  /** 组件引用（框架相关，React / Vue 等，由 UI 聚合插件解释） */
  component?: unknown
  /** setup 钩子（视图挂载时调用，可用于注册 RPC 消费等） */
  setup?: (ctx: unknown) => void
}

/** 定义视图描述符。类型安全包装，运行时仅返回原值。 */
export function defineView(descriptor: ViewDescriptor): ViewDescriptor {
  return descriptor
}

// ─── definePlugin — 类型安全插件定义 ─────────────────────────────────────────

import type { Plugin } from 'cordis'

/**
 * 定义插件入口。
 *
 * 类型安全包装，自动推断 Config 与 inject/provide 约束。
 * 运行时仅返回原值，无额外开销。
 */
export function definePlugin<T extends Plugin.Base>(plugin: T): T {
  return plugin
}

// ─── Context 合并助手 ────────────────────────────────────────────────────────

/**
 * SDK 级 Context 声明接口。
 *
 * 插件可通过 `declare module "@xyq-box/sdk"` 扩展此接口，
 * 声明其提供的服务，SDK 自动将其合并到 cordis 的 Context 中，
 * 使消费者能获得完整的类型提示。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Context {}

/** 本地别名（供 declare module 桥接使用） */
type SdkContext = Context

/**
 * 将 SDK Context 注入 cordis Context 的声明合并桥梁。
 *
 * 插件通过 declare module "@xyq-box/sdk" 扩展 Context 后，
 * 此声明自动使 cordis 的 Context 也包含这些扩展字段。
 */
declare module 'cordis' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Context extends SdkContext {}
}