/**
 * @xyq-box/plugin-diagnostics —— 插件实时状态面板（M1）
 *
 * docs/04 §10 与 docs/06 M1：诊断面板消费内核诊断接口
 * （plugin-manager getStatus 同源的 ctx.registry + fiber 状态事件）与
 * 日志环形缓冲（cordis 内置 logger 的 buffer / exporter），渲染为 panel 视图。
 *
 * 遵循 docs/03-插件规范.md：
 * - views 为可选能力，经 ctx.get 探测，缺失时仅打日志不渲染；
 * - 控制器所有订阅均为 effect 语义（ctx.on / exporter），插件卸载自动清理；
 * - 无框架依赖，控制器单测可驱动（tests/diagnostics.spec.ts）。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'

import { DiagnosticsController, setController } from './diagnostics.js'
import { DiagnosticsPanel } from './ui/DiagnosticsPanel.js'
import './ui/diagnostics.css'

// ─── 配置声明（schemastery DSL，docs/03 §5） ─────────────────────────────────

export interface Config {
  /** 日志环形缓冲容量上限（仅 UI 层展示条数） */
  maxLogs: number
  /** 面板排序权重（越小越靠前） */
  order: number
}

export const Config = Schema.object({
  maxLogs: Schema.natural().default(500).description('日志环形缓冲容量上限'),
  order: Schema.natural().default(200).description('面板排序权重（越小越靠前）'),
})

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-diagnostics'
export const inject = ['logger']
export const provide = []

interface ViewsServiceLike {
  register(descriptor: {
    id: string
    slots?: string[]
    slot?: string
    title?: string
    icon?: string
    component?: unknown
    order?: number
  }): () => void
}

export function apply(ctx: Context, _config: Config) {
  const logger = ctx.logger('diagnostics')
  logger.info('plugin loaded')

  // 1. 创建诊断控制器：订阅 fiber 状态事件 + 日志环形缓冲
  const controller = new DiagnosticsController(ctx, { maxLogs: _config.maxLogs })
  setController(controller)

  // 2. 注册诊断面板视图（panel slot，由 plugin-layout 渲染）
  const views = ctx.get('views') as ViewsServiceLike | undefined
  if (!views?.register) {
    logger.warn('views 服务不可用（plugin-views 未装载）—— 诊断面板视图未注册')
    return
  }
  const dispose = views.register({
    id: '@xyq-box/plugin-diagnostics/panel',
    slots: ['panel'],
    title: '诊断',
    icon: '🩺',
    component: DiagnosticsPanel,
    order: _config.order,
  })

  // effect 语义：卸载时撤销视图注册 + 清理控制器
  ctx.effect(() => {
    return () => {
      dispose()
      controller.dispose()
      setController(null)
      logger.info('diagnostics panel disposed')
    }
  })

  logger.info('diagnostics panel registered (panel slot)')
}
