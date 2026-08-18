/**
 * @xyq-box/plugin-shell-web —— Vite 配置
 *
 * - react 插件：JSX 编译与 react-refresh HMR；
 * - xyqPlugins（本文件内）：读取 plugins.json，生成 `virtual:xyq-plugins` 模块
 *   （清单 + 插件名 → 动态 import 注册表），浏览器内核据此装载插件；
 * - 本地相对路径条目（./local-plugins/*）：configResolved 时注入 alias → 仓库内绝对路径；
 * - server.fs.allow 放开到 pnpm workspace 根，保证别名解析出的仓库内路径可访问。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

const VIRTUAL_ID = 'virtual:xyq-plugins'
// NUL 前缀（JS 转义写法，避免源文件出现真实 NUL 字节）防与真实路径撞名
const RESOLVED_VIRTUAL_ID = '\u0000' + VIRTUAL_ID

interface ManifestEntry {
  name: string
  config?: Record<string, unknown>
}

/** 读取并规范化 plugins.json（容错字符串条目） */
function readManifest(root: string, manifestFile: string): ManifestEntry[] {
  const manifestPath = resolve(root, manifestFile)
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    plugins?: (string | ManifestEntry)[]
  }
  return (raw.plugins ?? []).map((entry) => (typeof entry === 'string' ? { name: entry } : entry))
}

/** 生成虚拟模块：默认清单 + 插件名 → 动态 import 注册表 */
function xyqPlugins(manifestFile = 'plugins.json'): Plugin {
  let root = __dirname
  /** 清单中声明的插件名集合（resolveId 拦截用） */
  const pluginNames = new Set<string>()
  return {
    name: 'xyq-box:plugins',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
      const entries = readManifest(root, manifestFile)
      for (const entry of entries) {
        pluginNames.add(entry.name)
        // 为本地相对/绝对路径条目注入别名 → 仓库内绝对路径（Vite 可静态解析动态 import）
        if (entry.name.startsWith('.') || entry.name.startsWith('/')) {
          const aliases = config.resolve.alias
          if (Array.isArray(aliases)) {
            aliases.push({
              find: entry.name,
              replacement: resolve(root, entry.name).replace(/\\/g, '/'),
            })
          }
        }
      }
    },
    resolveId(id, importer) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
      // 虚拟模块内对清单插件名的导入：以 shell-web 包根为解析基座
      // （NUL 前缀虚拟 id 无真实路径，node 解析无法向上找 node_modules）
      if (importer === RESOLVED_VIRTUAL_ID && pluginNames.has(id)) {
        return this.resolve(id, resolve(root, 'index.html'), { skipSelf: true })
      }
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null
      const manifestPath = resolve(root, manifestFile)
      const entries = readManifest(root, manifestFile)
      const lines: string[] = []
      lines.push(`export const manifest = ${JSON.stringify({ plugins: entries })}`)
      lines.push('export const registry = {')
      for (const entry of entries) {
        lines.push(`  ${JSON.stringify(entry.name)}: () => import(${JSON.stringify(entry.name)}),`)
      }
      lines.push('}')
      lines.push('export function loadPlugin(name) {')
      lines.push('  const loader = registry[name]')
      lines.push("  if (!loader) throw new Error('plugin not in registry: ' + name)")
      lines.push('  return loader()')
      lines.push('}')
      // plugins.json 变更 → 触发该模块 HMR（main.ts 中 accept 后热重载插件）
      this.addWatchFile(manifestPath)
      return lines.join('\n')
    },
  }
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), xyqPlugins()],
  resolve: {
    // 相对路径插件别名由 xyqPlugins.configResolved 注入
    alias: [],
    dedupe: ['react', 'react-dom', 'cordis'],
  },
  server: {
    port: 5173,
    fs: {
      // 允许访问 pnpm workspace 根（本地插件别名解析需要）
      allow: [searchForWorkspaceRoot(__dirname)],
    },
  },
})
