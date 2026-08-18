/**
 * ADR-D1 契约：ctx.on / ctx.emit 事件系统。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02）：
 * - emit 按注册顺序调用监听器并透传参数（首参为字符串事件名，不当作 thisArg）；
 * - `ctx.on()` 返回 disposer，调用后移除监听器；
 * - `ctx.once()` 只触发一次；
 * - `ctx.on(name, listener, true)` 以 prepend 方式插队；
 * - 插件内注册的监听器随 fiber 卸载自动清理（effect 管理）。
 */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

declare module 'cordis' {
  interface Events {
    'ping'(...args: any[]): void
    'seq'(): void
    'boom'(): void
  }
}

describe('ctx.on / ctx.emit（ADR-D1）', () => {
  it('emit 按注册顺序调用监听器并透传参数', () => {
    const ctx = new Context()
    const calls: unknown[][] = []
    ctx.on('ping', (...args) => {
      calls.push(args)
    })
    ctx.emit('ping', 1, 'a')
    ctx.emit('ping')
    expect(calls).toEqual([[1, 'a'], []])
  })

  it('on 返回的 disposer 可移除监听器', () => {
    const ctx = new Context()
    let count = 0
    const dispose = ctx.on('ping', () => {
      count += 1
    })
    ctx.emit('ping')
    dispose()
    ctx.emit('ping')
    expect(count).toBe(1)
  })

  it('once 只触发一次', () => {
    const ctx = new Context()
    let count = 0
    ctx.once('boom', () => {
      count += 1
    })
    ctx.emit('boom')
    ctx.emit('boom')
    expect(count).toBe(1)
  })

  it('支持 prepend 监听器', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('seq', () => order.push('a'))
    ctx.on('seq', () => order.push('b'), true)
    ctx.emit('seq')
    expect(order).toEqual(['b', 'a'])
  })

  it('插件内注册的监听器随 fiber 卸载自动清理', async () => {
    const ctx = new Context()
    let count = 0
    const fiber = await ctx.plugin((inner) => {
      inner.on('ping', () => {
        count += 1
      })
    })
    ctx.emit('ping')
    expect(count).toBe(1)
    await fiber.dispose()
    ctx.emit('ping')
    expect(count).toBe(1)
  })
})
