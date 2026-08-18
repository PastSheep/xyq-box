/**
 * ADR-D1 契约：ctx.effect 副作用生命周期。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02）：
 * - effect 主体立即执行，返回的 disposer 执行清理；
 * - 同一 fiber 上的 disposables 按注册逆序（LIFO）清理；
 * - 支持生成器形式一次性收集多个 disposables（同样 LIFO）；
 * - 支持异步 effect（返回 Promise<disposer>），dispose 会等待异步清理完成；
 * - `fiber.getEffects()` 可读取 effect 元数据（label）；
 * - 在已卸载（uid 置空）的 fiber 上创建 effect 抛 CordisError（INACTIVE_EFFECT）。
 */
import { Context, CordisError } from 'cordis'
import { describe, expect, it } from 'vitest'

describe('ctx.effect（ADR-D1）', () => {
  it('立即执行 effect 主体，dispose 执行清理', () => {
    const ctx = new Context()
    const order: string[] = []
    const dispose = ctx.effect(() => {
      order.push('setup')
      return () => {
        order.push('teardown')
      }
    })
    expect(order).toEqual(['setup'])
    dispose()
    expect(order).toEqual(['setup', 'teardown'])
  })

  it('按注册逆序（LIFO）清理 disposables', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin((inner) => {
      inner.effect(() => () => {
        order.push('a')
      })
      inner.effect(() => () => {
        order.push('b')
      })
    })
    await fiber.dispose()
    expect(order).toEqual(['b', 'a'])
  })

  it('支持生成器形式的多个 disposables（同样 LIFO）', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin((inner) => {
      inner.effect(function* () {
        yield () => order.push('a')
        yield () => order.push('b')
      })
    })
    await fiber.dispose()
    expect(order).toEqual(['b', 'a'])
  })

  it('支持异步 effect，dispose 会等待异步清理', async () => {
    const ctx = new Context()
    let cleaned = false
    const fiber = await ctx.plugin((inner) => {
      inner.effect(async () => () => {
        cleaned = true
      })
    })
    expect(cleaned).toBe(false)
    await fiber.dispose()
    expect(cleaned).toBe(true)
  })

  it('effect 元数据可通过 getEffects() 读取', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin((inner) => {
      inner.effect(() => () => {}, 'my-effect')
    })
    const labels = fiber.getEffects().map((meta) => meta.label)
    expect(labels).toContain('my-effect')
    await fiber.dispose()
  })

  it('在已卸载的 fiber 上创建 effect 抛 CordisError', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(() => {})
    await fiber.dispose()
    expect(() => fiber.ctx.effect(() => {})).toThrow(CordisError)
    expect(() => fiber.ctx.effect(() => {})).toThrow(/inactive context/)
  })
})
