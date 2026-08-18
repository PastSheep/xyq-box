/**
 * @xyq-box/plugin-commands —— 命令服务（M1）
 *
 * docs/04 §6 定义的 CommandsService 实现。
 * 提供 ctx.commands 服务：register / list / run + 快捷键分发。
 * 所有注册走 effect 语义，卸载自动清理（docs/03）。
 *
 * 约定：
 * - 快捷键冲突：后注册者生效 + 警告日志（docs/04 §6）；
 * - when() 在每次列出/执行时评估，false 的命令不出现在面板且 run() 拒绝执行；
 * - 命令面板（plugin-command-palette）是消费本服务的独立插件。
 */

import { Context, Service } from 'cordis'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 命令执行上下文（docs/04 §6：run(ctx: CommandContext)） */
export interface CommandContext {
  /** 触发命令的命令 id */
  id: string
  /** 内核上下文（可访问其他服务） */
  ctx: Context
  /** 命令服务自身（便于命令内联动） */
  commands: CommandsService
}

/** 命令描述符（docs/04 §6） */
export interface Command {
  /** 全局唯一 id（如 '@xyq-box/plugin-xxx/open-palette'） */
  id: string
  /** 显示标题 */
  title: string
  /** 快捷键（如 ['Ctrl+K', 'Ctrl+P']），后注册者覆盖冲突 */
  shortcut?: string[]
  /** 图标名 */
  icon?: string
  /** 执行函数（可异步） */
  run(ctx: CommandContext): void | Promise<void>
  /** 可用性条件（面板中灰显/隐藏，run() 拒绝执行） */
  when?: () => boolean
}

export interface CommandsService {
  /**
   * 注册命令（effect 语义）。
   * @returns 退订函数，调用后命令移除、快捷键释放
   */
  register(command: Command): () => void

  /** 列出所有可用命令（过滤 when() === false 的命令） */
  list(): Command[]

  /**
   * 执行命令。
   * @throws 命令不存在或 when() 不满足时拒绝执行
   */
  run(id: string): Promise<void>

  /** 订阅命令集合变更（event 语义，effect 返回退订） */
  onChange(listener: () => void): () => void
}

// ─── 快捷键解析 ───────────────────────────────────────────────────────────────

/** 解析 'Ctrl+K' / 'Ctrl+Shift+P' 等字符串为按键匹配器 */
function parseShortcut(shortcut: string): (event: KeyboardEvent) => boolean {
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase())
  const key = parts.pop() ?? ''
  const ctrl = parts.includes('ctrl') || parts.includes('control')
  const alt = parts.includes('alt')
  const shift = parts.includes('shift')
  const meta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
  return (event: KeyboardEvent) => {
    const actualKey = event.key.toLowerCase()
    return actualKey === key
      && event.ctrlKey === ctrl
      && event.altKey === alt
      && event.shiftKey === shift
      && event.metaKey === meta
  }
}

// ─── 实现 ────────────────────────────────────────────────────────────────────

export class CommandsServiceImpl extends Service implements CommandsService {
  /** id → 命令描述符（Map 保序） */
  private commandMap = new Map<string, Command>()
  /** 快捷键组合 → 当前生效的命令 id（后注册覆盖） */
  private shortcutMap = new Map<string, string>()
  /** 变更通知订阅者 */
  private listeners = new Set<() => void>()
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context) {
    super(ctx, 'commands')
    this.logger = ctx.logger('commands')

    // 全局键监听（effect 语义，卸载自动移除）
    const handleKeydown = (event: KeyboardEvent) => {
      const commandId = this.matchShortcut(event)
      if (!commandId) return
      event.preventDefault()
      event.stopPropagation()
      const command = this.commandMap.get(commandId)
      if (!command) return
      if (command.when && !command.when()) {
        this.logger.debug('shortcut %s -> command %s skipped (when=false)', event.key, command.id)
        return
      }
      void this.run(command.id).catch((error) => {
        this.logger.warn('shortcut %s -> command %s failed: %s', event.key, command.id, error)
      })
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      ctx.effect(() => {
        document.addEventListener('keydown', handleKeydown)
        return () => document.removeEventListener('keydown', handleKeydown)
      })
    }
  }

  register(command: Command): () => void {
    if (!command.id || !command.title || typeof command.run !== 'function') {
      this.logger.warn('register called with invalid command: %j', command)
      return () => {}
    }

    const existing = this.commandMap.get(command.id)
    if (existing) {
      this.logger.warn('command %s re-registered (overwrite)', command.id)
    }
    this.commandMap.set(command.id, command)

    // 快捷键：后注册者覆盖 + 冲突警告
    for (const shortcut of command.shortcut ?? []) {
      const owner = this.shortcutMap.get(shortcut.toLowerCase())
      if (owner && owner !== command.id) {
        this.logger.warn('shortcut %s conflict: %s -> %s (later wins)', shortcut, owner, command.id)
      }
      this.shortcutMap.set(shortcut.toLowerCase(), command.id)
    }

    this.logger.debug('registered command %s ("%s")', command.id, command.title)
    this.notify()

    // effect 语义：返回退订函数
    return () => {
      this.commandMap.delete(command.id)
      // 仅移除仍指向本命令的快捷键（避免误删新注册者的绑定）
      for (const [shortcut, owner] of this.shortcutMap) {
        if (owner === command.id) this.shortcutMap.delete(shortcut)
      }
      this.logger.debug('unregistered command %s', command.id)
      this.notify()
    }
  }

  list(): Command[] {
    return Array.from(this.commandMap.values()).filter((command) => !command.when || command.when())
  }

  async run(id: string): Promise<void> {
    const command = this.commandMap.get(id)
    if (!command) {
      throw new Error('command not found: ' + id)
    }
    if (command.when && !command.when()) {
      throw new Error('command unavailable (when=false): ' + id)
    }
    this.logger.debug('run command %s', id)
    await command.run({ id: command.id, ctx: this.ctx, commands: this })
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 匹配当前键盘事件命中的命令 id */
  private matchShortcut(event: KeyboardEvent): string | undefined {
    // 无修饰符的裸键不参与快捷键（避免输入干扰）
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return undefined
    for (const [shortcut, commandId] of this.shortcutMap) {
      if (parseShortcut(shortcut)(event)) return commandId
    }
    return undefined
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        this.logger.warn('onChange listener threw: %s', error)
      }
    }
  }
}

// ─── 类型声明合并 ───────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    commands: CommandsService
  }
}

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-commands'
export const inject = ['logger']
export const provide = ['commands']

export function apply(ctx: Context) {
  const logger = ctx.logger('commands')
  logger.info('plugin loaded')

  // Service 构造器即 effect 语义注册，卸载时自动撤销
  new CommandsServiceImpl(ctx)
}