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
  const { profile = 'default', basePath = process.cwd() } = options

  // 1. 创建 Cordis 根上下文
  const ctx = new Context()
  ctx.logger.info(`[kernel] booting xyq-box v${version} (profile: ${profile})`)

  // 2. 注册内置 service（connection 是内核与部署入口的通信契约，docs/04 §8）
  provideConnection(ctx)

  // 3. 创建插件管理器
  const plugins = createPluginManager(ctx, basePath)

  // 4. 读取插件清单并装载默认插件集
  await plugins.loadManifest()
  await plugins.mountAll()

  // 5. 返回内核句柄
  ctx.logger.info(`[kernel] booted, ${plugins.getStatus().length} plugins active`)
  return { version, ctx, plugins }
}