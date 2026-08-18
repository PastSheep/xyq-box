/**
 * ADR-D1 契约：new Context() 与上下文结构。
 *
 * 锁 cordis@4.0.0-rc.8（精确版本，作为 cordis 4.0.0 正式版升级的迁移闸门）。
 * 实测 v4 API（2026-02）：
 * - `new Context()` 返回经过 ReflectService Proxy 包装的根上下文；
 * - `Context.is()` 以静态方法判别上下文实例；
 * - 根上下文内置 events / logger / reflect / registry 四类服务；
 * - 根 fiber 命名 'root'，初始状态 ACTIVE；
 * - `ctx.extend()` 派生共享同一 root 的子上下文（原型链继承）。
 */
import { Context, FiberState } from 'cordis'
import { describe, expect, it } from 'vitest'

describe('Context 构造（ADR-D1）', () => {
  it('new Context() 创建可用的根上下文', () => {
    const ctx = new Context()
    expect(Context.is(ctx)).toBe(true)
    expect(Context.is(null)).toBe(false)
    expect(Context.is(undefined)).toBe(false)
  })

  it('根上下文暴露内置服务', () => {
    const ctx = new Context()
    expect(ctx.events).toBeDefined()
    expect(ctx.logger).toBeDefined()
    expect(ctx.reflect).toBeDefined()
    expect(ctx.registry).toBeDefined()
  })

  it('根 fiber 处于 ACTIVE 且命名为 root', () => {
    const ctx = new Context()
    expect(ctx.fiber).toBeDefined()
    expect(ctx.fiber.name).toBe('root')
    expect(ctx.fiber.state).toBe(FiberState.ACTIVE)
  })

  it('extend() 派生共享根上下文的子上下文', () => {
    const ctx = new Context()
    const child = ctx.extend()
    expect(child).not.toBe(ctx)
    expect(child.root).toBe(ctx)
  })
})
