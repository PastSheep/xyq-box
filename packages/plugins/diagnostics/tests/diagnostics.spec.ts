/**
 * @xyq-box/plugin-diagnostics —— 单测
 *
 * 契约：
 * - DiagnosticsController：从 registry 读取插件状态（含 inject/provide/error/waiting）；
 * - fiber 状态事件（internal/status）触发 refresh + 通知；
 * - 日志环形缓冲：初始快照 + exporter 实时推送 + maxLogs 裁剪；
 * - buildGraph：inject/provide 服务名匹配生成依赖边；
 * - layoutGraph：分层布局（无入边节点第 0 层）；
 * - 插件装载：logger 可用时注册 panel 视图；views 缺失时降级不崩溃。
 */
import { Context, Service } from 'cordis'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import * as plugin from '../src/index.js'
import {
  DiagnosticsController,
  buildGraph,
  layoutGraph,
  type DiagnosticsPluginStatus,
} from '../src/diagnostics.js'

// ─── 辅助 ───────────────────────────────────────────────────────────────────

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

// ─── 测试用服务 ──────────────────────────────────────────────────────────────

class StorageSvc extends Service {
  constructor(ctx: Context) {
    super(ctx, 'storage')
  }
}

// ─── DiagnosticsController ──────────────────────────────────────────────────

describe('DiagnosticsController', () => {
  it('从 registry 收集插件状态（name/state/stateLabel/inject/provide）', async () => {
    const ctx = createContext()
    const provider = {
      name: 'storage-plugin',
      provide: ['storage'],
      apply: (inner: Context) => {
        new StorageSvc(inner)
      },
    }
    const consumer = {
      name: 'consumer-plugin',
      inject: ['storage'],
      apply: () => {},
    }
    await ctx.plugin(provider)
    await ctx.plugin(consumer)

    const ctrl = new DiagnosticsController(ctx)
    const statuses = ctrl.statuses
    const storagePlugin = statuses.find((s) => s.name === 'storage-plugin')
    const consumerPlugin = statuses.find((s) => s.name === 'consumer-plugin')

    expect(storagePlugin).toBeDefined()
    expect(storagePlugin!.stateLabel).toBe('ACTIVE')
    expect(storagePlugin!.provide).toContain('storage')

    expect(consumerPlugin).toBeDefined()
    expect(consumerPlugin!.inject).toContain('storage')
    expect(consumerPlugin!.stateLabel).toBe('ACTIVE')

    ctrl.dispose()
    disposeAll(ctx)
  })

  it('inject 缺失服务 → PENDING + waiting', async () => {
    const ctx = createContext()
    const consumer = {
      name: 'ghost-consumer',
      inject: ['nonexistent-service'],
      apply: () => {},
    }
    await ctx.plugin(consumer)

    const ctrl = new DiagnosticsController(ctx)
    const status = ctrl.statuses.find((s) => s.name === 'ghost-consumer')
    expect(status).toBeDefined()
    expect(status!.stateLabel).toBe('PENDING')
    expect(status!.waiting).toBe(true)
    expect(status!.inject).toContain('nonexistent-service')

    ctrl.dispose()
    disposeAll(ctx)
  })

  it('fiber 状态事件触发 refresh + 通知', async () => {
    const ctx = createContext()
    const ctrl = new DiagnosticsController(ctx)
    const listener = vi.fn()
    const dispose = ctrl.subscribe(listener)
    expect(ctrl.statuses.length).toBe(0)

    const fiber = await ctx.plugin({ name: 'later', apply: () => {} })
    expect(ctrl.statuses.some((s) => s.name === 'later')).toBe(true)
    expect(listener).toHaveBeenCalled()

    dispose()
    await fiber.dispose()
    ctrl.dispose()
    disposeAll(ctx)
  })

  it('submit 后 dispose 清理订阅', async () => {
    const ctx = createContext()
    const ctrl = new DiagnosticsController(ctx)
    const listener = vi.fn()
    ctrl.subscribe(listener)
    ctrl.dispose()
    // dispose 后手动 refresh 不再通知（listeners 已清空）
    ctrl.refresh()
    expect(listener).not.toHaveBeenCalled()
    disposeAll(ctx)
  })

  it('日志：初始缓冲快照 + exporter 实时推送 + maxLogs 裁剪', () => {
    const ctx = createContext()
    const log = ctx.logger('diag-test')
    log.info('before controller %s', 'x')
    expect(ctx.logger.buffer.length).toBeGreaterThan(0)

    const ctrl = new DiagnosticsController(ctx, { maxLogs: 10 })
    expect(ctrl.logs.length).toBeGreaterThan(0)
    expect(ctrl.logs[ctrl.logs.length - 1]!.text).toContain('before controller')

    // exporter 实时推送
    log.warn('after controller')
    expect(ctrl.logs[ctrl.logs.length - 1]!.type).toBe('warn')
    expect(ctrl.logs[ctrl.logs.length - 1]!.text).toContain('after controller')

    // maxLogs 裁剪
    for (let i = 0; i < 20; i++) {
      log.info('bulk %d', i)
    }
    expect(ctrl.logs.length).toBeLessThanOrEqual(10)
    expect(ctrl.logs[ctrl.logs.length - 1]!.text).toContain('bulk 19')

    ctrl.dispose()
    disposeAll(ctx)
  })
})

// ─── buildGraph ──────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('inject 命中的服务生成依赖边', () => {
    const statuses: DiagnosticsPluginStatus[] = [
      {
        name: 'a',
        state: 2,
        stateLabel: 'ACTIVE',
        inject: ['storage'],
        provide: [],
      },
      {
        name: 'b',
        state: 2,
        stateLabel: 'ACTIVE',
        inject: [],
        provide: ['storage'],
      },
      {
        name: 'c',
        state: 0,
        stateLabel: 'PENDING',
        inject: ['views'],
        provide: [],
      },
    ]
    const graph = buildGraph(statuses)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toEqual({ source: 'a', target: 'b', service: 'storage' })
    // 未命中的服务不出边
    expect(graph.edges.some((e) => e.service === 'views')).toBe(false)
  })

  it('自依赖与重复边去重', () => {
    const statuses: DiagnosticsPluginStatus[] = [
      { name: 'x', state: 2, stateLabel: 'ACTIVE', inject: ['svc', 'svc'], provide: ['svc'] },
    ]
    const graph = buildGraph(statuses)
    expect(graph.edges).toHaveLength(0) // 自依赖忽略
  })
})

// ─── layoutGraph ────────────────────────────────────────────────────────────

describe('layoutGraph', () => {
  it('无入边节点在第 0 层，依赖者层数递增', () => {
    const statuses: DiagnosticsPluginStatus[] = [
      { name: 's', state: 2, stateLabel: 'ACTIVE', inject: [], provide: ['svc'] },
      { name: 'c', state: 2, stateLabel: 'ACTIVE', inject: ['svc'], provide: [] },
    ]
    const laid = layoutGraph(buildGraph(statuses))
    expect(laid).toHaveLength(2)
    const s = laid.find((n) => n.id === 's')!
    const c = laid.find((n) => n.id === 'c')!
    expect(s.y).toBe(0)
    expect(c.y).toBeGreaterThan(s.y)
  })

  it('空图返回空数组', () => {
    expect(layoutGraph({ nodes: [], edges: [] })).toEqual([])
  })
})

// ─── 插件导出 ────────────────────────────────────────────────────────────────

describe('@xyq-box/plugin-diagnostics', () => {
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

  beforeEach(() => {
    registeredViews.length = 0
    viewsDisposerRan = false
  })

  it('导出 name / Config / apply', () => {
    expect(plugin.name).toBe('@xyq-box/plugin-diagnostics')
    expect(plugin.Config).toBeDefined()
    expect(typeof plugin.apply).toBe('function')
  })

  it('views 可用：注册 panel 视图 + 收集诊断状态', async () => {
    const ctx = createContext()
    ctx.provide('views', viewsMock as never)

    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(2) // ACTIVE
    expect(registeredViews).toHaveLength(1)
    expect(registeredViews[0]!.id).toBe('@xyq-box/plugin-diagnostics/panel')
    expect(registeredViews[0]!.slots).toContain('panel')
    expect(registeredViews[0]!.component).toBeDefined()

    // 控制器可用：能从当前 registry 收集状态
    const { getController } = await import('../src/diagnostics.js')
    expect(getController()).not.toBeNull()

    await fiber.dispose()
    expect(viewsDisposerRan).toBe(true)
    // 卸载后控制器清理
    expect(getController()).toBeNull()
    disposeAll(ctx)
  })

  it('views 缺失：降级打日志不崩溃', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(plugin)
    expect(fiber.state).toBe(2)
    expect(registeredViews).toHaveLength(0)
    await fiber.dispose()
    disposeAll(ctx)
  })
})
