/**
 * @xyq-box/plugin-shell-desktop —— Electron 桌面壳插件（M2）
 *
 * 职责（docs/02 §1 与 docs/06 M2）：
 * 1. **system 服务**：Electron 能力代理（shell.openExternal / Notification /
 *    nativeTheme / screen / 窗口焦点与网络状态事件）；
 * 2. **window 服务**：BrowserWindow 管理（创建/状态/尺寸/标题/事件）；
 * 3. **tray 服务**：系统托盘管理（图标/提示/右键菜单/生命周期）；
 * 4. **connection 走 Electron IPC**：渲染进程经 preload 注入的 xyqBridge
 *    调用 ipcMain 桥 → 本内核 ctx.connection；主进程 push 事件经 relay 转发
 *    到渲染进程（docs/02 §3.1「传输实现可换」）；
 * 5. 暴露 '/shell-desktop' RPC 端点（system/window/tray 的可 JSON 化操作），
 *    渲染进程可直接经 IPC 调用（payload 无参数传 null，docs/04 §8）。
 *
 * 复用 shell-web 的 UI：插件本身不含渲染层；Electron 主进程
 * （src/main.ts）创建 BrowserWindow 加载 shell-web 的 Vite 产物/开发服务器，
 * 同一打包产物在桌面部署时自动切换 IPC 传输（见 shell-web src/web/main.ts）。
 *
 * 遵循 docs/03-插件规范.md：所有注册（服务/端点/IPC handler/推送 relay）
 * 均为 effect 语义，插件卸载自动清理。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import type { RpcResult } from '@xyq-box/core'

import { loadElectron, isElectronMain, type ElectronModule } from './electron-types.js'
import { IPC_CHANNEL_RPC_CALL, IPC_CHANNEL_PUSH } from './ipc.js'
import { DesktopSystemServiceImpl, type DesktopSystemService } from './services/system.js'
import { TrayServiceImpl, type TrayService } from './services/tray.js'
import { WindowServiceImpl, type WindowService } from './services/window.js'

// ─── 配置声明（schemastery DSL，docs/03 §5） ─────────────────────────────────

export interface Config {
  /** 窗口标题 */
  windowTitle: string
  /** 默认窗口宽度 */
  windowWidth: number
  /** 默认窗口高度 */
  windowHeight: number
}

export const Config = Schema.object({
  windowTitle: Schema.string().default('xyq-box').description('窗口标题'),
  windowWidth: Schema.natural().default(1200).description('默认窗口宽度'),
  windowHeight: Schema.natural().default(800).description('默认窗口高度'),
})

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-shell-desktop'
export const provide = ['system', 'window', 'tray']

export async function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('shell-desktop')
  logger.info('desktop shell plugin loaded, config=%j', config)

  // 非 Electron 主进程（单测 / CLI）时 loadElectron() 返回 null，服务降级但不崩溃
  const electron = await loadElectron()
  new DesktopSystemServiceImpl(ctx, electron)
  new WindowServiceImpl(ctx, electron)
  new TrayServiceImpl(ctx, electron)

  // '/shell-desktop' RPC 端点在任意环境注册（服务降级可用，供渲染进程经 IPC 调用）
  installShellRpc(ctx)

  if (electron && isElectronMain()) {
    installIpcBridge(ctx, electron)
    logger.info('Electron IPC bridge installed (%s / %s)', IPC_CHANNEL_RPC_CALL, IPC_CHANNEL_PUSH)
  } else {
    logger.warn('非 Electron 主进程：未安装 IPC 桥，仅提供 system/window/tray 服务（降级）')
  }

  // 兜底：Electron 就绪则应用默认窗口配置（若尚无窗口）
  if (electron && config.windowTitle) {
    ctx.window.setTitle(config.windowTitle)
  }
}

// ─── Electron IPC 桥（connection 走 Electron IPC，docs/02 §3.1） ──────────────

function installIpcBridge(ctx: Context, electron: ElectronModule): void {
  const { ipcMain, BrowserWindow } = electron
  const logger = ctx.logger('shell-desktop:ipc')

  interface RpcCallPayload {
    channel?: unknown
    endpoint?: unknown
    payload?: unknown
  }

  // 1. 渲染进程 RPC 调用 → 主进程内核 connection
  ctx.effect(() => {
    const handler = async (_event: unknown, raw: RpcCallPayload | undefined): Promise<RpcResult> => {
      if (
        !raw ||
        typeof raw.channel !== 'string' ||
        typeof raw.endpoint !== 'string' ||
        !('payload' in raw)
      ) {
        return { ok: false as const, error: 'invalid rpc payload (need channel/endpoint/payload)' }
      }
      // 复用内核 connection 的约定（payload 无参数传 null）
      return await ctx.connection.rpc.call(raw.channel, raw.endpoint, raw.payload)
    }
    ipcMain.handle(IPC_CHANNEL_RPC_CALL, handler)
    logger.info('ipcMain.handle(%s) registered', IPC_CHANNEL_RPC_CALL)
    return () => {
      ipcMain.removeHandler(IPC_CHANNEL_RPC_CALL)
      logger.info('ipcMain.handle(%s) removed', IPC_CHANNEL_RPC_CALL)
    }
  })

  // 2. 主进程 push → 渲染进程（core 的 push relay 钩子）
  ctx.effect(() => {
    const relay = (channel: string, event: string, payload: unknown) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNEL_PUSH, { channel, event, payload })
        }
      }
    }
    // onPushRelay 为 core ConnectionService 的可选能力（桌面传输用）
    return ctx.connection.onPushRelay?.(relay) ?? (() => {})
  })
}

// ─── '/shell-desktop' RPC 端点（system/window/tray 的可 JSON 化操作） ──────────

function installShellRpc(ctx: Context): void {
  const dispose = ctx.connection.rpc.handle(
    '/shell-desktop',
    async (endpoint: string, payload: unknown) => {
      const system = ctx.system as DesktopSystemService
      const windowService = ctx.window as WindowService
      const tray = ctx.tray as TrayService

      switch (endpoint) {
        case 'system.info':
          return {
            ok: true,
            value: {
              platform: system.platform,
              version: system.version,
              online: system.online,
              title: system.getTitle(),
              visibility: system.visibilityState,
            },
          }

        case 'system.setTitle': {
          const { title } = (payload ?? {}) as { title?: string }
          if (typeof title !== 'string') {
            return { ok: false, error: 'system.setTitle 需要 payload.title(string)' }
          }
          system.setTitle(title)
          return { ok: true, value: null }
        }

        case 'system.openUrl': {
          const { url } = (payload ?? {}) as { url?: string }
          if (typeof url !== 'string') {
            return { ok: false, error: 'system.openUrl 需要 payload.url(string)' }
          }
          system.openUrl(url)
          return { ok: true, value: null }
        }

        case 'window.list':
          return { ok: true, value: windowService.list() }

        case 'window.create': {
          const options = (payload ?? {}) as Record<string, unknown>
          const id = await windowService.create({
            width: typeof options.width === 'number' ? options.width : undefined,
            height: typeof options.height === 'number' ? options.height : undefined,
            title: typeof options.title === 'string' ? options.title : undefined,
            show: typeof options.show === 'boolean' ? options.show : undefined,
          })
          return { ok: true, value: { id } }
        }

        case 'window.setTitle': {
          const { title, id } = (payload ?? {}) as { title?: string; id?: number }
          if (typeof title !== 'string') {
            return { ok: false, error: 'window.setTitle 需要 payload.title(string)' }
          }
          windowService.setTitle(title, id)
          return { ok: true, value: null }
        }

        case 'tray.list':
          return { ok: true, value: tray.list() }

        case 'tray.create': {
          const options = (payload ?? {}) as {
            id?: string
            tooltip?: string
            title?: string
            contextMenu?: Array<{ label?: string; click?: never }>
            onClick?: never
          }
          // contextMenu/onClick 含函数，RPC 通道不可直接传输：仅支持可 JSON 化字段
          const handle = tray.create({
            id: options.id,
            tooltip: options.tooltip,
            title: options.title,
            contextMenu: options.contextMenu?.map((item) => ({ label: item.label })),
          })
          return { ok: true, value: { id: handle.id } }
        }

        case 'tray.destroy': {
          const { id } = (payload ?? {}) as { id?: string }
          if (!id) return { ok: false, error: 'tray.destroy 需要 payload.id(string)' }
          tray.destroy(id)
          return { ok: true, value: null }
        }

        default:
          return { ok: false, error: 'unknown endpoint: ' + endpoint }
      }
    },
    { authority: 'loopback' },
  )

  // effect 语义：插件卸载自动撤销端点
  ctx.effect(() => () => dispose())
}
