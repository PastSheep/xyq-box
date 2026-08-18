/**
 * @xyq-box/plugin-shell-web —— Web 壳插件（M1）
 *
 * 职责（docs/02 §1、docs/06 M1）：
 * 1. 提供 system 服务（浏览器能力代理：window/document/notification 等）；
 * 2. 占据 root slot（views 服务可用时注册 root 视图描述符，docs/02 §4）；
 * 3. 渲染 React UI 根，并作为 UI 聚合器订阅 plugin-views 汇聚所有已注册视图。
 *
 * 遵循 docs/03-插件规范.md：
 * - views 为可选能力，经 ctx.get 探测（docs/03 §4），缺失时降级为仅渲染壳自身；
 * - 所有注册均为 effect 语义，插件卸载自动清理。
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from 'cordis'
import Schema from 'schemastery'
import { defineView } from '@xyq-box/sdk'

import { SystemServiceImpl } from './system.js'
import { ShellApp, ShellContext } from './ui/ShellApp.js'
import type { ViewsServiceLike } from './types.js'

// ─── 配置声明（schemastery DSL，docs/03 §5） ─────────────────────────────────

export interface Config {
  /** React 根挂载点元素 id（见 index.html 的 #root） */
  mountPoint: string
  /** 页面标题（写入 document.title） */
  title: string
  /** 状态栏是否显示内核状态（版本 / 插件数 / 在线） */
  showKernelStatus: boolean
}

export const Config = Schema.object({
  mountPoint: Schema.string().default('root').description('React 根挂载点元素 id'),
  title: Schema.string().default('xyq-box').description('页面标题'),
  showKernelStatus: Schema.boolean().default(true).description('状态栏显示内核状态'),
})

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-shell-web'
export const provide = ['system']

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('shell-web')
  logger.info('shell plugin loaded, config=%j', config)

  // 1. system 服务（浏览器能力代理）
  new SystemServiceImpl(ctx)

  // 2. 页面标题
  ctx.system.setTitle(config.title)

  // 3. 占据 root slot：注册 root 视图描述符（views 为可选能力，docs/03 §4）
  const views = ctx.get('views') as ViewsServiceLike | undefined
  if (views) {
    const descriptor = defineView({
      slots: ['root'],
      title: 'Web 壳',
      icon: 'globe',
      component: ShellApp,
    })
    ctx.effect(() => {
      // sdk defineView 不含 id；views 服务要求全局唯一 id，此处补全
      return views.register({ ...descriptor, id: '@xyq-box/plugin-shell-web/root' })
    })
    logger.info('registered root slot view: %s', '@xyq-box/plugin-shell-web/root')
  } else {
    logger.warn('views 服务不可用（plugin-views 未装载）——视图聚合降级为仅渲染壳自身')
  }

  // 4. 渲染 React UI 根（占据 root slot 的渲染层）
  const mount = typeof document === 'undefined' ? null : document.getElementById(config.mountPoint)
  if (!mount) {
    logger.error('mount point #%s not found — UI root not rendered', config.mountPoint)
    return
  }
  const root: Root = createRoot(mount)
  ctx.effect(() => {
    root.render(
      createElement(ShellContext.Provider, { value: ctx }, createElement(ShellApp, { config })),
    )
    return () => {
      root.unmount()
      logger.info('React UI root unmounted')
    }
  })
  logger.info('React UI root mounted at #%s', config.mountPoint)
}
