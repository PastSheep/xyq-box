/**
 * @xyq-box/sdk —— xyq-box 插件 SDK
 *
 * 约定：零运行时依赖（纯类型 + 小工具）。
 * 提供 defineView / definePlugin / 类型合并助手；M0 先占位，实现随 M0 里程碑补齐。
 */

/** SDK 版本 */
export const version = '0.1.0'

/** 视图描述符（views 服务识别的最小协议，见 docs/03 §3.2） */
export interface ViewDescriptor {
  /** 挂载的扩展点 */
  slots: string[]
  /** 显示标题 */
  title: string
  /** 图标名 */
  icon?: string
}

/** 定义视图描述符（M0 占位：仅类型约束，运行时实现待 views 服务落地） */
export function defineView(descriptor: ViewDescriptor): ViewDescriptor {
  return descriptor
}
