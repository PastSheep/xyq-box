/**
 * ADR-D1 契约：ctx.get 服务探测。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02）：
 * - 未提供的服务返回 undefined（不抛错）；
 * - 提供后返回对应值，disposer 撤销后恢复 undefined；
 * - 可跨 fiber 读取：根上下文与未声明 inject 的插件均可通过 `ctx.get(name)` 探测；
 * - 未声明 inject 时直接访问属性（`ctx.foo`）抛 "cannot get property ... without inject"。
 */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

describe('ctx.get 服务探测（ADR-D1）', () => {
  it('未提供的服务返回 undefined', () => {
    const ctx = new Context()
    expect(ctx.get('missing')).toBeUndefined()
  })

  it('返回已提供的服务值，撤销后恢复 undefined', async () => {
    const ctx = new Context()
    const dispose = ctx.provide('foo', 42)
    expect(ctx.get('foo')).toBe(42)
    await dispose()
    expect(ctx.get('foo')).toBeUndefined()
  })

  it('可读取插件提供的服务', async () => {
    const ctx = new Context()
    await ctx.plugin((inner) => {
      inner.provide('foo', { v: 1 })
    })
    expect(ctx.get('foo')).toEqual({ v: 1 })
  })

  it('未声明 inject 的插件内可用 ctx.get 探测，直接访问属性则抛错', async () => {
    const ctx = new Context()
    await ctx.plugin((inner) => {
      inner.provide('foo', 'bar')
    })
    const fiber = await ctx.plugin((inner) => {
      expect(inner.get('foo')).toBe('bar')
      expect(inner.get('missing')).toBeUndefined()
      expect(() => inner.foo).toThrow(/cannot get property "foo" without inject/)
    })
    await fiber.dispose()
  })
})
