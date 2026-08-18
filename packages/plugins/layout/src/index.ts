/**
 * @xyq-box/plugin-layout —— 面板系统（M1）
 *
 * docs/04 §5：占据 root slot，渲染面板容器（拖拽停靠、折叠、布局持久化）；
 * 管理 panel / sidebar / toolbar / statusbar 子 slot 的布局。
 *
 * 遵循 docs/03-插件规范.md：
 * - 提供 layout 服务（ctx.layout）；
 * - 依赖 views 服务（可选：缺失时降级为无面板管理的基础布局）；
 * - 所有注册均为 effect 语义，插件卸载自动清理。
 */

import { createElement } from 'react'
import type { Context } from 'cordis'
import Schema from 'schemastery'
import { defineView } from '@xyq-box/sdk'

import { LayoutServiceImpl } from './layout.js'
import { PanelContainer } from './ui/PanelContainer.js'
import './ui/layout.css'

// ─── 配置声明 ────────────────────────────────────────────────────────────────

export interface Config {
  /** 默认侧边栏宽度（px） */
  defaultSidebarWidth: number
  /** 默认侧边栏折叠状态 */
  defaultSidebarCollapsed: boolean
  /** 最小侧边栏宽度（px） */
  minSidebarWidth: number
}

export const Config = Schema.object({
  defaultSidebarWidth: Schema.natural().default(260).description('默认侧边栏宽度（px）'),
  defaultSidebarCollapsed: Schema.boolean().default(false).description('默认侧边栏折叠状态'),
  minSidebarWidth: Schema.natural().default(180).description('最小侧边栏宽度（px）'),
})

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-layout'
export const inject = ['logger']
export const provide = ['layout']

export function apply(ctx: Context, _config: Config) {
  const logger = ctx.logger('layout')
  logger.info('plugin loaded')

  // 1. 注册 layout 服务（面板布局状态管理，Service 构造器即 effect 语义注册）
  new LayoutServiceImpl(ctx)

  // 2. 占据 root slot：注册 root 视图描述符
  const views = ctx.get('views') as { register: (descriptor: unknown) => () => void } | undefined
  if (views) {
    views.register({
      id: '@xyq-box/plugin-layout/root',
      slots: ['root'],
      title: '面板容器',
      component: PanelContainer,
      order: -100,
    })
    logger.info('registered root slot view: %s', '@xyq-box/plugin-layout/root')
  } else {
    logger.warn('views 服务不可用（plugin-views 未装载）—— 布局需 views 服务')
  }
}