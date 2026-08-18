/**
 * @xyq-box/plugin-shell-desktop —— TrayService（Electron Tray 管理）
 *
 * docs/02 §1 壳系统能力之一：托盘服务。以服务形式暴露给任意插件
 * （ctx.tray）。
 *
 * 设计：
 * - 无桌面图标（Linux）或托盘不可用时降级记录警告；
 * - 使用最小 16x16 PNG 占位图标（内置 base64 data URL），插件可替换图标；
 * - 服务卸载时自动销毁所有托盘（effect 语义）。
 */

import { Context, Service } from 'cordis'
import type { MenuItemConstructorOptions, Tray } from 'electron'

import type { ElectronModule } from '../electron-types.js'

// ─── 类型契约 ───────────────────────────────────────────────────────────────

export interface TrayMenuTemplate {
  label?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  click?: () => void
  enabled?: boolean
  checked?: boolean
  submenu?: TrayMenuTemplate[]
}

export interface TrayOptions {
  id?: string
  /** 图标路径或 data URL（缺省用内置最小图标） */
  icon?: string
  tooltip?: string
  title?: string
  contextMenu?: TrayMenuTemplate[]
  onClick?: () => void
}

export interface TrayHandle {
  id: string
  setToolTip(tooltip: string): void
  setTitle(title: string): void
  setContextMenu(items: TrayMenuTemplate[]): void
  destroy(): void
}

export interface TrayService {
  /** 创建托盘，返回 TrayHandle */
  create(options?: TrayOptions): TrayHandle
  /** 列出所有创建的托盘 id */
  list(): string[]
  /** 销毁指定托盘 */
  destroy(id: string): void
  /** 销毁所有托盘 */
  destroyAll(): void
}

// ─── 内置最小图标（16x16 半透明 PNG，base64） ──────────────────────────────

const DEFAULT_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAuIwAALiMBeKU/dgAAAAd0SU1FB+cGAgcrA+YjUlEAAAAZdEVYdENvbW1lbnQAQ3JlYXRlZCB3aXRoIEdJTVBXgQ4XAAAAKklEQVQ4y2P4z8BQz0BpwEQNw0gN8c8IBgMVjLSIUY0Y1YhRjRjViFENBAMAIT4Ef2f1h7MAAAAASUVORK5CYII='

// ─── 实现 ──────────────────────────────────────────────────────────────────

interface TrayEntry {
  id: string
  tray: Tray
  handle: TrayHandle
}

export class TrayServiceImpl extends Service implements TrayService {
  private entries = new Map<string, TrayEntry>()
  private electron: ElectronModule | null
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context, electron: ElectronModule | null) {
    super(ctx, 'tray')
    this.logger = ctx.logger('tray:desktop')
    this.electron = electron
    if (!electron) {
      this.logger.warn('Electron 模块不可用，tray 服务降级（无托盘）')
    } else {
      this.logger.info('tray service created (Electron)')
      // 服务卸载时自动销毁所有托盘（effect 语义）
      ctx.effect(() => {
        return () => {
          this.destroyAll()
        }
      })
    }
  }

  private requireElectron(): ElectronModule {
    if (!this.electron) {
      throw new Error('tray 服务需要 Electron 主进程（当前环境无 electron）')
    }
    return this.electron
  }

  create(options: TrayOptions = {}): TrayHandle {
    const electron = this.requireElectron()
    const id = options.id ?? 'tray:' + String(Date.now())
    const icon = options.icon
      ? electron.nativeImage.createFromDataURL(options.icon)
      : electron.nativeImage.createFromDataURL(DEFAULT_ICON_DATA_URL)
    const tray = new electron.Tray(icon)
    if (options.tooltip) tray.setToolTip(options.tooltip)
    if (options.title) tray.setTitle(options.title)
    if (options.onClick) tray.on('click', options.onClick)
    if (options.contextMenu) {
      tray.setContextMenu(electron.Menu.buildFromTemplate(this.toMenuTemplate(options.contextMenu)))
    }

    const handle: TrayHandle = {
      id,
      setToolTip: (tooltip: string) => tray.setToolTip(tooltip),
      setTitle: (title: string) => tray.setTitle(title),
      setContextMenu: (items: TrayMenuTemplate[]) => {
        tray.setContextMenu(electron.Menu.buildFromTemplate(this.toMenuTemplate(items)))
      },
      destroy: () => {
        tray.destroy()
        this.entries.delete(id)
      },
    }

    this.entries.set(id, { id, tray, handle })
    this.logger.info('created tray "%s"', id)
    return handle
  }

  list(): string[] {
    return Array.from(this.entries.keys())
  }

  destroy(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.tray.destroy()
    this.entries.delete(id)
  }

  destroyAll(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.tray.destroy()
      } catch {
        // 忽略（可能已销毁）
      }
    }
    this.entries.clear()
  }

  private toMenuTemplate(
    items: TrayMenuTemplate[],
  ): MenuItemConstructorOptions[] {
    return items.map((item) => ({
      label: item.label,
      type: item.type ?? 'normal',
      click: item.click,
      enabled: item.enabled,
      checked: item.checked,
      submenu: item.submenu ? this.toMenuTemplate(item.submenu) : undefined,
    }))
  }
}

// ─── 类型声明合并 ──────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    tray: TrayService
  }
}
