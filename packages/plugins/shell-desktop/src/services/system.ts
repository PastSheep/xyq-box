/**
 * @xyq-box/plugin-shell-desktop —— DesktopSystemService（Electron 能力代理）
 *
 * 实现 docs/02 §1 壳系统能力，替换 shell-web 的 system 服务（浏览器能力代理），
 * 消费者零感知（docs/02 §2.3 服务替换）。
 *
 * 与 shell-web 的 SystemService 保持接口兼容：
 * - 浏览器对象 getter 在桌面主进程不可用，抛可读错误；
 * - 桌面特有能力（openUrl → shell.openExternal，通知 → Electron Notification，
 *   主题 → nativeTheme，缩放 → screen）纳入实现。
 */

import { Context, Service } from 'cordis'
import type { ElectronModule } from '../electron-types.js'

// ─── 类型契约 ───────────────────────────────────────────────────────────────

export type NotificationPermissionState = 'granted' | 'denied' | 'default'

export interface SystemNotificationOptions {
  body?: string
  icon?: string
  tag?: string
  silent?: boolean
  requireInteraction?: boolean
  onClick?: () => void
  onClose?: () => void
}

export interface DesktopSystemService {
  /** 部署平台标识 */
  readonly platform: 'desktop'
  /** 壳版本 */
  readonly version: string

  // ── 浏览器对象代理（桌面主进程不可用，抛可读错误） ──
  get window(): never
  get document(): never
  get navigator(): never
  get location(): never
  get history(): never
  get screen(): never
  get localStorage(): null
  get sessionStorage(): null

  // ── 环境状态 ──
  get visibilityState(): 'visible' | 'hidden'
  get online(): boolean

  // ── 事件订阅（effect 语义） ──
  onVisibilityChange(handler: (state: 'visible' | 'hidden') => void): () => void
  onOnlineChange(handler: (online: boolean) => void): () => void
  onResize(handler: () => void): () => void
  onKeyDown(handler: (event: unknown) => void): () => void
  onBeforeUnload(handler: (event: unknown) => void): () => void

  // ── 操作 ──
  setTitle(title: string): void
  getTitle(): string
  openUrl(url: string, target?: string): void
  reload(): void

  // ── 通知（Electron Notification API 封装） ──
  notification: {
    isSupported(): boolean
    getPermission(): NotificationPermissionState
    requestPermission(): Promise<NotificationPermissionState>
    notify(title: string, options?: SystemNotificationOptions): boolean
  }

  // ── 能力探测 ──
  isTouchDevice(): boolean
  prefersColorScheme(): 'light' | 'dark'
  devicePixelRatio(): number
}

// ─── 实现 ──────────────────────────────────────────────────────────────────

export class DesktopSystemServiceImpl extends Service implements DesktopSystemService {
  readonly platform = 'desktop' as const
  readonly version = '0.1.0'

  private visibilityHandlers = new Set<(state: 'visible' | 'hidden') => void>()
  private onlineHandlers = new Set<(online: boolean) => void>()
  private resizeHandlers = new Set<() => void>()
  private keydownHandlers = new Set<(event: unknown) => void>()
  private beforeUnloadHandlers = new Set<(event: unknown) => void>()
  private electron: ElectronModule | null
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context, electron: ElectronModule | null) {
    super(ctx, 'system')
    this.logger = ctx.logger('system:desktop')
    this.electron = electron
    this.logger.info('system service created (platform: desktop)')

    if (!electron) {
      this.logger.warn('Electron 模块不可用，system 服务能力降级')
      return
    }

    const { app, BrowserWindow } = electron

    // 窗口焦点变化 ↔ 可见性
    ctx.effect(() => {
      const onFocus = () => {
        for (const h of this.visibilityHandlers) h('visible')
      }
      const onBlur = () => {
        for (const h of this.visibilityHandlers) h('hidden')
      }
      app.on('browser-window-focus', onFocus)
      app.on('browser-window-blur', onBlur)
      return () => {
        app.off('browser-window-focus', onFocus)
        app.off('browser-window-blur', onBlur)
      }
    })

    // 网络状态变化（Electron app 支持 'online'/'offline' 事件，类型签名未包含）
    ctx.effect(() => {
      const onOnline = () => {
        for (const h of this.onlineHandlers) h(true)
      }
      const onOffline = () => {
        for (const h of this.onlineHandlers) h(false)
      }
      ;(app as unknown as { on(e: string, h: () => void): unknown; off(e: string, h: () => void): unknown }).on('online', onOnline)
      ;(app as unknown as { on(e: string, h: () => void): unknown; off(e: string, h: () => void): unknown }).on('offline', onOffline)
      return () => {
        ;(app as unknown as { on(e: string, h: () => void): unknown; off(e: string, h: () => void): unknown }).off('online', onOnline)
        ;(app as unknown as { on(e: string, h: () => void): unknown; off(e: string, h: () => void): unknown }).off('offline', onOffline)
      }
    })

    // 窗口尺寸变化（监听所有窗口，effect 语义卸载自动移除）
    ctx.effect(() => {
      const onResize = () => {
        for (const h of this.resizeHandlers) h()
      }
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) win.on('resize', onResize)
      return () => {
        for (const win of BrowserWindow.getAllWindows()) win.off('resize', onResize)
      }
    })
  }

  // ── 浏览器对象代理（主进程不可用） ──

  get window(): never {
    throw new Error('system.window 仅浏览器环境可用（当前为桌面主进程）')
  }
  get document(): never {
    throw new Error('system.document 仅浏览器环境可用（当前为桌面主进程）')
  }
  get navigator(): never {
    throw new Error('system.navigator 仅浏览器环境可用（当前为桌面主进程）')
  }
  get location(): never {
    throw new Error('system.location 仅浏览器环境可用（当前为桌面主进程）')
  }
  get history(): never {
    throw new Error('system.history 仅浏览器环境可用（当前为桌面主进程）')
  }
  get screen(): never {
    throw new Error('system.screen 仅浏览器环境可用（当前为桌面主进程）')
  }
  get localStorage(): null {
    return null
  }
  get sessionStorage(): null {
    return null
  }

  // ── 环境状态 ──

  get visibilityState(): 'visible' | 'hidden' {
    if (!this.electron) return 'visible'
    const win = this.electron.BrowserWindow.getFocusedWindow()
    return win ? 'visible' : 'hidden'
  }

  get online(): boolean {
    if (!this.electron) return true
    return this.electron.net.isOnline()
  }

  // ── 事件订阅 ──

  onVisibilityChange(handler: (state: 'visible' | 'hidden') => void): () => void {
    this.visibilityHandlers.add(handler)
    return () => {
      this.visibilityHandlers.delete(handler)
    }
  }
  onOnlineChange(handler: (online: boolean) => void): () => void {
    this.onlineHandlers.add(handler)
    return () => {
      this.onlineHandlers.delete(handler)
    }
  }
  onResize(handler: () => void): () => void {
    this.resizeHandlers.add(handler)
    return () => {
      this.resizeHandlers.delete(handler)
    }
  }
  onKeyDown(handler: (event: unknown) => void): () => void {
    this.keydownHandlers.add(handler)
    return () => {
      this.keydownHandlers.delete(handler)
    }
  }
  onBeforeUnload(handler: (event: unknown) => void): () => void {
    this.beforeUnloadHandlers.add(handler)
    return () => {
      this.beforeUnloadHandlers.delete(handler)
    }
  }

  // ── 操作 ──

  setTitle(title: string): void {
    if (!this.electron) return
    const win = this.electron.BrowserWindow.getFocusedWindow()
    if (win) win.setTitle(title)
  }

  getTitle(): string {
    if (!this.electron) return ''
    const win = this.electron.BrowserWindow.getFocusedWindow()
    return win ? win.getTitle() : ''
  }

  openUrl(url: string, _target?: string): void {
    if (!this.electron) return
    this.electron.shell.openExternal(url)
  }

  reload(): void {
    if (!this.electron) return
    const win = this.electron.BrowserWindow.getFocusedWindow()
    if (win) win.webContents.reload()
  }

  // ── 通知 ──

  notification = {
    isSupported: (): boolean => {
      return true
    },

    getPermission: (): NotificationPermissionState => {
      return 'granted'
    },

    requestPermission: async (): Promise<NotificationPermissionState> => {
      return 'granted'
    },

    notify: (title: string, options?: SystemNotificationOptions): boolean => {
      const electron = this.electron
      if (!electron) return false
      try {
        const notification = new electron.Notification({
          title,
          body: options?.body ?? '',
          icon: options?.icon,
          silent: options?.silent,
        })
        if (options?.onClick) notification.on('click', options.onClick as () => void)
        if (options?.onClose) notification.on('close', options.onClose as () => void)
        notification.show()
        return true
      } catch {
        return false
      }
    },
  }

  // ── 能力探测 ──

  isTouchDevice(): boolean {
    return false
  }

  prefersColorScheme(): 'light' | 'dark' {
    if (!this.electron) return 'light'
    return this.electron.nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  devicePixelRatio(): number {
    if (!this.electron) return 1
    return this.electron.screen.getPrimaryDisplay().scaleFactor
  }
}

// ─── 类型声明合并（docs/03 §4：服务名扁平命名空间） ───────────────────────────

declare module 'cordis' {
  interface Context {
    system: DesktopSystemService
  }
}
