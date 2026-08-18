/**
 * @xyq-box/plugin-hello —— 单测
 *
 * 契约：装载→卸载→重载 生命周期，与 Config / hello 服务的正确性。
 * 注：cordis 内置 logger 以 ctx.logger 属性存在，需先 provide 才能被 inject: ['logger'] 解析。
 */
import { Context, FiberState } from 'cordis'
import { describe, expect, it } from 'vitest'

import * as plugin from '../src/index.js'
import type { Config } from '../src/index.js'

// ─── 默认配置 ───────────────────────────────────────────────────────────────

const defaultConfig: Config = {
  greeting: 'Hello',
  repeat: 1,
  enabled: true,
}

/** 创建带 logger 服务的上下文（满足 inject: ['logger']） */
function createContext(): Context {
  const ctx = new Context()
  ctx.provide('logger', ctx.logger)
  return ctx
}

// ─── 测试 ───────────────────────────────────────────────────────────────────

describe('@xyq-box/plugin-hello', () => {
  it('装载：注册 hello 服务，greet 返回正确结果', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin, defaultConfig)

    expect(fiber.state).toBe(FiberState.ACTIVE)
    // 服务可访问
    expect(ctx.hello).toBeDefined()
    expect(typeof ctx.hello.greet).toBe('function')
    expect(ctx.hello.greet('World')).toBe('Hello, World!')

    await fiber.dispose()
  })

  it('卸载：服务不可用，effect 清理干净', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin, defaultConfig)

    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.hello).toBeDefined()

    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
    // 卸载后 ctx.get('hello') 应为 undefined
    expect(ctx.get('hello')).toBeUndefined()
  })

  it('重载：restart 后服务仍可用', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin, defaultConfig)

    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.hello.greet('World')).toBe('Hello, World!')

    // 热重载
    await fiber.restart()
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.hello).toBeDefined()
    expect(ctx.hello.greet('Plugin')).toBe('Hello, Plugin!')

    await fiber.dispose()
  })

  it('自定义配置：greeting 与 repeat 生效', async () => {
    const ctx = createContext()
    const config: Config = {
      greeting: 'Hi',
      repeat: 2,
      enabled: true,
    }
    const fiber = await ctx.plugin(plugin, config)

    expect(ctx.hello.greet('Alice')).toBe('Hi, Alice!')

    await fiber.dispose()
  })

  it('enabled=false 时 greet 返回空字符串', async () => {
    const ctx = createContext()
    const config: Config = { greeting: 'Hi', repeat: 1, enabled: false }
    const fiber = await ctx.plugin(plugin, config)

    expect(ctx.hello.greet('Bob')).toBe('')

    await fiber.dispose()
  })

  it('装载→卸载→重新装载：服务可恢复', async () => {
    const ctx = createContext()

    // 第一次装载
    const fiber1 = await ctx.plugin(plugin, defaultConfig)
    expect(ctx.hello.greet('First')).toBe('Hello, First!')
    await fiber1.dispose()
    expect(ctx.get('hello')).toBeUndefined()

    // 第二次装载
    const fiber2 = await ctx.plugin(plugin, defaultConfig)
    expect(ctx.hello.greet('Second')).toBe('Hello, Second!')
    await fiber2.dispose()
  })
})
