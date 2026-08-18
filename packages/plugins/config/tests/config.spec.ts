/**
 * @xyq-box/plugin-config —— 单测
 *
 * 契约：
 * - 装载/卸载生命周期（ctx.config 服务出现/消失）；
 * - 按插件名分片读写 + schema 默认值合并（get 返回 defaults + 用户配置）；
 * - set：持久化委托 storage + onChange 通知 + 变更即热重载（fiber.update 用新配置重启）；
 * - 非法配置校验失败：set 拒绝且不写入；
 * - 无 storage 插件时降级为内存（不崩）；
 * - 水合：storage 已有配置时，新 config 实例能恢复（跨实例持久化）。
 */
import { Context } from 'cordis'
import Schema from 'schemastery'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { ConfigServiceImpl, type ConfigService } from '../src/index.js'
import * as configPlugin from '../src/index.js'
import { MemoryStorageBackend, StorageServiceImpl } from '../../storage/src/index.js'

// ─── 测试用 schema ───────────────────────────────────────────────────────────

export interface DummyConfig {
  greeting: string
  repeat: number
  enabled: boolean
  nested?: { flag?: boolean }
}

const dummyConfigSchema = Schema.object({
  greeting: Schema.string().default('Hello').description('默认问候语'),
  repeat: Schema.natural().default(1).description('重复次数（≥0）'),
  enabled: Schema.boolean().default(true).description('是否启用'),
  nested: Schema.object({
    flag: Schema.boolean().default(false).description('嵌套开关'),
  }).default({}),
})

/** 声明了 Config schema 的测试插件（对象形态） */
const dummyPlugin = {
  name: 'dummy-plugin',
  Config: dummyConfigSchema,
  apply(_ctx: Context, _config: DummyConfig) {
    // 空实现
  },
}

/** 无 schema 的测试插件 */
const plainPlugin = {
  name: 'plain-plugin',
  apply() {
    // 空实现
  },
}

// ─── 辅助 ───────────────────────────────────────────────────────────────────

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) fiber.dispose()
  })
}

async function createConfigContext(): Promise<{ ctx: Context; config: ConfigService }> {
  const ctx = new Context()
  await ctx.plugin(dummyPlugin)
  await ctx.plugin(plainPlugin)
  const config = new ConfigServiceImpl(ctx)
  return { ctx, config }
}

// ─── ConfigServiceImpl ───────────────────────────────────────────────────────

describe('ConfigServiceImpl', () => {
  let ctx: Context
  let config: ConfigService

  beforeEach(async () => {
    const created = await createConfigContext()
    ctx = created.ctx
    config = created.config
  })

  afterEach(() => {
    disposeAll(ctx)
  })

  it('get：未设置时返回 schema 默认值（含嵌套默认）', () => {
    const value = config.get<DummyConfig>('dummy-plugin')
    expect(value.greeting).toBe('Hello')
    expect(value.repeat).toBe(1)
    expect(value.enabled).toBe(true)
    expect(value.nested).toEqual({ flag: false })
  })

  it('get：无 schema 插件返回空对象', () => {
    expect(config.get('plain-plugin')).toEqual({})
  })

  it('get：未知插件返回空对象（不崩）', () => {
    expect(config.get('no-such-plugin')).toEqual({})
  })

  it('set：局部更新合并，不覆盖未触及字段', async () => {
    await config.set('dummy-plugin', { greeting: 'Hi' })
    const value = config.get<DummyConfig>('dummy-plugin')
    expect(value.greeting).toBe('Hi')
    expect(value.repeat).toBe(1)
    expect(value.enabled).toBe(true)
  })

  it('set：嵌套字段深合并', async () => {
    await config.set('dummy-plugin', { nested: { flag: true } })
    const value = config.get<DummyConfig>('dummy-plugin')
    expect(value.nested).toEqual({ flag: true })
  })

  it('onChange：set 触发通知，退订后再 set 不通知', async () => {
    const received: unknown[] = []
    const unsubscribe = config.onChange('dummy-plugin', (value) => received.push(value))
    await config.set('dummy-plugin', { greeting: 'World' })
    expect(received).toHaveLength(1)
    expect((received[0] as DummyConfig).greeting).toBe('World')

    unsubscribe()
    await config.set('dummy-plugin', { greeting: 'Again' })
    expect(received).toHaveLength(1)
  })

  it('onChange：不同插件互不干扰', async () => {
    const received: string[] = []
    config.onChange('dummy-plugin', () => received.push('dummy'))
    await config.set('plain-plugin', { x: 1 })
    expect(received).toHaveLength(0)
  })

  it('set：校验失败时拒绝，且不写入', async () => {
    await expect(config.set('dummy-plugin', { repeat: -5 })).rejects.toThrow()
    const value = config.get<DummyConfig>('dummy-plugin')
    expect(value.repeat).toBe(1)
  })

  it('snapshot：包含已装载的所有带 schema 插件（含默认值）', async () => {
    await config.set('dummy-plugin', { greeting: 'Howdy' })
    const snap = config.snapshot()
    expect((snap['dummy-plugin'] as DummyConfig).greeting).toBe('Howdy')
    expect((snap['dummy-plugin'] as DummyConfig).repeat).toBe(1)
    // 无 schema 也无用户配置的插件不在快照中（没有可导出的配置）
    expect(snap['plain-plugin']).toBeUndefined()
  })

  it('listSchemas：只返回声明了 Config 的已装载插件', () => {
    const schemas = config.listSchemas()
    const names = schemas.map((s) => s.pluginId)
    expect(names).toContain('dummy-plugin')
    expect(names).not.toContain('plain-plugin')
  })

  it('set：变更即热重载——插件以新配置重启', async () => {
    let applyCount = 0
    let lastConfig: DummyConfig | undefined
    const reloadable = {
      name: 'reloadable-plugin',
      Config: dummyConfigSchema,
      apply(_inner: Context, cfg: DummyConfig) {
        applyCount++
        lastConfig = cfg
      },
    }
    await ctx.plugin(reloadable)
    expect(applyCount).toBe(1)

    await config.set('reloadable-plugin', { greeting: 'Reloaded' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(applyCount).toBe(2)
    expect(lastConfig?.greeting).toBe('Reloaded')
  })
})

// ─── 持久化委托 storage ──────────────────────────────────────────────────────

describe('ConfigServiceImpl · 持久化委托 storage', () => {
  it('set 写入 storage 分片，新实例能水合恢复', async () => {
    const backend = new MemoryStorageBackend()

    // 第一「运行」：装载 dummy + storage + config，set 持久化
    const ctx1 = new Context()
    await ctx1.plugin(dummyPlugin)
    new StorageServiceImpl(ctx1, backend)
    const config1 = new ConfigServiceImpl(ctx1)
    await config1.set('dummy-plugin', { greeting: 'Persisted' })

    // storage 中确实落盘了分片与索引
    const stored = (await ctx1.get('storage')!.get('config:dummy-plugin')) as DummyConfig
    expect(stored).toEqual({ greeting: 'Persisted' })
    const index = (await ctx1.get('storage')!.get('config:shards')) as string[]
    expect(index).toContain('dummy-plugin')

    // 第二「运行」：新 context + 同一 backend，config 水合恢复
    const ctx2 = new Context()
    await ctx2.plugin(dummyPlugin)
    new StorageServiceImpl(ctx2, backend)
    const config2 = new ConfigServiceImpl(ctx2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const value = config2.get<DummyConfig>('dummy-plugin')
    expect(value.greeting).toBe('Persisted')
    expect(value.repeat).toBe(1)

    disposeAll(ctx1)
    disposeAll(ctx2)
  })

  it('无 storage 服务：降级为内存，set 不崩', async () => {
    const created = await createConfigContext()
    await created.config.set('plain-plugin', { v: 1 })
    expect(created.config.get('plain-plugin')).toEqual({ v: 1 })
    disposeAll(created.ctx)
  })
})

// ─── 插件级导出 ──────────────────────────────────────────────────────────────

describe('plugin-config 导出', () => {
  it('导出 name / provide / apply', () => {
    expect(configPlugin.name).toBe('@xyq-box/plugin-config')
    expect(configPlugin.provide).toContain('config')
    expect(typeof configPlugin.apply).toBe('function')
  })

  it('装载后 ctx.config 可用，卸载后消失', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(configPlugin)
    expect(ctx.config).toBeDefined()
    expect(typeof ctx.config.get).toBe('function')
    expect(typeof ctx.config.set).toBe('function')
    expect(typeof ctx.config.onChange).toBe('function')
    expect(typeof ctx.config.snapshot).toBe('function')
    await fiber.dispose()
    expect(ctx.config).toBeUndefined()
    disposeAll(ctx)
  })
})
