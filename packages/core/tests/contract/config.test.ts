/**
 * ADR-D1 契约：插件 Config 校验（Standard Schema）。
 *
 * 锁 cordis@4.0.0-rc.8。实测 v4 API（2026-02）：
 * - 合法配置装载成功，fiber 进入 ACTIVE，`fiber.config` 为校验后的配置；
 * - 非法配置使 `await ctx.plugin(...)` 与 `fiber.await()` 抛 ValidationError，
 *   状态机计算结果（`_getState()`）为 FAILED；
 *   （注：rc.8 中 Config 校验失败发生在 fiber 构造期 effect 内，
 *   仅写入 `_error` 而不触发 `_updateState`，故公开的 `fiber.state` 字段停留在
 *   PENDING —— 以 await 抛错与 `_getState() === FAILED` 作为对外契约。）
 * - 校验错误信息包含出问题的配置路径；
 * - `fiber.update()` 对新配置同步校验，失败时同步抛 ValidationError 且原状态不变；
 * - update 成功后以新配置重载插件。
 */
import { Context, FiberState, ValidationError } from 'cordis'
import Schema from 'schemastery'
import { describe, expect, it } from 'vitest'

const plugin = {
  name: 'cfg-plugin',
  Config: Schema.object({
    count: Schema.number().required(),
  }),
  apply() {},
}

describe('Config 校验（ADR-D1）', () => {
  it('合法配置装载成功并进入 ACTIVE', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { count: 3 })
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(fiber.config).toEqual({ count: 3 })
    await fiber.dispose()
  })

  it('非法配置使 fiber 进入 FAILED 并抛出 ValidationError', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(plugin, {})
    await expect(fiber).rejects.toThrow(ValidationError)
    expect((fiber as unknown as { _getState(): FiberState })._getState()).toBe(FiberState.FAILED)
    await expect(fiber.await()).rejects.toThrow(ValidationError)
  })

  it('校验错误信息包含出问题的配置路径', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(plugin, {})
    await expect(fiber).rejects.toThrow(/count/)
  })

  it('fiber.update() 同步校验新配置', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { count: 1 })
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(() => fiber.update({})).toThrow(ValidationError)
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(fiber.config).toEqual({ count: 1 })
    await fiber.dispose()
  })

  it('update 成功后以新配置重载插件', async () => {
    const ctx = new Context()
    const received: unknown[] = []
    const dynamic = {
      name: 'dynamic',
      Config: Schema.object({
        step: Schema.number().required(),
      }),
      apply(_ctx: Context, config: unknown) {
        received.push(config)
      },
    }
    const fiber = await ctx.plugin(dynamic, { step: 1 })
    expect(received).toEqual([{ step: 1 }])
    fiber.update({ step: 2 })
    await fiber.await()
    expect(received).toEqual([{ step: 1 }, { step: 2 }])
    expect(fiber.state).toBe(FiberState.ACTIVE)
    await fiber.dispose()
  })
})
