/**
 * @xyq-box/plugin-shell-web —— system 服务（浏览器能力代理）
 *
 * docs/02 §1：壳插件提供系统能力（system / window / tray / 文件系统）。
 * 本实现面向 Web 部署：把 window / document / navigator / notification 等浏览器能力
 * 以服务形式暴露给任意插件（ctx.system），并可在 M2 被 plugin-shell-desktop 的
 * 同名服务替换 —— 消费者零感知（docs/02 §2.3 服务替换）。
 *
 * 约定：
 * - 所有事件监听注册走 ctx.effect，插件卸载自动移除；
 * - 非浏览器环境（Node 单测）访问 window/document 等 getter 抛可读错误，
 *   能力探测（isSupported / notification.isSupported）返回 false 而非崩溃。
 */

import { Context, Service } from 'cordis'

/** 壳版本（与包版本同步维护） */
export const version = '0.1.0'

// ─── 类型契约 ───────────────────────────────────────────────────────────────

export type NotificationPermissionState = NotificationPermission

export interface SystemNotificationOptions {
  body?: string
  icon?: string
  tag?: string
  dir?: NotificationDirection
  lang?: string
  silent?: boolean
  requireInteraction?: boolean
  onClick?: (event: Event) => void
  onClose?: (event: Event) => void
}

/** system 服务契约（Web 实现；桌面壳以同名服务替换） */
export interface SystemService {
  /** 部署平台标识（web / desktop） */
  readonly platform: 'web'
  /** 壳版本 */
  readonly version: string

  // ── 浏览器对象代理（getter 保持实时引用） ──
  get window(): Window
  get document(): Document
  get navigator(): Navigator
  get location(): Location
  get history(): History
  get screen(): Screen
  get localStorage(): Storage | null
  get sessionStorage(): Storage | null

  // ── 环境状态 ──
  get visibilityState(): DocumentVisibilityState
  get online(): boolean

  // ── 事件订阅（effect 语义） ──
  onVisibilityChange(handler: (state: DocumentVisibilityState) => void): () => void
  onOnlineChange(handler: (online: boolean) => void): () => void
  onResize(handler: () => void): () => void
  onKeyDown(handler: (event: KeyboardEvent) => void): () => void
  onBeforeUnload(handler: (event: BeforeUnloadEvent) => void): () => void

  // ── 操作 ──
  setTitle(title: string): void
  getTitle(): string
  openUrl(url: string, target?: string): void
  reload(): void

  // ── 通知（浏览器 Notification API 封装） ──
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

// ─── 实现 ────────────────────────────────────────────────────────────────────

export class SystemServiceImpl extends Service implements SystemService {
  readonly platform = 'web' as const
  readonly version = version

  private visibilityHandlers = new Set<(state: DocumentVisibilityState) => void>()
  private onlineHandlers = new Set<(online: boolean) => void>()
  private resizeHandlers = new Set<() => void>()
  private keydownHandlers = new Set<(event: KeyboardEvent) => void>()
  private beforeUnloadHandlers = new Set<(event: BeforeUnloadEvent) => void>()

  constructor(ctx: Context) {
    super(ctx, 'system')
    ctx.logger('system').info('system service created (platform: web)')

    // 事件监听全部走 effect：插件卸载自动移除（docs/03 §3.1）
    ctx.effect(() => {
      const target = typeof window !== 'undefined' ? window : undefined
      const doc = typeof document !== 'undefined' ? document : undefined
      if (!target && !doc) return () => {}

      const onVisibility = () => {
        const state = doc ? doc.visibilityState : 'visible'
        for (const handler of this.visibilityHandlers) handler(state)
      }
      const onOnline = () => {
        const online = target ? target.navigator.onLine : true
        for (const handler of this.onlineHandlers) handler(online)
      }
      const onResize = () => {
        for (const handler of this.resizeHandlers) handler()
      }
      const onKeyDown = (event: Event) => {
        for (const handler of this.keydownHandlers) handler(event as KeyboardEvent)
      }
      const onBeforeUnload = (event: Event) => {
        for (const handler of this.beforeUnloadHandlers) handler(event as BeforeUnloadEvent)
      }

      doc?.addEventListener('visibilitychange', onVisibility)
      target?.addEventListener('online', onOnline)
      target?.addEventListener('offline', onOnline)
      target?.addEventListener('resize', onResize)
      doc?.addEventListener('keydown', onKeyDown)
      target?.addEventListener('beforeunload', onBeforeUnload)

      return () => {
        doc?.removeEventListener('visibilitychange', onVisibility)
        target?.removeEventListener('online', onOnline)
        target?.removeEventListener('offline', onOnline)
        target?.removeEventListener('resize', onResize)
        doc?.removeEventListener('keydown', onKeyDown)
        target?.removeEventListener('beforeunload', onBeforeUnload)
      }
    })
  }

  // ── 浏览器对象代理 ──

  get window(): Window {
    if (typeof window === 'undefined') {
      throw new Error('system.window 仅浏览器环境可用（当前非 Web 部署）')
    }
    return window
  }

  get document(): Document {
    if (typeof document === 'undefined') {
      throw new Error('system.document 仅浏览器环境可用（当前非 Web 部署）')
    }
    return document
  }

  get navigator(): Navigator {
    if (typeof navigator === 'undefined') {
      throw new Error('system.navigator 仅浏览器环境可用（当前非 Web 部署）')
    }
    return navigator
  }

  get location(): Location {
    if (typeof window === 'undefined') {
      throw new Error('system.location 仅浏览器环境可用（当前非 Web 部署）')
    }
    return window.location
  }

  get history(): History {
    if (typeof window === 'undefined') {
      throw new Error('system.history 仅浏览器环境可用（当前非 Web 部署）')
    }
    return window.history
  }

  get screen(): Screen {
    if (typeof window === 'undefined') {
      throw new Error('system.screen 仅浏览器环境可用（当前非 Web 部署）')
    }
    return window.screen
  }

  get localStorage(): Storage | null {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null
    return window.localStorage
  }

  get sessionStorage(): Storage | null {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return null
    return window.sessionStorage
  }

  // ── 环境状态 ──

  get visibilityState(): DocumentVisibilityState {
    if (typeof document === 'undefined') return 'visible'
    return document.visibilityState
  }

  get online(): boolean {
    if (typeof navigator === 'undefined') return false
    return navigator.onLine
  }

  // ── 事件订阅 ──

  onVisibilityChange(handler: (state: DocumentVisibilityState) => void): () => void {
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

  onKeyDown(handler: (event: KeyboardEvent) => void): () => void {
    this.keydownHandlers.add(handler)
    return () => {
      this.keydownHandlers.delete(handler)
    }
  }

  onBeforeUnload(handler: (event: BeforeUnloadEvent) => void): () => void {
    this.beforeUnloadHandlers.add(handler)
    return () => {
      this.beforeUnloadHandlers.delete(handler)
    }
  }

  // ── 操作 ──

  setTitle(title: string): void {
    if (typeof document !== 'undefined') document.title = title
  }

  getTitle(): string {
    if (typeof document === 'undefined') return ''
    return document.title
  }

  openUrl(url: string, target = '_blank'): void {
    if (typeof window === 'undefined') return
    window.open(url, target, 'noopener,noreferrer')
  }

  reload(): void {
    if (typeof window !== 'undefined') window.location.reload()
  }

  // ── 通知 ──

  notification = {
    isSupported: (): boolean => typeof Notification !== 'undefined',

    getPermission: (): NotificationPermissionState => {
      if (typeof Notification === 'undefined') return 'denied'
      return Notification.permission
    },

    requestPermission: async (): Promise<NotificationPermissionState> => {
      if (
        typeof Notification === 'undefined' ||
        typeof Notification.requestPermission !== 'function'
      ) {
        return 'denied'
      }
      try {
        return await Notification.requestPermission()
      } catch {
        return 'denied'
      }
    },

    notify: (title: string, options?: SystemNotificationOptions): boolean => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return false
      }
      try {
        const notification = new Notification(title, {
          body: options?.body,
          icon: options?.icon,
          tag: options?.tag,
          dir: options?.dir,
          lang: options?.lang,
          silent: options?.silent,
          requireInteraction: options?.requireInteraction,
        })
        if (options?.onClick) notification.addEventListener('click', options.onClick)
        if (options?.onClose) notification.addEventListener('close', options.onClose)
        return true
      } catch {
        return false
      }
    },
  }

  // ── 能力探测 ──

  isTouchDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    return navigator.maxTouchPoints > 0
  }

  prefersColorScheme(): 'light' | 'dark' {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  devicePixelRatio(): number {
    if (typeof window === 'undefined' || typeof window.devicePixelRatio !== 'number') return 1
    return window.devicePixelRatio
  }
}

// ─── 类型声明合并（docs/03 §4：服务名扁平命名空间） ───────────────────────────

declare module 'cordis' {
  interface Context {
    system: SystemService
  }
}
