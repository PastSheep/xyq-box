/**
 * @xyq-box/plugin-layout —— LayoutService 冒烟测试
 *
 * 覆盖：
 * - 构造后 ctx.layout 可用
 * - setSidebar 状态更新 + onChange 通知
 * - dock/undock 停靠覆盖
 * - 插件卸载自动清理
 *
 * 注意：localStorage 不可用时（Node）静默降级。
 */

import { Context } from 'cordis'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { LayoutServiceImpl, type LayoutService } from '../src/layout.js'
import * as layoutPlugin from '../src/index.js'

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

// ─── LayoutServiceImpl ───────────────────────────────────────────────────────

describe('LayoutServiceImpl', () => {
  let ctx: Context
  let layout: LayoutService

  beforeEach(() => {
    ctx = createContext()
    layout = new LayoutServiceImpl(ctx)
  })

  afterEach(() => {
    disposeAll(ctx)
  })

  it('exposes default state', () => {
    const state = layout.getState()
    expect(state.sidebar.collapsed).toBe(false)
    expect(state.sidebar.width).toBeGreaterThan(0)
    expect(state.docking).toEqual({})
  })

  it('setSidebar updates collapsed state and notifies', () => {
    const states: string[] = []
    layout.onChange(() => {
      states.push(JSON.stringify(layout.getState().sidebar))
    })
    layout.setSidebar({ collapsed: true })
    expect(layout.getState().sidebar.collapsed).toBe(true)
    expect(states).toHaveLength(1)
  })

  it('setSidebar updates width', () => {
    layout.setSidebar({ width: 320 })
    expect(layout.getState().sidebar.width).toBe(320)
  })

  it('dock records docking override', () => {
    layout.dock('view-a', 'sidebar')
    expect(layout.getState().docking['view-a']).toBe('sidebar')
  })

  it('undock removes docking override', () => {
    layout.dock('view-a', 'sidebar')
    expect(layout.getState().docking['view-a']).toBe('sidebar')
    layout.undock('view-a')
    expect(layout.getState().docking['view-a']).toBeUndefined()
  })

  it('reset restores defaults', () => {
    layout.setSidebar({ collapsed: true, width: 500 })
    layout.dock('view-a', 'sidebar')
    layout.reset()
    const state = layout.getState()
    expect(state.sidebar.collapsed).toBe(false)
    expect(state.docking).toEqual({})
  })

  it('onChange disposer stops notifications', () => {
    let notified = 0
    const dispose = layout.onChange(() => {
      notified++
    })
    layout.setSidebar({ collapsed: true })
    expect(notified).toBe(1)
    dispose()
    layout.setSidebar({ collapsed: false })
    expect(notified).toBe(1)
  })
})

// ─── 插件级导出 ──────────────────────────────────────────────────────────────

describe('plugin-layout 导出', () => {
  it('导出 name / provide / apply', () => {
    expect(layoutPlugin.name).toBe('@xyq-box/plugin-layout')
    expect(layoutPlugin.provide).toContain('layout')
    expect(typeof layoutPlugin.apply).toBe('function')
  })

  it('装载后 ctx.layout 可用，卸载后消失', async () => {
    const ctx = createContext()
    // 提供视图服务桩（layout 依赖 views?）
    ctx.provide('views', {
      register: () => () => {},
      list: () => [],
      onChange: () => () => {},
    })
    const fiber = await ctx.plugin(layoutPlugin)
    expect(ctx.layout).toBeDefined()
    expect(typeof ctx.layout.getState).toBe('function')
    expect(typeof ctx.layout.dock).toBe('function')
    await fiber.dispose()
    expect(ctx.layout).toBeUndefined()
  })
})
