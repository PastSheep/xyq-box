/**
 * ADR-D1 契约：inject/provide 依赖驱动。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02）：
 * - 依赖缺失时消费者 fiber 停留在 PENDING，apply 不执行；
 * - provider 装载并进入 ACTIVE 后，消费者重载（PENDING → LOADING → ACTIVE），
 *   通过 `ctx.foo`（inject 声明）读取服务值；
 * - provider 卸载触发消费者卸载（ACTIVE → UNLOADING → PENDING），其 effect 被清理；
 * - 服务重新提供后消费者再次重载；
 * - `ctx.provide()` 返回的 disposer 可手动撤销服务；
 * - `Service` 子类（构造函数内 `super(ctx, name)` 提供服务）可作为 provider。
 */
import { Context, FiberState, Service } from 'cordis'
import { describe, expect, it } from 'vitest'

describe('inject/provide 依赖驱动（ADR-D1）', () => {
  it('依赖缺失时消费者保持 PENDING，不执行 apply', async () => {
    const ctx = new Context()
    let loaded = false
    const consumer = {
      inject: ['foo'],
      apply() {
        loaded = true
      },
    }
    const fiber = await ctx.plugin(consumer)
    expect(loaded).toBe(false)
    expect(fiber.state).toBe(FiberState.PENDING)
    expect(ctx.get('foo')).toBeUndefined()
  })

  it('provider 装载后消费者重载并读取服务值', async () => {
    const ctx = new Context()
    let loaded = false
    let seen: unknown
    const consumer = {
      inject: ['foo'],
      apply(ctx: Context) {
        loaded = true
        seen = ctx.foo
      },
    }
    const consumerFiber = await ctx.plugin(consumer)
    expect(loaded).toBe(false)

    const providerFiber = await ctx.plugin((inner) => {
      inner.provide('foo', { hello: 'world' })
    })
    await consumerFiber.await()
    expect(loaded).toBe(true)
    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    expect(seen).toEqual({ hello: 'world' })
    expect(ctx.get('foo')).toEqual({ hello: 'world' })
    await providerFiber.dispose()
  })

  it('provider 卸载触发消费者卸载，重新提供后再次重载', async () => {
    const ctx = new Context()
    let loads = 0
    let unloads = 0
    const consumer = {
      inject: ['foo'],
      apply(ctx: Context) {
        loads += 1
        ctx.effect(() => () => {
          unloads += 1
        })
      },
    }
    const consumerFiber = await ctx.plugin(consumer)
    expect(loads).toBe(0)

    const providerFiber = await ctx.plugin((inner) => inner.provide('foo', 1))
    await consumerFiber.await()
    expect(loads).toBe(1)
    expect(consumerFiber.state).toBe(FiberState.ACTIVE)

    await providerFiber.dispose()
    await consumerFiber.await()
    expect(consumerFiber.state).toBe(FiberState.PENDING)
    expect(unloads).toBe(1)
    expect(loads).toBe(1)

    const providerFiber2 = await ctx.plugin((inner) => inner.provide('foo', 2))
    await consumerFiber.await()
    expect(loads).toBe(2)
    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.get('foo')).toBe(2)
    await providerFiber2.dispose()
  })

  it('ctx.provide 返回的 disposer 可手动撤销服务', async () => {
    const ctx = new Context()
    let disposeService: (() => Promise<void>) | undefined
    await ctx.plugin((inner) => {
      disposeService = inner.provide('bar', 1)
    })
    expect(ctx.get('bar')).toBe(1)
    await disposeService!()
    expect(ctx.get('bar')).toBeUndefined()
  })

  it('Service 子类可作为 provider 提供服务', async () => {
    const ctx = new Context()
    class FooService extends Service {
      value = ''

      constructor(ctx: Context) {
        super(ctx, 'foo')
        this.value = 'served'
      }
    }
    let seen: unknown
    const consumer = {
      inject: ['foo'],
      apply(ctx: Context) {
        seen = ctx.foo.value
      },
    }
    const serviceFiber = await ctx.plugin(FooService)
    const consumerFiber = await ctx.plugin(consumer)
    await consumerFiber.await()
    expect(seen).toBe('served')
    expect(ctx.get('foo')).toBeInstanceOf(FooService)
    await serviceFiber.dispose()
  })
})
