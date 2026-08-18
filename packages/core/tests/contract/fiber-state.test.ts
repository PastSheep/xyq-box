/**
 * ADR-D1 契约：fiber 状态机流转。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02），通过 `internal/status` 事件观测：
 * - 装载：PENDING → LOADING → ACTIVE；
 * - 卸载（dispose）：ACTIVE → UNLOADING → DISPOSED；
 * - restart：ACTIVE → UNLOADING → LOADING → ACTIVE；
 * - 插件主体抛错：LOADING → UNLOADING → FAILED（`fiber.state === FAILED`，
 *   `await ctx.plugin(...)` 拒绝）；
 * - inject 驱动：依赖缺失时消费者保持 PENDING；provider 装载 →
 *   PENDING → LOADING → ACTIVE；provider 卸载 → ACTIVE → UNLOADING → PENDING。
 */
import { Context, FiberState } from 'cordis'
import { describe, expect, it } from 'vitest'

type Transition = [old: FiberState, next: FiberState]

function track(ctx: Context, match: (fiber: { uid: number | null }) => boolean = () => true) {
  const transitions: Transition[] = []
  ctx.on('internal/status', (fiber, oldState) => {
    if (match(fiber)) transitions.push([oldState, fiber.state])
  })
  return transitions
}

describe('fiber 状态机（ADR-D1）', () => {
  it('装载时流转 PENDING → LOADING → ACTIVE', async () => {
    const ctx = new Context()
    const transitions = track(ctx)
    const fiber = await ctx.plugin(() => {})
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(transitions).toEqual([
      [FiberState.PENDING, FiberState.LOADING],
      [FiberState.LOADING, FiberState.ACTIVE],
    ])
  })

  it('dispose 时流转 ACTIVE → UNLOADING → DISPOSED', async () => {
    const ctx = new Context()
    const transitions = track(ctx)
    const fiber = await ctx.plugin(() => {})
    transitions.length = 0
    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
    expect(transitions).toEqual([
      [FiberState.ACTIVE, FiberState.UNLOADING],
      [FiberState.UNLOADING, FiberState.DISPOSED],
    ])
  })

  it('restart 时流转 ACTIVE → UNLOADING → LOADING → ACTIVE', async () => {
    const ctx = new Context()
    const transitions = track(ctx)
    const fiber = await ctx.plugin((inner) => {
      inner.effect(() => () => {})
    })
    transitions.length = 0
    await fiber.restart()
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(transitions).toEqual([
      [FiberState.ACTIVE, FiberState.UNLOADING],
      [FiberState.UNLOADING, FiberState.LOADING],
      [FiberState.LOADING, FiberState.ACTIVE],
    ])
  })

  it('插件主体抛错时流转 LOADING → UNLOADING → FAILED', async () => {
    const ctx = new Context()
    const transitions = track(ctx)
    const fiber = ctx.plugin(() => {
      throw new Error('boom')
    })
    await expect(fiber).rejects.toThrow('boom')
    expect(fiber.state).toBe(FiberState.FAILED)
    expect(transitions).toEqual([
      [FiberState.PENDING, FiberState.LOADING],
      [FiberState.LOADING, FiberState.UNLOADING],
      [FiberState.UNLOADING, FiberState.FAILED],
    ])
  })

  it('inject 驱动消费者在 PENDING ↔ ACTIVE 之间流转', async () => {
    const ctx = new Context()
    const consumer = {
      inject: ['foo'],
      apply() {},
    }
    const consumerFiber = await ctx.plugin(consumer)
    expect(consumerFiber.state).toBe(FiberState.PENDING)
    const transitions = track(ctx, (fiber) => fiber.uid === consumerFiber.uid)

    const providerFiber = await ctx.plugin((inner) => inner.provide('foo', 1))
    await consumerFiber.await()
    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    expect(transitions).toEqual([
      [FiberState.PENDING, FiberState.LOADING],
      [FiberState.LOADING, FiberState.ACTIVE],
    ])

    transitions.length = 0
    await providerFiber.dispose()
    await consumerFiber.await()
    expect(consumerFiber.state).toBe(FiberState.PENDING)
    expect(transitions).toEqual([
      [FiberState.ACTIVE, FiberState.UNLOADING],
      [FiberState.UNLOADING, FiberState.PENDING],
    ])
  })
})
