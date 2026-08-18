/**
 * @xyq-box/plugin-shell-web —— Vite 部署入口
 *
 * 职责（docs/02 §1「部署入口」）：仅调用 kernel.bootstrap() 启动内核，
 * 加载默认插件清单（plugins.json，经虚拟模块打包进产物），并把内核句柄
 * 暴露到 window 供诊断。不含任何业务与壳逻辑 —— 壳是插件，由清单装载。
 *
 * 内核 HMR：plugins.json 变更 → 热重载全部已装载插件；
 * 插件代码变更 → Vite 动态 import 更新，经重载拾取新模块（未 accept 的模块整页刷新）。
 */

import { bootstrap, type KernelHandle } from '@xyq-box/core'
import { manifest, registry } from 'virtual:xyq-plugins'

import '../ui/shell.css'

declare global {
  interface Window {
    /** 内核句柄（诊断/调试用） */
    __xyqKernel?: KernelHandle
  }
}

/** 插件模块加载器：由 Vite 生成的注册表驱动（支持 npm 包名与本地相对路径别名） */
async function loadPluginModule(name: string): Promise<Record<string, unknown>> {
  const loader = registry[name]
  if (!loader) {
    throw new Error(
      `[xyq] 插件 '${name}' 不在 Vite 注册表中（检查 plugins.json 与 shell-web 的依赖声明）`,
    )
  }
  return await loader()
}

async function boot(): Promise<void> {
  const kernel = await bootstrap({
    basePath: import.meta.env.BASE_URL,
    manifest,
    loader: loadPluginModule,
  })
  window.__xyqKernel = kernel
  console.info(
    `[xyq] kernel v${kernel.version} booted, ${kernel.plugins.getStatus().length} plugin(s)`,
  )
}

boot().catch((error: unknown) => {
  console.error('[xyq] kernel bootstrap failed', error)
  const mount = document.getElementById('root')
  if (mount) {
    mount.innerHTML =
      '<div style="padding:24px;font-family:system-ui,sans-serif"><h2>xyq-box 内核启动失败</h2>' +
      '<pre style="white-space:pre-wrap">' +
      String(error) +
      '</pre></div>'
  }
})

// 内核 HMR：plugins.json 变更（Vite 插件 addWatchFile 触发）→ 热重载全部插件
if (import.meta.hot) {
  import.meta.hot.accept('virtual:xyq-plugins', async () => {
    const kernel = window.__xyqKernel
    if (!kernel) return
    console.info('[xyq] plugins.json 变更，热重载全部已装载插件…')
    const names = kernel.plugins.getStatus().map((status) => status.name)
    for (const name of names) {
      try {
        await kernel.plugins.reload(name)
      } catch (error) {
        console.warn(`[xyq] 插件 '${name}' 热重载失败`, error)
      }
    }
  })
}
