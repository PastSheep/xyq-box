/**
 * cordis 4.0.0-rc.8 运行时冒烟测试（ADR-D1 契约测试套件的种子）。
 * 固化 Context 创建、插件装载（函数形态，异步执行）与 fiber 释放等核心用法的行为，
 * 作为 cordis 4.0.0 正式版升级的迁移闸门。
 *
 * 实测 v4 API（2026-02）：
 * - `await ctx.plugin(fn)` 解析为 Fiber（插件函数异步执行，须 await）；
 * - `fiber.dispose()` 卸载插件并清理其 effect 注册。
 */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

describe('cordis runtime (ADR-D1)', () => {
  it('creates a Context and mounts a function plugin', async () => {
    const ctx = new Context()
    let loaded = false
    await ctx.plugin(() => {
      loaded = true
    })
    expect(loaded).toBe(true)
  })

  it('tears down plugin effects on fiber dispose', async () => {
    const ctx = new Context()
    let cleaned = false
    const fiber = await ctx.plugin((inner) => {
      inner.effect(() => () => {
        cleaned = true
      })
    })
    expect(cleaned).toBe(false)
    await fiber.dispose()
    expect(cleaned).toBe(true)
  })
})
