/// <reference types="vite/client" />

/**
 * 由 vite.config.ts 的 xyqPlugins 插件生成的虚拟模块：
 * 提供默认插件清单（来自 plugins.json）与「插件名 → 动态 import」注册表。
 */
declare module 'virtual:xyq-plugins' {
  import type { PluginManifest } from '@xyq-box/core'

  /** 默认插件清单（plugins.json 的解析结果） */
  export const manifest: PluginManifest
  /** 插件名 → 动态加载器（npm 包名或本地相对路径） */
  export const registry: Record<string, () => Promise<Record<string, unknown>>>
  /** 按名加载插件模块（registry 的便捷封装） */
  export function loadPlugin(name: string): Promise<Record<string, unknown>>
}
