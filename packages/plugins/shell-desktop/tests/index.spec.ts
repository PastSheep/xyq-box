/**
 * @xyq-box/plugin-shell-desktop —— 插件冒烟测试
 *
 * 非 Electron 环境（vitest）下验证桌面清单引导链路：
 * bootstrap(manifest + loader) → 装载 shell-desktop → system/window/tray 服务
 * 就绪 → '/shell-desktop' RPC 端点可调用 → 卸载后服务消失。
 */

import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { bootstrap } from '@xyq-box/core'
import * as desktopPlugin from '../src/index.js'

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) {
      fiber.dispose()
    }
  })
}

describe('plugin-shell-desktop（非 Electron 环境冒烟）', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
  })

  afterEach(() => {
    disposeAll(ctx)
  })

  it('bootstrap 装载 shell-desktop：system/window/tray 就绪，RPC 端点可用', async () => {
    const kernel = await bootstrap({
      basePath: '/',
      manifest: {
        plugins: [
          {
            name: '@xyq-box/plugin-shell-desktop',
            config: { windowTitle: 'xyq-box', windowWidth: 1200, windowHeight: 800 },
          },
        ],
      },
      loader: async (name) => {
        if (name === '@xyq-box/plugin-shell-desktop') {
          return desktopPlugin as unknown as Record<string, unknown>
        }
        throw new Error('unexpected plugin: ' + name)
      },
    })

    const kernelCtx = kernel.ctx

    // 三个服务全部就绪
    expect(kernelCtx.system).toBeDefined()
    expect(kernelCtx.system.platform).toBe('desktop')
    expect(kernelCtx.window).toBeDefined()
    expect(kernelCtx.tray).toBeDefined()

    // '/shell-desktop' RPC 端点
    const info = await kernelCtx.connection.rpc.call('/shell-desktop', 'system.info', null)
    expect(info.ok).toBe(true)
    if (info.ok) {
      expect(info.value).toMatchObject({ platform: 'desktop' })
    }

    // window.list：非 Electron 环境降级返回空列表
    const list = await kernelCtx.connection.rpc.call('/shell-desktop', 'window.list', null)
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.value).toEqual([])
    }

    // 未知端点
    const unknown = await kernelCtx.connection.rpc.call('/shell-desktop', 'nope', null)
    expect(unknown.ok).toBe(false)

    // 插件状态 ACTIVE
    const status = kernel.plugins.getPluginStatus('@xyq-box/plugin-shell-desktop')
    expect(status?.state).toBe(2)
    expect(status?.stateLabel).toBe('ACTIVE')

    // 卸载 → 服务消失
    await kernel.plugins.unmount('@xyq-box/plugin-shell-desktop')
    expect(kernelCtx.get('system')).toBeUndefined()
    expect(kernelCtx.get('window')).toBeUndefined()
    expect(kernelCtx.get('tray')).toBeUndefined()
  })
})
