/**
 * @xyq-box/plugin-views —— 视图服务冒烟测试
 *
 * 覆盖：
 * - register 注册/退订（effect 语义）
 * - list 按 slot 查询与排序
 * - onChange 订阅通知
 * - 同时兼容 slots 数组与 slot 单数字段
 * - 重复注册覆盖
 * - 插件卸载自动清理
 */

import { Context, Service } from 'cordis'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { ViewsServiceImpl, type ViewsService, type ViewDescriptor } from '../src/index.js'

// plug-views 导出类型检查
import * as viewsPlugin from '../src/index.js'

// ─── 辅助 ───────────────────────────────────────────────────────────────────

function createContext(): Context {
  const ctx = new Context()
  ctx.provide('logger', ctx.logger)
  return ctx
}

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) {
      fiber.dispose()
    }
  })
}

// ─── ViewsServiceImpl ────────────────────────────────────────────────────────

describe('ViewsServiceImpl', () => {
  let ctx: Context
  let views: ViewsService

  beforeEach(() => {
    ctx = createContext()
    views = new ViewsServiceImpl(ctx)
  })

  afterEach(() => {
    disposeAll(ctx)
  })

  it('register adds descriptor to slot', () => {
    const desc: ViewDescriptor = {
      id: 'test.view1',
      slot: 'sidebar',
      title: 'Test View',
      order: 10,
    }
    const dispose = views.register(desc)
    const list = views.list('sidebar')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('test.view1')
    expect(list[0]!.title).toBe('Test View')
    dispose()
  })

  it('register returns disposer that removes the view', () => {
    const dispose = views.register({ id: 'v1', slot: 'panel' })
    expect(views.list('panel')).toHaveLength(1)
    dispose()
    expect(views.list('panel')).toHaveLength(0)
  })

  it('list returns empty for unknown slot', () => {
    const list = views.list('nonexistent')
    expect(list).toEqual([])
  })

  it('list sorts by order', () => {
    views.register({ id: 'v3', slot: 'toolbar', order: 30 })
    views.register({ id: 'v1', slot: 'toolbar', order: 10 })
    views.register({ id: 'v2', slot: 'toolbar', order: 20 })
    const list = views.list('toolbar')
    expect(list.map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
  })

  it('lists views without order last', () => {
    views.register({ id: 'va', slot: 'statusbar', order: 5 })
    views.register({ id: 'vb', slot: 'statusbar' })
    views.register({ id: 'vc', slot: 'statusbar', order: 1 })
    const list = views.list('statusbar')
    expect(list[0]!.id).toBe('vc')
    expect(list[1]!.id).toBe('va')
    expect(list[2]!.id).toBe('vb')
  })

  it('supports slots array (sdk defineView compat)', () => {
    views.register({ id: 'multi', slots: ['sidebar', 'panel'], title: 'Multi' })
    expect(views.list('sidebar')).toHaveLength(1)
    expect(views.list('panel')).toHaveLength(1)
    expect(views.list('toolbar')).toHaveLength(0)
  })

  it('removes from all slots on disposer', () => {
    const dispose = views.register({ id: 'multi', slots: ['sidebar', 'panel'] })
    expect(views.list('sidebar')).toHaveLength(1)
    expect(views.list('panel')).toHaveLength(1)
    dispose()
    expect(views.list('sidebar')).toHaveLength(0)
    expect(views.list('panel')).toHaveLength(0)
  })

  it('re-register by same id overwrites', () => {
    views.register({ id: 'v1', slot: 'sidebar', title: 'First' })
    views.register({ id: 'v1', slot: 'sidebar', title: 'Second' })
    const list = views.list('sidebar')
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('Second')
  })

  it('onChange fires on register', () => {
    const changes: string[] = []
    const dispose = views.onChange(() => {
      changes.push('changed')
    })
    expect(changes).toHaveLength(0)
    views.register({ id: 'v1', slot: 'sidebar' })
    expect(changes).toHaveLength(1)
    dispose()
  })

  it('onChange fires on unregister', () => {
    const changes: string[] = []
    views.onChange(() => {
      changes.push('changed')
    })
    const dispose = views.register({ id: 'v1', slot: 'sidebar' })
    expect(changes).toHaveLength(1)
    dispose()
    expect(changes).toHaveLength(2)
  })

  it('onChange disposer stops notifications', () => {
    const changes: string[] = []
    const disposeOn = views.onChange(() => {
      changes.push('changed')
    })
    views.register({ id: 'v1', slot: 'sidebar' })
    expect(changes).toHaveLength(1)
    disposeOn()
    views.register({ id: 'v2', slot: 'sidebar' })
    expect(changes).toHaveLength(1)
  })

  it('handles register without slot gracefully', () => {
    const dispose = views.register({ id: 'noslot' })
    expect(views.list('sidebar')).toHaveLength(0)
    // disposer should be no-op
    dispose()
  })

  it('filters by visible predicate', () => {
    views.register({ id: 'visible', slot: 'sidebar', visible: () => true })
    views.register({ id: 'hidden', slot: 'sidebar', visible: () => false })
    const all = views.list('sidebar')
    const visible = all.filter((v) => !v.visible || v.visible())
    expect(visible).toHaveLength(1)
    expect(visible[0]!.id).toBe('visible')
  })
})

// ─── 插件级导出 ──────────────────────────────────────────────────────────────

describe('plugin-views 导出', () => {
  it('导出 name / provide / apply', () => {
    expect(viewsPlugin.name).toBe('@xyq-box/plugin-views')
    expect(viewsPlugin.provide).toContain('views')
    expect(typeof viewsPlugin.apply).toBe('function')
  })

  it('装载后 ctx.views 可用', async () => {
    const ctx = createContext()
    await ctx.plugin(viewsPlugin)
    expect(ctx.views).toBeDefined()
    expect(typeof ctx.views.register).toBe('function')
    expect(typeof ctx.views.list).toBe('function')
    expect(typeof ctx.views.onChange).toBe('function')
    disposeAll(ctx)
  })

  it('卸载后 ctx.views 消失', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(viewsPlugin)
    expect(ctx.views).toBeDefined()
    await fiber.dispose()
    expect(ctx.views).toBeUndefined()
    disposeAll(ctx)
  })
})
