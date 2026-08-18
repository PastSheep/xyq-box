/**
 * @xyq-box/plugin-shell-web —— IpcConnectionService（渲染进程 Electron IPC 传输）
 *
 * docs/02 §3.1「传输实现可换」：同一份 UI（本插件）在浏览器部署用进程内直通
 * （core 默认 ConnectionServiceImpl），在 Electron 桌面部署时由
 * plugin-shell-desktop 的 preload 注入 window.xyqBridge（contextBridge + ipcRenderer），
 * 本类把 connection 服务换成 IPC 传输 —— 插件调用 API 零感知（docs/04 §8）。
 *
 * 约定：
 * - 无参数 RPC payload 必须传 null（docs/02 §3.1 / docs/04 §8）；
 * - { ok: false } 必须落日志，不静默吞掉；
 * - 本地端点优先（渲染进程内自给自足），未命中再走 IPC 到主进程内核。
 */

import { Context, Service } from 'cordis'
import type { ConnectionService, RpcResult } from '@xyq-box/core'

// ─── preload 注入的桥（plugin-shell-desktop 提供） ────────────────────────────

export interface XyqBridgePush {
  channel: string
  event: string
  payload: unknown
}

export interface XyqBridge {
  /** 部署平台标识 */
  platform: 'desktop'
  /** RPC：渲染 → 主进程（经 ipcRenderer.invoke） */
  rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult>
  }
  /** 推送订阅（主进程 → 渲染，经 ipcRenderer.on）；返回退订函数 */
  onPush(handler: (message: XyqBridgePush) => void): () => void
}

declare global {
  interface Window {
    /** plugin-shell-desktop 的 preload 注入；浏览器部署时不存在 */
    xyqBridge?: XyqBridge
  }
}

interface Endpoint {
  handler: (endpoint: string, payload: unknown) => Promise<RpcResult>
  authority: 'loopback' | 'any'
}

/** 渲染进程的 connection 实现：本地端点优先，未命中经 IPC 转发主进程 */
export class IpcConnectionService extends Service implements ConnectionService {
  /** 本地端点（渲染进程内注册） */
  private endpoints = new Map<string, Set<Endpoint>>()
  /** 推送订阅者（channel → handler 集合） */
  private pushListeners = new Map<string, Set<(event: string, payload: unknown) => void>>()
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context, private bridge: XyqBridge) {
    super(ctx, 'connection')
    this.logger = ctx.logger('connection:ipc')

    // 主进程推送 → 本地订阅者（effect 语义，插件卸载自动退订）
    ctx.effect(() => {
      const dispose = this.bridge.onPush(({ channel, event, payload }) => {
        const listeners = this.pushListeners.get(channel)
        if (!listeners) return
        for (const listener of [...listeners]) listener(event, payload)
      })
      return () => dispose()
    })
    this.logger.info('connection service created (transport: electron-ipc)')
  }

  rpc = {
    handle: (
      channel: string,
      handler: (endpoint: string, payload: unknown) => Promise<RpcResult>,
      opts?: { authority?: 'loopback' | 'any' },
    ): (() => void) => {
      const endpoint: Endpoint = {
        handler,
        authority: opts?.authority ?? 'loopback',
      }
      let set = this.endpoints.get(channel)
      if (!set) {
        set = new Set()
        this.endpoints.set(channel, set)
      }
      set.add(endpoint)
      return () => {
        set!.delete(endpoint)
        if (set!.size === 0) this.endpoints.delete(channel)
      }
    },

    call: async (channel: string, endpoint: string, payload: unknown): Promise<RpcResult> => {
      if (payload === undefined) {
        return { ok: false, error: 'RPC payload must not be undefined; pass null for no arguments' }
      }
      // 1. 本地端点优先（渲染进程内自给自足，如 UI 插件的进程内端点）
      const local = this.endpoints.get(channel)
      if (local && local.size > 0) {
        const [endpointImpl] = [...local].slice(-1)
        try {
          return await endpointImpl!.handler(endpoint, payload)
        } catch (error) {
          this.logger.warn('rpc.call(local): handler threw', error)
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }
      // 2. 未命中 → Electron IPC 转发主进程内核（docs/02 §3.1 桌面传输）
      try {
        const result = await this.bridge.rpc.call(channel, endpoint, payload)
        if (!result.ok) {
          this.logger.warn('rpc.call(%s/%s) over IPC failed: %s', channel, endpoint, result.error)
        }
        return result
      } catch (error) {
        this.logger.warn('rpc.call(%s/%s) over IPC threw', channel, endpoint, error)
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  push(channel: string, event: string, payload?: unknown): void {
    // 渲染进程 → 主进程的推送当前仅做本地通知（UI 插件一般不需要反向推送）
    const listeners = this.pushListeners.get(channel)
    if (!listeners) return
    for (const listener of [...listeners]) listener(event, payload ?? null)
  }

  onPush(channel: string, handler: (event: string, payload: unknown) => void): () => void {
    let set = this.pushListeners.get(channel)
    if (!set) {
      set = new Set()
      this.pushListeners.set(channel, set)
    }
    set.add(handler)
    return () => {
      set!.delete(handler)
      if (set!.size === 0) this.pushListeners.delete(channel)
    }
  }
}

/** 从 window 上取桥（浏览器部署返回 undefined） */
export function detectBridge(): XyqBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.xyqBridge
}
