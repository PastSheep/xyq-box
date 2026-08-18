/**
 * @xyq-box/plugin-shell-desktop —— Electron 模块类型 helper
 *
 * 统一以「类型导入 + 惰性加载」方式使用 electron：
 * - 类型侧：一整份 ElectronModule（typeof import('electron')），供给各服务构造器注入；
 * - 运行时侧：仅 Electron 主进程可加载（loadElectron 守卫 process.type），
 *   普通 Node（vitest / CLI）拿到 null 并降级，不炸模块顶层。
 */

/** 一整份 electron 模块（类型只会被 import type 擦除，无运行时开销） */
export type ElectronModule = typeof import('electron')

/** 惰性加载 electron（仅 Electron 主进程有效；其余环境返回 null） */
export async function loadElectron(): Promise<ElectronModule | null> {
  // 主进程标识：Electron 主进程为 'browser'；渲染进程 'renderer'；普通 Node 为 undefined
  if (typeof process === 'undefined' || process.type !== 'browser') {
    return null
  }
  try {
    const mod = await import('electron')
    // 确认拿到的是真实 electron 模块（有 app/BrowserWindow 等），而非路径字符串
    if (typeof mod.app !== 'undefined' && typeof mod.BrowserWindow !== 'undefined') {
      return mod as ElectronModule
    }
    return null
  } catch {
    return null
  }
}

/** 检查 electron 是否就绪（进程级守卫，渲染进程/普通 Node 视为不可用） */
export function isElectronMain(): boolean {
  return typeof process !== 'undefined' && process.type === 'browser'
}
