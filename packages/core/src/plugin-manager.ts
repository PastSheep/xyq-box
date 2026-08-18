/**
 * @xyq-box/core — 插件管理器
 *
 * 职责：插件清单加载、装载/卸载/热重载、fiber 状态诊断。
 * 实现 docs/02 §2 与 §7 的插件管理语义。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Context, Plugin } from 'cordis'

import type { PluginManifest, PluginManager, PluginStatus } from './types.js'
import { MANIFEST_FILE } from './types.js'

// FiberState const enum 值（cordis 4.0.0-rc.8），
// 因 verbatimModuleSyntax 不能直接使用 const enum 值
const PENDING = 0

/** 状态 → 可读标签 */
const STATE_LABELS: Record<number, string> = {
  [0]: 'PENDING',
  [1]: 'LOADING',
  [2]: 'ACTIVE',
  [3]: 'FAILED',
  [4]: 'DISPOSED',
  [5]: 'UNLOADING',
}

export function createPluginManager(ctx: Context, basePath: string): PluginManager {
  /** 已装载的插件名 → Fiber 映射（用于快速查找） */
  const mountedFibers = new Map<string, import('cordis').Fiber>()

  /** 清单缓存 */
  let manifest: PluginManifest | null = null

  const manager: PluginManager = {
    async loadManifest(): Promise<PluginManifest> {
      const manifestPath = resolve(basePath, MANIFEST_FILE)
      try {
        const content = await readFile(manifestPath, 'utf-8')
        manifest = JSON.parse(content) as PluginManifest
        // 兼容 list 格式（只含 name 字符串）和对象格式
        if (!Array.isArray(manifest.plugins)) {
          manifest.plugins = []
        }
        manifest.plugins = manifest.plugins.map((entry) => {
          if (typeof entry === 'string') return { name: entry }
          return entry
        }) as PluginManifest['plugins']
        return manifest
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          manifest = { plugins: [] }
          return manifest
        }
        throw error
      }
    },

    async mountAll(): Promise<void> {
      const m = manifest ?? await manager.loadManifest()
      for (const entry of m.plugins) {
        if (mountedFibers.has(entry.name)) continue
        try {
          await manager.mount(entry.name)
        } catch (error) {
          ctx.logger.warn(`[plugin-manager] failed to mount '${entry.name}':`, error)
        }
      }
    },

    async mount(name: string): Promise<import('cordis').Fiber> {
      if (mountedFibers.has(name)) {
        throw new Error(`plugin '${name}' is already mounted`)
      }

      // 查找清单中对应的配置
      const m = manifest ?? await manager.loadManifest()
      const entry = m.plugins.find((p) => p.name === name)
      const config = entry?.config ?? {}

      // 动态加载插件模块
      const pluginModule = await loadPluginModule(name, basePath)
      const plugin = resolvePluginExport(pluginModule)

      // 装载插件
      const fiber = await ctx.plugin(plugin, config)
      mountedFibers.set(name, fiber)
      ctx.logger.info(`[plugin-manager] mounted '${name}'`)
      return fiber
    },

    async unmount(name: string): Promise<void> {
      const fiber = mountedFibers.get(name)
      if (!fiber) {
        ctx.logger.warn(`[plugin-manager] '${name}' is not mounted, skipping unmount`)
        return
      }
      await fiber.dispose()
      mountedFibers.delete(name)
      ctx.logger.info(`[plugin-manager] unmounted '${name}'`)
    },

    async reload(name: string): Promise<void> {
      const fiber = mountedFibers.get(name)
      if (!fiber) {
        ctx.logger.warn(`[plugin-manager] '${name}' is not mounted, cannot reload`)
        return
      }
      // Cordis 的 restart 实现热重载（卸载→重新装载）
      ctx.logger.info(`[plugin-manager] reloading '${name}'`)
      await fiber.restart()
      ctx.logger.info(`[plugin-manager] reloaded '${name}'`)
    },

    getStatus(): PluginStatus[] {
      const statuses: PluginStatus[] = []

      // 通过 registry 遍历所有已注册的插件运行时
      ctx.registry.forEach((runtime) => {
        const name = runtime.name ?? 'unnamed'
        // 收集该运行时下所有 fiber 的状态
        for (const fiber of runtime.fibers) {
          const state = fiber.state
          const inject = fiber.inject ? Object.keys(fiber.inject as Record<string, unknown>) : []
          const provide = fiber.store ? Object.keys(fiber.store as Record<string, unknown>) : []

          statuses.push({
            name,
            state,
            stateLabel: STATE_LABELS[state] ?? 'UNKNOWN',
            error: fiber['_error'] instanceof Error ? fiber['_error'].message : undefined,
            inject,
            provide,
            waiting: state === PENDING && inject.length > 0,
          })
        }
      })

      return statuses
    },

    getPluginStatus(name: string): PluginStatus | undefined {
      return manager.getStatus().find((s) => s.name === name)
    },
  }

  return manager
}

// ─── 插件动态加载 ────────────────────────────────────────────────────────────

/**
 * 动态加载插件模块。
 * 支持 npm 包名（如 '@xyq-box/plugin-logger'）和相对路径（如 './local-plugins/my-thing'）。
 */
async function loadPluginModule(name: string, basePath: string): Promise<Record<string, unknown>> {
  if (name.startsWith('.') || name.startsWith('/')) {
    // 相对路径或绝对路径：从本地文件系统加载
    const resolvedPath = resolve(basePath, name)
    return await import(resolvedPath)
  } else {
    // npm 包名：直接动态 import
    return await import(name)
  }
}

/**
 * 从模块导出中解析插件入口。
 * 支持：
 * 1. 具名导出 `apply`（函数/对象形态）
 * 2. 默认导出
 * 3. 具名导出 `name` + `apply`
 */
function resolvePluginExport(module: Record<string, unknown>): Plugin {
  // 如果有默认导出，优先使用
  const defaultExport = module.default
  if (defaultExport && (typeof defaultExport === 'function' || typeof defaultExport === 'object')) {
    return defaultExport as Plugin
  }
  // 如果模块本身就是函数，直接使用
  if (typeof module === 'function') {
    return module as unknown as Plugin
  }
  // 如果模块有 apply，包装为插件对象
  if (module.apply && typeof module.apply === 'function') {
    return module as unknown as Plugin
  }
  // 否则尝试将整个模块视为插件对象
  return module as unknown as Plugin
}