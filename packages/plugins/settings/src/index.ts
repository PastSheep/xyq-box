/**
 * @xyq-box/plugin-settings —— 设置 UI（M1）
 *
 * docs/04 §2 与 docs/06 M1：设置 UI 本身是插件，消费 config + views：
 * - 「按插件 Config schema 自动生成设置表单 UI」= config.listSchemas() +
 *   schemaToForm（src/schema.ts）+ SettingsPanel（src/ui/SettingsPanel.tsx）；
 * - 注册为 panel slot 下的视图，由 plugin-layout 的面板容器渲染；
 * - 编辑即保存到 config 服务：持久化与热重载均由 config 负责（本插件零重复）。
 *
 * 遵循 docs/03-插件规范.md：
 * - views 为可选能力，经 ctx.get 探测（docs/03 §4），缺失时仅打日志不渲染；
 * - 自身也声明 Config schema（设置 UI 自己的表单就是第一个被渲染的例子）。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'

import { SettingsPanel, type ConfigServiceLike } from './ui/SettingsPanel.js'
import './ui/settings.css'

// ─── 配置声明（schemastery DSL，docs/03 §5） ─────────────────────────────────

export interface Config {
  /** 面板标题 */
  title: string
  /** 是否显示字段说明 */
  showDescriptions: boolean
  /** 面板排序权重（越小越靠前） */
  order: number
}

export const Config = Schema.object({
  title: Schema.string().default('设置').description('设置面板标题'),
  showDescriptions: Schema.boolean().default(true).description('是否显示字段说明'),
  order: Schema.natural().default(100).description('面板排序权重（越小越靠前）'),
})

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-settings'
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

/** 卸载当前视图注册（effect 语义） */
export function apply(ctx: Context, _config: Config) {
  const logger = ctx.logger('settings')
  logger.info('plugin loaded')

  // config 服务为硬依赖：缺失时插件应 PENDING（settings 没有 config 就没有表单）
  const config = ctx.get('config') as ConfigServiceLike | undefined
  if (!config) {
    logger.warn('config 服务不可用（plugin-config 未装载）—— 设置 UI 无法工作')
    return
  }

  const views = ctx.get('views') as ViewsServiceLike | undefined
  if (!views?.register) {
    logger.warn('views 服务不可用（plugin-views 未装载）—— 设置 UI 视图未注册')
    return
  }

  // 注册设置面板视图（panel slot，由 plugin-layout 渲染）
  const dispose = views.register({
    id: '@xyq-box/plugin-settings/panel',
    slots: ['panel'],
    title: '设置',
    icon: '⚙',
    component: SettingsPanel,
    order: 100,
  })

  // effect 语义：卸载时撤销视图注册
  ctx.effect(() => {
    return () => {
      dispose()
      logger.info('settings panel disposed')
    }
  })

  logger.info('settings panel registered (panel slot)')
}
