/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @xyq-box/plugin-shell-desktop —— 服务单元测试
 *
 * 在非 Electron 环境（vitest）下验证各服务的降级行为与接口契约。
 * 需要 mock electron 模块验证 Electron 全功能路径。
 */

import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopSystemServiceImpl } from '../src/services/system.js'
import { WindowServiceImpl } from '../src/services/window.js'
import { TrayServiceImpl } from '../src/services/tray.js'

// ─── 桩 ────────────────────────────────────────────────────────────────────

function createFakeElectron() {
  const eventListeners = new Map<string, Set<() => void>>()
  const on = vi.fn((event: string, handler: () => void) => {
    let set = eventListeners.get(event)
    if (!set) {
      set = new Set()
      eventListeners.set(event, set)
    }
    set.add(handler)
    return () => set?.delete(handler)
  })
  const off = vi.fn((event: string, handler: () => void) => {
    eventListeners.get(event)?.delete(handler)
  })

  const fakeApp = {
    on: vi.fn((event: string, handler: () => void) => on(event, handler)),
    off: vi.fn((event: string, handler: () => void) => off(event, handler)),
  }

  const fakeBrowserWindow = {
    id: 1,
    _title: 'test',
    _bounds: { x: 0, y: 0, width: 1024, height: 768 },
    _visible: true,
    _focused: true,
    _minimized: false,
    _maximized: false,
    _fullScreen: false,
    _url: 'about:blank',
    _destroyed: false,
    listeners: new Map<string, Set<() => void>>(),
    emit(event: string) {
      const set = this.listeners.get(event)
      if (!set) return
      for (const handler of [...set]) handler()
    },
    on(event: string, handler: () => void) {
      let set = this.listeners.get(event)
      if (!set) {
        set = new Set()
        this.listeners.set(event, set)
      }
      set.add(handler)
    },
    off(event: string, handler: () => void) {
      this.listeners.get(event)?.delete(handler)
    },
    getTitle: vi.fn(function () { return this._title }),
    setTitle: vi.fn(function (t: string) { this._title = t }),
    getBounds: vi.fn(function () { return { ...this._bounds } }),
    setBounds: vi.fn(function (b: { x?: number; y?: number; width?: number; height?: number }) {
      Object.assign(this._bounds, b)
    }),
    isVisible: vi.fn(function () { return this._visible }),
    isFocused: vi.fn(function () { return this._focused }),
    isMinimized: vi.fn(function () { return this._minimized }),
    isMaximized: vi.fn(function () { return this._maximized }),
    isFullScreen: vi.fn(function () { return this._fullScreen }),
    isDestroyed: vi.fn(function () { return this._destroyed }),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(function () {
      this._destroyed = true
      this.emit('closed')
    }),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    restore: vi.fn(),
    focus: vi.fn(),
    setFullScreen: vi.fn(function (v: boolean) { this._fullScreen = v }),
    loadURL: vi.fn(),
    webContents: {
      reload: vi.fn(),
      getURL: vi.fn(function () { return this._url }),
      _url: 'about:blank',
    },
  }

  const fakeBrowserWindowClass = vi.fn(function (opts: Record<string, unknown>) {
    // 返回一个 fake window 实例
    return Object.assign(Object.create(fakeBrowserWindow), {
      _title: (opts as any).title ?? 'xyq-box',
      _bounds: { x: 0, y: 0, width: (opts as any).width ?? 1024, height: (opts as any).height ?? 768 },
    })
  }) as unknown as typeof Electron.BrowserWindow
  fakeBrowserWindowClass.getAllWindows = vi.fn(() => [fakeBrowserWindow])
  fakeBrowserWindowClass.getFocusedWindow = vi.fn(() => fakeBrowserWindow)

  // 桩 window 引用
  const fakeWindowInstance = Object.assign(Object.create(fakeBrowserWindow), {
    _title: 'xyq-box',
    _bounds: { x: 0, y: 0, width: 1200, height: 800 },
  }) as any

  const fakeTray = vi.fn(function (icon: unknown) {
    return {
      _icon: icon,
      _tooltip: '',
      _title: '',
      _menu: null,
      _destroyed: false,
      setToolTip: vi.fn(function (t: string) { this._tooltip = t }),
      setTitle: vi.fn(function (t: string) { this._title = t }),
      setContextMenu: vi.fn(function (m: unknown) { this._menu = m }),
      destroy: vi.fn(function () { this._destroyed = true }),
      on: vi.fn(),
      off: vi.fn(),
    }
  })

  const fakeNativeImage = {
    createFromDataURL: vi.fn(() => ({ _dataURL: '' })),
  } as any

  const fakeMenu = {
    buildFromTemplate: vi.fn((template: unknown) => template),
  } as any

  const fakeShell = {
    openExternal: vi.fn(),
  } as any

  const fakeNet = {
    isOnline: vi.fn(() => true),
  } as any

  const fakeNotification = vi.fn(function (opts: Record<string, unknown>) {
    return {
      _opts: opts,
      _listeners: new Map<string, Set<() => void>>(),
      on(event: string, handler: () => void) {
        let set = this._listeners.get(event)
        if (!set) {
          set = new Set()
          this._listeners.set(event, set)
        }
        set.add(handler)
      },
      off(event: string, handler: () => void) {
        this._listeners.get(event)?.delete(handler)
      },
      show: vi.fn(),
    }
  }) as any

  const fakeNativeTheme = {
    shouldUseDarkColors: false,
  } as any

  const fakeScreen = {
    getPrimaryDisplay: vi.fn(() => ({ scaleFactor: 2 })),
  } as any

  return {
    app: fakeApp,
    BrowserWindow: fakeBrowserWindowClass as any,
    Tray: fakeTray as any,
    nativeImage: fakeNativeImage,
    Menu: fakeMenu,
    shell: fakeShell,
    net: fakeNet as any,
    Notification: fakeNotification,
    nativeTheme: fakeNativeTheme,
    screen: fakeScreen,
    // helpers for tests
    _eventListeners: eventListeners,
    _window: fakeWindowInstance,
  }
}

// ─── DesktopSystemService ───────────────────────────────────────────────────

describe('DesktopSystemService', () => {
  let ctx: Context
  let fakeElectron: ReturnType<typeof createFakeElectron>

  beforeEach(() => {
    ctx = new Context()
    fakeElectron = createFakeElectron()
  })

  afterEach(() => {
    ctx.registry.forEach((r) => {
      for (const fiber of r.fibers) fiber.dispose()
    })
  })

  it('在无 electron 时降级创建，不崩溃', () => {
    new DesktopSystemServiceImpl(ctx, null)
    expect(ctx.system.platform).toBe('desktop')
    expect(ctx.system.online).toBe(true)
    expect(() => ctx.system.window).toThrow()
    expect(ctx.system.notification.isSupported()).toBe(true)
    // 降级：getPermission 返回 granted，但 notify 返回 false
    expect(ctx.system.notification.notify('test')).toBe(false)
  })

  it('有 electron 时：openUrl 调用 shell.openExternal', () => {
    new DesktopSystemServiceImpl(ctx, fakeElectron as any)
    ctx.system.openUrl('https://example.com')
    expect(fakeElectron.shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('有 electron 时：setTitle/getTitle 经聚焦窗口', () => {
    new DesktopSystemServiceImpl(ctx, fakeElectron as any)
    ctx.system.setTitle('新标题')
    expect(fakeElectron._window.setTitle).toHaveBeenCalledWith('新标题')
    expect(ctx.system.getTitle()).toBe('新标题')
  })

  it('有 electron 时：notify 创建 Electron Notification', () => {
    new DesktopSystemServiceImpl(ctx, fakeElectron as any)
    const result = ctx.system.notification.notify('通知', { body: '内容' })
    expect(result).toBe(true)
    expect(fakeElectron.Notification).toHaveBeenCalled()
  })

  it('有 electron 时：prefersColorScheme 返回 dark/light', () => {
    new DesktopSystemServiceImpl(ctx, fakeElectron as any)
    expect(ctx.system.prefersColorScheme()).toBe('light')
    fakeElectron.nativeTheme.shouldUseDarkColors = true
    expect(ctx.system.prefersColorScheme()).toBe('dark')
  })

  it('有 electron 时：devicePixelRatio 返回屏幕倍率', () => {
    new DesktopSystemServiceImpl(ctx, fakeElectron as any)
    expect(ctx.system.devicePixelRatio()).toBe(2)
  })

  it('有 electron 时：onVisibilityChange 订阅窗口焦点事件', () => {
    new DesktopSystemServiceImpl(ctx, fakeElectron as any)
    const states: string[] = []
    ctx.system.onVisibilityChange((state) => states.push(state))
    // 触发 app 事件
    fakeElectron.app.on.mock.calls.forEach(([event, handler]: [string, () => void]) => {
      if (event === 'browser-window-focus') handler()
      if (event === 'browser-window-blur') handler()
    })
    expect(states).toContain('visible')
    expect(states).toContain('hidden')
  })
})

// ─── WindowService ─────────────────────────────────────────────────────────

describe('WindowServiceImpl', () => {
  let ctx: Context
  let fakeElectron: ReturnType<typeof createFakeElectron>

  beforeEach(() => {
    ctx = new Context()
    fakeElectron = createFakeElectron()
  })

  afterEach(() => {
    ctx.registry.forEach((r) => {
      for (const fiber of r.fibers) fiber.dispose()
    })
  })

  it('在无 electron 时降级创建，create 抛可读错误', async () => {
    new WindowServiceImpl(ctx, null)
    expect(ctx.window).toBeDefined()
    await expect(ctx.window.create()).rejects.toThrow('需要 Electron 主进程')
  })

  it('有 electron 时：create 返回窗口 id', async () => {
    new WindowServiceImpl(ctx, fakeElectron as any)
    const id = await ctx.window.create({ title: 'test' })
    expect(typeof id).toBe('number')
    expect(ctx.window.get(id)).toBeDefined()
  })

  it('有 electron 时：setTitle 设置窗口标题', async () => {
    new WindowServiceImpl(ctx, fakeElectron as any)
    const id = await ctx.window.create({ title: 'test' })
    ctx.window.setTitle('新标题', id)
    expect(ctx.window.get(id)?.title).toBe('新标题')
  })

  it('有 electron 时：close 移除窗口', async () => {
    new WindowServiceImpl(ctx, fakeElectron as any)
    const id = await ctx.window.create()
    ctx.window.close(id)
    expect(ctx.window.get(id)).toBeUndefined()
  })

  it('有 electron 时：list 返回所有窗口快照', async () => {
    new WindowServiceImpl(ctx, fakeElectron as any)
    await ctx.window.create()
    await ctx.window.create()
    const list = ctx.window.list()
    expect(list.length).toBe(2)
  })
})

// ─── TrayService ───────────────────────────────────────────────────────────

describe('TrayServiceImpl', () => {
  let ctx: Context
  let fakeElectron: ReturnType<typeof createFakeElectron>

  beforeEach(() => {
    ctx = new Context()
    fakeElectron = createFakeElectron()
  })

  afterEach(() => {
    ctx.registry.forEach((r) => {
      for (const fiber of r.fibers) fiber.dispose()
    })
  })

  it('在无 electron 时降级，create 抛可读错误', () => {
    new TrayServiceImpl(ctx, null)
    expect(() => ctx.tray.create()).toThrow('需要 Electron 主进程')
  })

  it('有 electron 时：create 返回 handle', () => {
    new TrayServiceImpl(ctx, fakeElectron as any)
    const handle = ctx.tray.create({ tooltip: 'test' })
    expect(handle.id).toBeTruthy()
    expect(ctx.tray.list()).toContain(handle.id)
  })

  it('有 electron 时：destroy 移除托盘', () => {
    new TrayServiceImpl(ctx, fakeElectron as any)
    const handle = ctx.tray.create()
    ctx.tray.destroy(handle.id)
    expect(ctx.tray.list()).not.toContain(handle.id)
  })

  it('有 electron 时：destroyAll 清理全部', () => {
    new TrayServiceImpl(ctx, fakeElectron as any)
    ctx.tray.create()
    ctx.tray.create()
    ctx.tray.destroyAll()
    expect(ctx.tray.list()).toHaveLength(0)
  })
})
