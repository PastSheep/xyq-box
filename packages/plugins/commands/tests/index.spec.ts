/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @xyq-box/plugin-commands —— 单测
 *
 * 契约：注册/列出/执行/退订、when() 过滤、快捷键分发、重载生命周期。
 */
import { Context, FiberState } from 'cordis'
import { describe, expect, it, vi } from 'vitest'

import * as plugin from '../src/index.js'

/** 创建带 logger 服务的上下文 */
function createContext(): Context {
  const ctx = new Context()
  ctx.provide('logger', ctx.logger)
  return ctx
}

/** 设置 DOM 全局 mock 以供快捷键注册 & 测试（node 环境无 document） */
function setupMockDom(): { dispatchKeydown: (opts: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => void } {
  const listeners = new Map<string, Set<(event: any) => void>>()
  const mockDoc = {
    addEventListener: (type: string, handler: (event: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    removeEventListener: (type: string, handler: (event: any) => void) => {
      listeners.get(type)?.delete(handler)
    },
  } as any
  const mockWin = {} as any
  globalThis.window = mockWin
  globalThis.document = mockDoc
  // 注：不继承 Event，因为 Event 的属性（bubbles/cancelable）是只读 getter",
  // Object.assign 无法覆盖 — 改用纯对象满足 handlers 访问的字段即可",
  globalThis.KeyboardEvent = class MockKeyboardEvent {
    readonly type: string
    key: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
    bubbles: boolean
    cancelable: boolean
    defaultPrevented = false
    constructor(type: string, opts: any) {
      this.type = type
      this.key = opts.key
      this.ctrlKey = opts.ctrlKey ?? false
      this.altKey = opts.altKey ?? false
      this.shiftKey = opts.shiftKey ?? false
      this.metaKey = opts.metaKey ?? false
      this.bubbles = opts.bubbles ?? false
      this.cancelable = opts.cancelable ?? false
    }
    preventDefault() { this.defaultPrevented = true }
    stopPropagation() {}
  } as any
  return {
    dispatchKeydown: (opts) => {
      const event = new (globalThis.KeyboardEvent as any)('keydown', {
        key: opts.key,
        ctrlKey: opts.ctrlKey ?? false,
        altKey: opts.altKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        metaKey: opts.metaKey ?? false,
        bubbles: true,
        cancelable: true,
      })
      for (const handler of listeners.get('keydown') ?? []) {
        handler(event)
      }
    },
  }
}

function teardownMockDom(): void {
  delete globalThis.window
  delete globalThis.document
  delete globalThis.KeyboardEvent
}

// ─── 测试 ───────────────────────────────────────────────────────────────────

describe('@xyq-box/plugin-commands', () => {
  it('装载：注册 commands 服务', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)

    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.commands).toBeDefined()
    expect(typeof ctx.commands.register).toBe('function')
    expect(typeof ctx.commands.run).toBe('function')
    expect(typeof ctx.commands.list).toBe('function')

    await fiber.dispose()
  })

  it('register/list/run：注册可列出、执行可触发', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)
    const calls: string[] = []

    const dispose = ctx.commands.register({
      id: 'test.say-hello',
      title: '打招呼',
      run: ({ id }) => { calls.push(id) },
    })

    expect(ctx.commands.list().map((c) => c.id)).toContain('test.say-hello')
    await ctx.commands.run('test.say-hello')
    expect(calls).toEqual(['test.say-hello'])

    dispose()
    expect(ctx.commands.list().map((c) => c.id)).not.toContain('test.say-hello')

    await fiber.dispose()
  })

  it('run：命令不存在时拒绝执行', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)

    await expect(ctx.commands.run('no.such-command')).rejects.toThrow(/not found/)

    await fiber.dispose()
  })

  it('when=false：不出现在 list()，run() 拒绝执行', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)

    ctx.commands.register({
      id: 'test.hidden',
      title: '隐藏命令',
      when: () => false,
      run: () => {},
    })
    expect(ctx.commands.list().map((c) => c.id)).not.toContain('test.hidden')
    await expect(ctx.commands.run('test.hidden')).rejects.toThrow(/unavailable/)

    await fiber.dispose()
  })

  it('快捷键分发：Ctrl+K 触发对应命令', async () => {
    const dom = setupMockDom()
    try {
      const ctx = createContext()
      const fiber = await ctx.plugin(plugin)
      const calls: string[] = []

      ctx.commands.register({
        id: 'test.open',
        title: '打开',
        shortcut: ['Ctrl+K'],
        run: ({ id }) => { calls.push(id) },
      })

      dom.dispatchKeydown({ key: 'k', ctrlKey: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toEqual(['test.open'])

      await fiber.dispose()
    } finally {
      teardownMockDom()
    }
  })

  it('快捷键冲突：后注册者生效', async () => {
    const dom = setupMockDom()
    try {
      const ctx = createContext()
      const fiber = await ctx.plugin(plugin)
      const calls: string[] = []

      ctx.commands.register({ id: 'a', title: 'A', shortcut: ['Ctrl+P'], run: () => { calls.push('a') } })
      ctx.commands.register({ id: 'b', title: 'B', shortcut: ['Ctrl+P'], run: () => { calls.push('b') } })

      dom.dispatchKeydown({ key: 'p', ctrlKey: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
      // 后注册者生效：Ctrl+P 触发 b 而非 a
      expect(calls).toEqual(['b'])

      await fiber.dispose()
    } finally {
      teardownMockDom()
    }
  })

  it('卸载：commands 服务移除；命令与快捷键清理', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)
    ctx.commands.register({ id: 'test.x', title: 'X', run: () => {} })

    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
    expect(ctx.get('commands')).toBeUndefined()
  })

  it('重载：restart 后命令服务仍可用、新命令可注册', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)

    ctx.commands.register({
      id: 'test.reload',
      title: '重载',
      run: () => {},
    })

    await fiber.restart()
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.commands).toBeDefined()

    // 重启后是新服务实例：旧命令已随旧实例清理，新命令可注册可执行
    const calls: string[] = []
    ctx.commands.register({
      id: 'test.reload-new',
      title: '重载后新命令',
      run: ({ id }) => { calls.push(id) },
    })
    await ctx.commands.run('test.reload-new')
    expect(calls).toEqual(['test.reload-new'])

    await fiber.dispose()
  })

  it('onChange：注册/退订触发通知', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)
    const listener = vi.fn()
    const unsubscribe = ctx.commands.onChange(listener)

    const dispose = ctx.commands.register({ id: 'test.n', title: 'N', run: () => {} })
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()

    ctx.commands.register({ id: 'test.n2', title: 'N2', run: () => {} })
    expect(listener).toHaveBeenCalledTimes(2) // 退订后不再通知

    await fiber.dispose()
  })
})