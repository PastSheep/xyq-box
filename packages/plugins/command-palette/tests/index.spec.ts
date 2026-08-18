/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @xyq-box/plugin-command-palette —— 单测
 *
 * 契约：commands 服务缺失时降级不崩溃；存在时注册 Ctrl+K 命令；
 * togglePalette/onPaletteToggle 事件机制。
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

/** 最小 commands 服务替身（结构子集） */
function createCommandsMock() {
  const registered: any[] = []
  const mock = {
    register: vi.fn((command: any) => {
      registered.push(command)
      return () => {
        const i = registered.indexOf(command)
        if (i >= 0) registered.splice(i, 1)
      }
    }),
    list: () => registered,
    run: vi.fn(async () => {}),
    onChange: () => () => {},
  }
  return { mock, registered }
}

describe('@xyq-box/plugin-command-palette', () => {
  it('commands 服务缺失：降级打日志不崩溃', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(FiberState.ACTIVE)
    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
  })

  it('装载：注册「打开命令面板」命令（Ctrl+K / Ctrl+P）', async () => {
    const ctx = createContext()
    const { mock } = createCommandsMock()
    ctx.provide('commands', mock as never)

    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(mock.register).toHaveBeenCalledTimes(1)
    const command = mock.register.mock.calls[0][0]
    expect(command.id).toBe('@xyq-box/plugin-command-palette/open')
    expect(command.shortcut).toEqual(['Ctrl+K', 'Ctrl+P'])

    await fiber.dispose()
  })

  it('打开的run回调：调用 togglePalette 触发订阅者', async () => {
    const ctx = createContext()
    const { mock } = createCommandsMock()
    ctx.provide('commands', mock as never)
    const fiber = await ctx.plugin(plugin)
    const command = mock.register.mock.calls[0][0] as { run: (c: any) => void | Promise<void> }

    const listener = vi.fn()
    const unsubscribe = plugin.onPaletteToggle(listener)
    await command.run({ id: command.id })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()

    await fiber.dispose()
  })

  it('onPaletteToggle：退订后不再通知', async () => {
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const unsubA = plugin.onPaletteToggle(listenerA)
    const unsubB = plugin.onPaletteToggle(listenerB)

    plugin.togglePalette()
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(1)

    unsubA()
    plugin.togglePalette()
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(2)
    unsubB()
  })
})