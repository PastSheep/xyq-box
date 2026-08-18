/**
 * @xyq-box/plugin-shell-web —— IpcConnectionService 单测
 *
 * 验证 Electron IPC 传输（渲染进程侧）：
 * 本地端点优先、未命中经桥转发、推送订阅与退订、bridge 缺失时降级。
 */

import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcConnectionService, type XyqBridge } from '../src/web/ipc-connection.js'

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) {
      fiber.dispose()
    }
  })
}

function createFakeBridge() {
  const pushListeners = new Set<(message: XyqBridgePush) => void>()
  const bridge: XyqBridge = {
    platform: 'desktop',
    rpc: {
      call: vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
        return { ok: true, value: { channel, endpoint, payload } }
      }),
    },
    onPush: (handler) => {
      pushListeners.add(handler)
      return () => {
        pushListeners.delete(handler)
      }
    },
  }
  const emitPush = (message: XyqBridgePush) => {
    for (const listener of [...pushListeners]) listener(message)
  }
  return { bridge, emitPush, pushListeners }
}

describe('IpcConnectionService（Electron IPC 传输）', () => {
  let ctx: Context
  let fake: ReturnType<typeof createFakeBridge>

  beforeEach(() => {
    ctx = new Context()
    fake = createFakeBridge()
  })

  afterEach(() => {
    disposeAll(ctx)
  })

  it('注册 connection 服务；本地端点优先，未命中经 IPC 桥转发', async () => {
    const svc = new IpcConnectionService(ctx, fake.bridge)
    expect(ctx.connection).toBeDefined()

    // 本地端点
    const dispose = svc.rpc.handle('/local', async () => ({ ok: true, value: 'local-value' }))
    const local = await ctx.connection.rpc.call('/local', 'ping', null)
    expect(local).toEqual({ ok: true, value: 'local-value' })
    expect(fake.bridge.rpc.call).not.toHaveBeenCalled()

    // IPC 转发
    const remote = await ctx.connection.rpc.call('/remote', 'hello', { a: 1 })
    expect(remote.ok).toBe(true)
    expect(fake.bridge.rpc.call).toHaveBeenCalledWith('/remote', 'hello', { a: 1 })

    dispose()
  })

  it('payload 为 undefined 时拒绝（约定：无参数必须传 null）', async () => {
    new IpcConnectionService(ctx, fake.bridge)
    const result = await ctx.connection.rpc.call('/any', 'x', undefined as unknown as null)
    expect(result.ok).toBe(false)
    expect(fake.bridge.rpc.call).not.toHaveBeenCalled()
  })

  it('主进程推送 → onPush 订阅者收到（effect 语义退订）', () => {
    const svc = new IpcConnectionService(ctx, fake.bridge)
    const events: Array<{ event: string; payload: unknown }> = []
    const dispose = svc.onPush('/news', (event, payload) => {
      events.push({ event, payload })
    })
    fake.emitPush({ channel: '/news', event: 'update', payload: { n: 1 } })
    expect(events).toEqual([{ event: 'update', payload: { n: 1 } }])

    // 退订后不再收到
    dispose()
    fake.emitPush({ channel: '/news', event: 'update', payload: { n: 2 } })
    expect(events).toHaveLength(1)
  })

})
