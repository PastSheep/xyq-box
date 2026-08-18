/**
 * ADR-D1 契约：ctx.plugin() 三种装载形态（函数 / 类 / 对象）与运行期语义。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02）：
 * - 函数形态：箭头函数走函数分支，返回值（disposer）会被收集；
 * - 类形态：以 `new` 实例化，配置作为第二参数传入；
 * - 对象形态：调用其 `apply(ctx, config)` 方法；
 * - `await ctx.plugin(...)` 解析为 Fiber 包装对象（`instanceof Fiber`）；
 * - 同名插件共享一个 runtime，但每个装载实例的 fiber 独立（uid 递增）；
 * - 非法插件值（非函数、无 apply 的对象）同步抛错。
 */
import { Context, Fiber, FiberState } from 'cordis'
import { describe, expect, it } from 'vitest'

describe('ctx.plugin 装载形态（ADR-D1）', () => {
  it('函数形态：同步执行并返回 Fiber', async () => {
    const ctx = new Context()
    let loaded = false
    const fiber = await ctx.plugin(() => {
      loaded = true
    })
    expect(loaded).toBe(true)
    expect(fiber).toBeInstanceOf(Fiber)
    expect(fiber.state).toBe(FiberState.ACTIVE)
  })

  it('函数形态：传递配置参数', async () => {
    const ctx = new Context()
    let received: unknown
    await ctx.plugin((_ctx, config) => {
      received = config
    }, { answer: 42 })
    expect(received).toEqual({ answer: 42 })
  })

  it('函数形态：异步函数须 await 完成', async () => {
    const ctx = new Context()
    let done = false
    await ctx.plugin(async () => {
      await Promise.resolve()
      done = true
    })
    expect(done).toBe(true)
  })

  it('函数形态：返回的 disposer 在卸载时执行', async () => {
    const ctx = new Context()
    let cleaned = false
    const fiber = await ctx.plugin(() => () => {
      cleaned = true
    })
    expect(cleaned).toBe(false)
    await fiber.dispose()
    expect(cleaned).toBe(true)
  })

  it('类形态：以 new 实例化并传递配置', async () => {
    const ctx = new Context()
    let received: unknown
    class MyPlugin {
      constructor(_ctx: Context, config: { label: string }) {
        received = config
      }
    }
    const fiber = await ctx.plugin(MyPlugin, { label: 'x' })
    expect(received).toEqual({ label: 'x' })
    expect(fiber.name).toBe('MyPlugin')
    await fiber.dispose()
  })

  it('对象形态：apply 方法被调用并传递配置', async () => {
    const ctx = new Context()
    const calls: unknown[] = []
    const plugin = {
      name: 'object-plugin',
      apply(_ctx: Context, config: unknown) {
        calls.push(config)
      },
    }
    await ctx.plugin(plugin, { n: 1 })
    expect(calls).toEqual([{ n: 1 }])
  })

  it('插件名解析到 fiber.name', async () => {
    const ctx = new Context()
    function namedPlugin() {}
    const fiber = await ctx.plugin(namedPlugin)
    expect(fiber.name).toBe('namedPlugin')
    await fiber.dispose()
  })

  it('同一插件重复装载共享 runtime，但 fiber 各自独立', async () => {
    const ctx = new Context()
    const plugin = () => {}
    const a = await ctx.plugin(plugin)
    const b = await ctx.plugin(plugin)
    expect(ctx.registry.size).toBe(1)
    expect(ctx.registry.has(plugin)).toBe(true)
    expect(a.uid).not.toBe(b.uid)
    await a.dispose()
    await b.dispose()
  })

  it('非法插件值同步抛错', () => {
    const ctx = new Context()
    expect(() => ctx.plugin(42 as never)).toThrow(/invalid plugin/)
  })
})
