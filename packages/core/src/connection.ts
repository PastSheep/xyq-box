/**
 * @xyq-box/core — connection 服务（内核内置 RPC 桥，docs/02 §3.1 与 docs/04 §8）
 *
 * connection 是内核唯一内置的服务：它是「内核 ↔ 部署入口 / Node half ↔ Web half」的
 * 通信契约，不参与服务替换（docs/04 §1 例外项）。
 *
 * 约定（沿自 DSH 生态实测）：
 * - payload 必须可 JSON 序列化；**无参数传 `null`，绝不传 `undefined`**
 *   （undefined 会被 JSON 序列化省略键，导致对端校验失败）；
 * - 端点注册是 effect，插件卸载自动撤销；
 * - 传输实现可换：Web 部署用进程内直通（本实现），桌面部署用 Electron IPC，插件零感知。
 */

import { Context, Service } from 'cordis'

import type { ConnectionService, RpcResult } from './types.js'

interface Endpoint {
  handler: (endpoint: string, payload: unknown) => Promise<RpcResult>
  authority: 'loopback' | 'any'
}

export class ConnectionServiceImpl extends Service implements ConnectionService {
  /** 通道 → 端点注册表 */
  private endpoints = new Map<string, Set<Endpoint>>()

  /** 推送事件订阅者 */
  private pushListeners = new Map<string, Set<(event: string, payload: unknown) => void>>()

  /** 跨进程推送转发（桌面 IPC 传输用：主进程 → 渲染进程） */
  private pushRelays = new Set<(channel: string, event: string, payload: unknown) => void>()

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
      // effect 语义：返回退订函数，插件卸载时随 fiber 自动清理
      return () => {
        set!.delete(endpoint)
        if (set!.size === 0) this.endpoints.delete(channel)
      }
    },

    call: async (channel: string, endpoint: string, payload: unknown): Promise<RpcResult> => {
      if (payload === undefined) {
        // RPC payload 约定：无参数必须传 null（docs/02 §3.1）
        return { ok: false, error: 'RPC payload must not be undefined; pass null for no arguments' }
      }
      // 进程内直通：当前实现单进程，仅一个端点实现可取（Web-only 部署）
      const set = this.endpoints.get(channel)
      if (!set || set.size === 0) {
        return { ok: false, error: `no endpoint registered for channel '${channel}'` }
      }
      const [endpointImpl] = [...set].slice(-1)
      try {
        return await endpointImpl!.handler(endpoint, payload)
      } catch (error) {
        this.ctx.logger.warn('rpc.call: handler threw', error)
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  push(channel: string, event: string, payload?: unknown): void {
    const value = payload ?? null
    const listeners = this.pushListeners.get(channel)
    if (listeners) {
      for (const listener of [...listeners]) {
        listener(event, value)
      }
    }
    // 跨进程转发（桌面 IPC 传输，effect 注册于插件卸载自动撤销）
    for (const relay of [...this.pushRelays]) {
      relay(channel, event, value)
    }
  }

  /** 注册推送事件跨进程转发器（返回退订函数；桌面传输用） */
  onPushRelay(relay: (channel: string, event: string, payload: unknown) => void): () => void {
    this.pushRelays.add(relay)
    return () => {
      this.pushRelays.delete(relay)
    }
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

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }
}

/** 将 connection 服务注册到 ctx（内核引导时调用；Service 构造器已注册，此处仅实例化） */
export function provideConnection(ctx: Context): ConnectionServiceImpl {
  return new ConnectionServiceImpl(ctx)
}

// ─── 类型声明合并（docs/03 §4：服务名扁平命名空间） ───────────────────────────

declare module 'cordis' {
  interface Context {
    connection: ConnectionService
  }
}

