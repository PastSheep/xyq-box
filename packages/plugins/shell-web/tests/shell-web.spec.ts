/**
 * @xyq-box/plugin-shell-web —— 冒烟测试（M1 Web 壳）
 *
 * 浏览器内核引导链路（Node 环境 + DOM 桩，无真实浏览器）：
 * bootstrap(manifest + loader) → 装载 shell-web → system 服务就绪 →
 * root slot 视图注册（views 桩）→ React UI 根挂载（react-dom 桩）→
 * 卸载后 system 服务消失。
 */

import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootstrap } from '@xyq-box/core'
import * as shellPlugin from '../src/index.js'
import { SystemServiceImpl } from '../src/system.js'

// react-dom/client 桩：不真实渲染 DOM
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: vi.fn(), unmount: vi.fn() }),
}))

// ─── DOM 桩 ──────────────────────────────────────────────────────────────────

interface DomStub {
  doc: {
    title: string
    getElementById: ReturnType<typeof vi.fn>
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
  }
  win: {
    navigator: { onLine: boolean; maxTouchPoints: number }
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
    matchMedia: ReturnType<typeof vi.fn>
  }
  mountEl: object
}

function stubDom(): DomStub {
  const mountEl = { tagName: 'DIV' }
  const doc = {
    title: '',
    visibilityState: 'visible',
    getElementById: vi.fn((id: string) => (id === 'root' ? mountEl : null)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const win = {
    navigator: { onLine: true, maxTouchPoints: 0 },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: vi.fn(() => ({ matches: false })),
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  // Node 21+ 自带全局 navigator（无 onLine），桩掉避免干扰
  vi.stubGlobal('navigator', { onLine: true, maxTouchPoints: 0 })
  return { doc, win, mountEl }
}

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) {
      fiber.dispose()
    }
  })
}

// ─── system 服务 ─────────────────────────────────────────────────────────────

describe('system 服务（浏览器能力代理）', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
  })

  afterEach(() => {
    disposeAll(ctx)
    vi.unstubAllGlobals()
  })

  it('在 Node 环境创建不崩溃，暴露能力代理', () => {
    new SystemServiceImpl(ctx)
    // cordis 经代理暴露服务（非同一对象引用），按形状断言
    expect(ctx.system).toBeDefined()
    expect(ctx.system.platform).toBe('web')
    expect(typeof ctx.system.notification.isSupported).toBe('function')
    // 非浏览器环境：能力探测降级而非崩溃
    expect(ctx.system.notification.isSupported()).toBe(false)
    expect(() => ctx.system.window).toThrow()
    expect(() => ctx.system.document).toThrow()
  })

  it('浏览器环境（DOM 桩）：可订阅在线状态变更', () => {
    stubDom()
    const impl = new SystemServiceImpl(ctx)
    const states: boolean[] = []
    impl.onOnlineChange((online) => states.push(online))
    expect(ctx.system.online).toBe(true)
    // 桩的监听器不触发，仅验证订阅 API 可用
    expect(typeof impl.onOnlineChange).toBe('function')
  })
})

// ─── 浏览器内核引导链路 ───────────────────────────────────────────────────────

describe('浏览器内核引导（DOM 桩）', () => {
  let dom: DomStub

  beforeEach(() => {
    dom = stubDom()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bootstrap(manifest + loader) 装载 shell-web：system 就绪、UI 根挂载、标题设置', async () => {
    const kernel = await bootstrap({
      basePath: '/',
      manifest: {
        plugins: [
          {
            name: '@xyq-box/plugin-shell-web',
            config: { mountPoint: 'root', title: 'xyq-box' },
          },
        ],
      },
      loader: async (name) => {
        if (name === '@xyq-box/plugin-shell-web') {
          return shellPlugin as unknown as Record<string, unknown>
        }
        throw new Error('unexpected plugin: ' + name)
      },
    })

    // system 服务就绪
    const system = kernel.ctx.get('system')
    expect(system).toBeDefined()
    expect(system!.platform).toBe('web')

    // 页面标题写入
    expect(dom.doc.title).toBe('xyq-box')

    // React UI 根挂载：createRoot(getElementById('root'))
    expect(dom.doc.getElementById).toHaveBeenCalledWith('root')

    // 插件状态 ACTIVE
    const status = kernel.plugins.getPluginStatus('@xyq-box/plugin-shell-web')
    expect(status?.state).toBe(2)
    expect(status?.stateLabel).toBe('ACTIVE')

    // 卸载 → system 服务消失
    await kernel.plugins.unmount('@xyq-box/plugin-shell-web')
    expect(kernel.ctx.get('system')).toBeUndefined()
  })

  it('views 服务可用时注册 root slot 视图（占据 root slot）', async () => {
    // 先以空清单引导，注入 views 桩服务后再装载 shell-web
    const kernel = await bootstrap({
      basePath: '/',
      manifest: { plugins: [] },
      loader: async () => shellPlugin as unknown as Record<string, unknown>,
    })

    const registered: unknown[] = []
    kernel.ctx.provide('views', {
      register: (descriptor: unknown) => {
        registered.push(descriptor)
        return () => {}
      },
      list: () => [],
      onChange: () => () => {},
    })

    await kernel.plugins.mount('@xyq-box/plugin-shell-web')

    // root slot 描述符已注册（id 全局唯一、slots 含 root、组件为 ShellApp）
    expect(registered).toHaveLength(1)
    const descriptor = registered[0] as { id: string; slots: string[]; component: unknown }
    expect(descriptor.id).toBe('@xyq-box/plugin-shell-web/root')
    expect(descriptor.slots).toContain('root')
    expect(descriptor.component).toBeTypeOf('function')

    await kernel.plugins.unmount('@xyq-box/plugin-shell-web')
  })
})
