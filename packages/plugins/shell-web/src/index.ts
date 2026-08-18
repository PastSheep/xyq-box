/**
 * @xyq-box/plugin-shell-web —— Web 壳插件（M1）
 *
 * 职责（docs/02 §1、docs/06 M1）：
 * 1. 提供 system 服务（浏览器能力代理：window/document/notification 等）；
 * 2. 渲染 React UI 根，显示 root slot 的视图（由 plugin-layout 占据）；
 *    root slot 无视图时降级渲染自身壳（ShellApp）。
 * 3. 不再直接占据 root slot —— M1 移交给 plugin-layout。
 *
 * 遵循 docs/03-插件规范.md：
 * - views 为可选能力，经 ctx.get 探测（docs/03 §4），缺失时降级为仅渲染壳自身；
 * - 所有注册均为 effect 语义，插件卸载自动清理。
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from 'cordis'
import Schema from 'schemastery'

import { SystemServiceImpl } from './system.js'
import { ShellApp, ShellContext } from './ui/ShellApp.js'
import { RootSlotRenderer } from './ui/RootSlotRenderer.js'

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

  // 3. 渲染 React UI 根
  //    RootSlotRenderer 读取 views 服务的 root slot，由 layout 插件占据；
  //    无 root 视图时降级渲染 ShellApp（自身壳）
  const mount = typeof document === 'undefined' ? null : document.getElementById(config.mountPoint)
  if (!mount) {
    logger.error('mount point #%s not found — UI root not rendered', config.mountPoint)
    return
  }
  const root: Root = createRoot(mount)
  ctx.effect(() => {
    root.render(
      createElement(
        ShellContext.Provider,
        { value: ctx },
        createElement(RootSlotRenderer, {
          ctx,
          fallback: createElement(ShellApp, { config }),
        }),
      ),
    )
    return () => {
      root.unmount()
      logger.info('React UI root unmounted')
    }
  })
  logger.info('React UI root mounted at #%s', config.mountPoint)
}
