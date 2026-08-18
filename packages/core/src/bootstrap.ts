/**
 * @xyq-box/core — 内核引导（bootstrap）
 *
 * 职责：创建 Cordis 根 Context、读取插件清单、装载默认插件集。
 * 符合 docs/02 §2.1 定义：部署入口只调用它一次，之后一切能力来自插件。
 */

import { Context } from 'cordis'

import { provideConnection } from './connection.js'
import { createPluginManager } from './plugin-manager.js'
import type { BootstrapOptions, KernelHandle } from './types.js'

/** 当前内核版本 */
export const version = '0.1.0'

/**
 * 引导 xyq-box 内核。
 *
 * @param options - 引导选项
 * @returns 内核句柄，包含插件管理与诊断 API
 *
 * @example
 * ```ts
 * import { bootstrap } from '@xyq-box/core'
 * const kernel = await bootstrap({ profile: 'default' })
 * ```
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<KernelHandle> {
  const { profile = 'default' } = options
  // basePath 缺省：Node 端取 process.cwd()，浏览器端（无 process）退回 '/'
  const basePath =
    options.basePath ??
    (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '/')

  // 1. 创建 Cordis 根上下文
  const ctx = new Context()
  ctx.logger.info(`[kernel] booting xyq-box v${version} (profile: ${profile})`)

  // 2. 注册内置 service（connection 是内核与部署入口的通信契约，docs/04 §8）
  //    传输实现可换（docs/02 §3.1）：部署入口可注入自定义 connection
  //    （如桌面渲染进程的 Electron IPC 传输），缺省进程内直通。
  if (options.connection) {
    options.connection(ctx)
  } else {
    provideConnection(ctx)
  }

  // 3. 创建插件管理器（浏览器端注入清单来源与模块加载器，见 BootstrapOptions）
  const plugins = createPluginManager(ctx, basePath, {
    manifest: options.manifest,
    loader: options.loader,
  })

  // 4. 读取插件清单并装载默认插件集
  await plugins.loadManifest()
  await plugins.mountAll()

  // 5. 返回内核句柄
  ctx.logger.info(`[kernel] booted, ${plugins.getStatus().length} plugins active`)
  return { version, ctx, plugins }
}
