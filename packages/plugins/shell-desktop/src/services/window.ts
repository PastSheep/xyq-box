/**
 * @xyq-box/plugin-shell-desktop —— WindowService（BrowserWindow 管理）
 *
 * docs/02 §1 壳系统能力之一：窗口服务。以服务形式暴露给任意插件
 * （ctx.window），窗口生命周期/状态查询/尺寸与标题控制。
 *
 * 设计：
 * - 服务自身可被替换（docs/02 §2.3）：第三方壳可换实现；
 * - 事件监听全部经 ctx.effect 注册（构造器内一次注册，卸载批量清理）；
 * - 非 Electron 环境（单元测试 / CLI）降级：create 等操作抛可读错误。
 */

import { Context, Service } from 'cordis'
import type { BrowserWindow } from 'electron'

import type { ElectronModule } from '../electron-types.js'

// ─── 类型契约 ───────────────────────────────────────────────────────────────

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  id: number
  title: string
  bounds: WindowBounds
  visible: boolean
  focused: boolean
  minimized: boolean
  maximized: boolean
  fullScreen: boolean
  url: string
}

export interface WindowOptions {
  width?: number
  height?: number
  x?: number
  y?: number
  title?: string
  show?: boolean
  backgroundColor?: string
  /** 附加 webPreferences（preload / contextIsolation 等由 Electron main 入口负责） */
  webPreferences?: Record<string, unknown>
}

export type WindowEvent =
  | 'created'
  | 'closed'
  | 'focus'
  | 'blur'
  | 'resize'
  | 'maximize'
  | 'unmaximize'

export interface WindowService {
  /** 创建窗口，返回窗口 id */
  create(options?: WindowOptions): Promise<number>
  /** 窗口状态快照（id 缺省 = 焦点窗口或首个窗口） */
  get(id?: number): WindowState | undefined
  /** 全部窗口状态快照 */
  list(): WindowState[]
  show(id?: number): void
  hide(id?: number): void
  close(id?: number): void
  minimize(id?: number): void
  maximize(id?: number): void
  unmaximize(id?: number): void
  restore(id?: number): void
  focus(id?: number): void
  setTitle(title: string, id?: number): void
  setBounds(bounds: Partial<WindowBounds>, id?: number): void
  setFullScreen(fullScreen: boolean, id?: number): void
  reload(id?: number): void
  loadURL(url: string, id?: number): void
  getWindow(id?: number): BrowserWindow | undefined
  /** 事件订阅（effect 语义，返回退订） */
  on(event: WindowEvent, handler: (id: number) => void): () => void
}

// ─── 实现 ──────────────────────────────────────────────────────────────────

interface WindowEntry {
  id: number
  win: BrowserWindow
  events: Map<string, () => void>
}

export class WindowServiceImpl extends Service implements WindowService {
  private entries = new Map<number, WindowEntry>()
  private listeners = new Map<WindowEvent, Set<(id: number) => void>>()
  private cleanups = new Set<() => void>()
  private electron: ElectronModule | null
  private logger: ReturnType<Context['logger']>
  private nextId = 1

  constructor(ctx: Context, electron: ElectronModule | null) {
    super(ctx, 'window')
    this.logger = ctx.logger('window:desktop')
    this.electron = electron
    if (!electron) {
      this.logger.warn('Electron 模块不可用，window 服务降级（无窗口）')
    } else {
      this.logger.info('window service created (Electron)')
      // 服务卸载时批量清理全部窗口事件监听（effect 语义）
      ctx.effect(() => {
        return () => {
          for (const cleanup of this.cleanups) {
            cleanup()
          }
          this.cleanups.clear()
          this.entries.clear()
        }
      })
    }
  }

  private requireElectron(): ElectronModule {
    if (!this.electron) {
      throw new Error('window 服务需要 Electron 主进程（当前环境无 electron）')
    }
    return this.electron
  }

  private emit(event: WindowEvent, id: number): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const handler of [...set]) handler(id)
  }

  private snapshot(entry: WindowEntry): WindowState {
    const bounds = entry.win.getBounds()
    return {
      id: entry.id,
      title: entry.win.getTitle(),
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      visible: entry.win.isVisible(),
      focused: entry.win.isFocused(),
      minimized: entry.win.isMinimized(),
      maximized: entry.win.isMaximized(),
      fullScreen: entry.win.isFullScreen(),
      url: entry.win.webContents.getURL(),
    }
  }

  private track(win: BrowserWindow, id: number): void {
    const entry: WindowEntry = { id, win, events: new Map() }
    this.entries.set(id, entry)

    const wire = (event: string, handler: () => void) => {
      ;(win as unknown as { on(e: string, h: () => void): void; off(e: string, h: () => void): void }).on(event, handler)
      entry.events.set(event, handler)
      this.cleanups.add(() => {
        ;(win as unknown as { on(e: string, h: () => void): void; off(e: string, h: () => void): void }).off(event, handler)
      })
    }

    wire('closed', () => {
      this.entries.delete(id)
      this.emit('closed', id)
    })
    wire('focus', () => this.emit('focus', id))
    wire('blur', () => this.emit('blur', id))
    wire('resize', () => this.emit('resize', id))
    wire('maximize', () => this.emit('maximize', id))
    wire('unmaximize', () => this.emit('unmaximize', id))
  }

  private pick(id?: number): WindowEntry | undefined {
    if (id !== undefined) return this.entries.get(id)
    const electron = this.requireElectron()
    const focused = electron.BrowserWindow.getFocusedWindow()
    if (focused) {
      for (const entry of this.entries.values()) {
        if (entry.win === focused) return entry
      }
    }
    return this.entries.values().next().value
  }

  async create(options: WindowOptions = {}): Promise<number> {
    const electron = this.requireElectron()
    const win = new electron.BrowserWindow({
      width: options.width ?? 1024,
      height: options.height ?? 768,
      x: options.x,
      y: options.y,
      title: options.title ?? 'xyq-box',
      show: options.show ?? true,
      backgroundColor: options.backgroundColor ?? '#1e1e2e',
      webPreferences: options.webPreferences,
    })
    const id = this.nextId++
    this.track(win, id)
    this.emit('created', id)
    this.logger.info('created window #%d', id)
    return id
  }

  get(id?: number): WindowState | undefined {
    const entry = this.pick(id)
    if (!entry) return undefined
    return this.snapshot(entry)
  }

  list(): WindowState[] {
    return Array.from(this.entries.values()).map((entry) => this.snapshot(entry))
  }

  show(id?: number): void {
    this.pick(id)?.win.show()
  }

  hide(id?: number): void {
    this.pick(id)?.win.hide()
  }

  close(id?: number): void {
    this.pick(id)?.win.close()
  }

  minimize(id?: number): void {
    this.pick(id)?.win.minimize()
  }

  maximize(id?: number): void {
    this.pick(id)?.win.maximize()
  }

  unmaximize(id?: number): void {
    this.pick(id)?.win.unmaximize()
  }

  restore(id?: number): void {
    this.pick(id)?.win.restore()
  }

  focus(id?: number): void {
    this.pick(id)?.win.focus()
  }

  setTitle(title: string, id?: number): void {
    this.pick(id)?.win.setTitle(title)
  }

  setBounds(bounds: Partial<WindowBounds>, id?: number): void {
    const entry = this.pick(id)
    if (!entry) return
    const current = entry.win.getBounds()
    entry.win.setBounds({ ...current, ...bounds })
  }

  setFullScreen(fullScreen: boolean, id?: number): void {
    this.pick(id)?.win.setFullScreen(fullScreen)
  }

  reload(id?: number): void {
    this.pick(id)?.win.webContents.reload()
  }

  loadURL(url: string, id?: number): void {
    const entry = this.pick(id)
    if (entry) entry.win.loadURL(url)
  }

  getWindow(id?: number): BrowserWindow | undefined {
    return this.pick(id)?.win
  }

  on(event: WindowEvent, handler: (id: number) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
    return () => {
      set!.delete(handler)
      if (set!.size === 0) this.listeners.delete(event)
    }
  }
}

// ─── 类型声明合并 ──────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    window: WindowService
  }
}
