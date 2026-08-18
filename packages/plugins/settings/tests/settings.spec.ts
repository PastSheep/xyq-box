/**
 * @xyq-box/plugin-settings —— 单测
 *
 * 契约：
 * - schemaToForm：从 schemastery object schema 生成字段描述（string/number/boolean/嵌套 object）；
 * - patchFromPath：点路径 → 嵌套 patch；
 * - 插件装载：config + views 服务可用时注册 panel 视图；
 * - config 服务缺失：降级打日志不崩溃；
 * - views 服务缺失：降级打日志不注册视图。
 */
import { Context } from 'cordis'
import Schema from 'schemastery'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import * as plugin from '../src/index.js'
import { patchFromPath, schemaToForm } from '../src/schema.js'

// ─── 测试用 schema ───────────────────────────────────────────────────────────

const testSchema = Schema.object({
  name: Schema.string().default('xyq').description('名称'),
  count: Schema.natural().default(1).description('数量'),
  enabled: Schema.boolean().default(false).description('开关'),
  nested: Schema.object({
    flag: Schema.boolean().default(true).description('嵌套开关'),
  }).default({}),
})

// ─── 辅助 ───────────────────────────────────────────────────────────────────

const registeredViews: Array<Record<string, unknown>> = []
let viewsDisposerRan = false
const viewsMock = {
  register: vi.fn((descriptor: Record<string, unknown>) => {
    registeredViews.push(descriptor)
    return () => {
      viewsDisposerRan = true
    }
  }),
  list: () => [],
  onChange: () => () => {},
}

const configValues: Record<string, unknown> = { 'test-plugin': { name: 'hello' } }
const configListeners = new Map<string, Set<(value: unknown) => void>>()
const configMock = {
  get: vi.fn((pluginId: string) => configValues[pluginId] ?? {}),
  set: vi.fn(async (pluginId: string, patch: unknown) => {
    configValues[pluginId] = { ...(configValues[pluginId] as object), ...(patch as object) }
    const listeners = configListeners.get(pluginId)
    if (listeners) for (const listener of listeners) listener(configValues[pluginId])
  }),
  onChange: vi.fn((pluginId: string, listener: (value: unknown) => void) => {
    let set = configListeners.get(pluginId)
    if (!set) {
      set = new Set()
      configListeners.set(pluginId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
    }
  }),
  snapshot: vi.fn(() => ({})),
  listSchemas: vi.fn(() => [{ pluginId: 'test-plugin', schema: testSchema }]),
}

beforeEach(() => {
  registeredViews.length = 0
  viewsDisposerRan = false
  configListeners.clear()
})

function createContext(): Context {
  const ctx = new Context()
  ctx.provide('logger', ctx.logger)
  return ctx
}

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) fiber.dispose()
  })
}

// ─── schemaToForm ────────────────────────────────────────────────────────────

describe('schemaToForm', () => {
  it('生成字段列表（嵌套对象展开为 children）', () => {
    const fields = schemaToForm(testSchema)
    const keys = fields.map((f) => f.key)
    expect(keys).toContain('name')
    expect(keys).toContain('count')
    expect(keys).toContain('enabled')
    expect(keys).toContain('nested')
    // 嵌套字段挂在 object 字段的 children 下，带点路径
    const nested = fields.find((f) => f.key === 'nested')
    expect(nested).toBeDefined()
    expect(nested!.children?.map((c) => c.key)).toContain('nested.flag')
  })

  it('字段类型映射：default→string / natural→number / boolean→boolean', () => {
    const fields = schemaToForm(testSchema)
    const byKey = new Map(fields.map((f) => [f.key, f]))
    expect(byKey.get('name')!.type).toBe('string')
    expect(byKey.get('count')!.type).toBe('number')
    expect(byKey.get('enabled')!.type).toBe('boolean')
    expect(byKey.get('nested')!.type).toBe('object')
  })

  it('标签来自 description，默认值来自 default', () => {
    const fields = schemaToForm(testSchema)
    const byKey = new Map(fields.map((f) => [f.key, f]))
    expect(byKey.get('name')!.label).toBe('名称')
    expect(byKey.get('name')!.default).toBe('xyq')
    expect(byKey.get('count')!.min).toBe(0)
    expect(byKey.get('count')!.step).toBe(1)
  })

  it('空 schema 返回空数组', () => {
    expect(schemaToForm(null)).toEqual([])
    expect(schemaToForm({})).toEqual([])
  })
})

// ─── patchFromPath ───────────────────────────────────────────────────────────

describe('patchFromPath', () => {
  it('单字段路径', () => {
    expect(patchFromPath(['name'], 'hi')).toEqual({ name: 'hi' })
  })

  it('嵌套路径', () => {
    expect(patchFromPath(['nested', 'flag'], true)).toEqual({ nested: { flag: true } })
  })

  it('空路径返回空对象', () => {
    expect(patchFromPath([], 1)).toEqual({})
  })
})

// ─── 插件导出 ────────────────────────────────────────────────────────────────

describe('@xyq-box/plugin-settings', () => {
  it('导出 name / Config / apply', () => {
    expect(plugin.name).toBe('@xyq-box/plugin-settings')
    expect(plugin.Config).toBeDefined()
    expect(typeof plugin.apply).toBe('function')
  })

  it('config + views 可用：注册 panel 视图', async () => {
    const ctx = createContext()
    ctx.provide('config', configMock as never)
    ctx.provide('views', viewsMock as never)

    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(2) // ACTIVE
    expect(registeredViews).toHaveLength(1)
    expect(registeredViews[0]!.id).toBe('@xyq-box/plugin-settings/panel')
    expect(registeredViews[0]!.slots).toContain('panel')
    expect(registeredViews[0]!.component).toBeDefined()

    await fiber.dispose()
    expect(viewsDisposerRan).toBe(true)
    disposeAll(ctx)
  })

  it('config 服务缺失：降级打日志不崩溃', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(2) // ACTIVE
    expect(registeredViews).toHaveLength(0)
    await fiber.dispose()
    disposeAll(ctx)
  })

  it('views 服务缺失：config 可用但不注册视图', async () => {
    const ctx = createContext()
    ctx.provide('config', configMock as never)
    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(2)
    // 不注册任何视图
    expect(registeredViews).toHaveLength(0)
    await fiber.dispose()
    disposeAll(ctx)
  })
})
