/**
 * @xyq-box/plugin-shell-desktop —— Electron preload（渲染进程桥）
 *
 * contextIsolation 下经 contextBridge 暴露最小 API window.xyqBridge：
 * - rpc.call：渲染进程 → 主进程内核的 RPC 调用（ipcRenderer.invoke）；
 * - onPush：主进程 → 渲染进程的推送事件订阅（ipcRenderer.on）。
 *
 * 接入点：shell-web 的渲染入口检测到 window.xyqBridge 后，把 connection
 * 服务切换为 IPC 传输（IpcConnectionService，见 shell-web src/web/ipc-connection.ts）。
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC_CHANNEL_PUSH, IPC_CHANNEL_RPC_CALL } from './ipc.js'

// ─── 桥的类型（与 shell-web 的 XyqBridge 结构一致，插件间不跨包 import） ──────

export interface XyqRpcResult {
  ok: boolean
  value?: unknown
  error?: string
}

interface XyqBridge {
  platform: 'desktop'
  rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<XyqRpcResult>
  }
  onPush(handler: (message: { channel: string; event: string; payload: unknown }) => void): () => void
}

export const bridge: XyqBridge = {
  platform: 'desktop',
  rpc: {
    call: (channel, endpoint, payload) =>
      ipcRenderer.invoke(IPC_CHANNEL_RPC_CALL, { channel, endpoint, payload }) as Promise<XyqRpcResult>,
  },
  onPush: (handler) => {
    const listener = (_event: IpcRendererEvent, message: { channel: string; event: string; payload: unknown }) => {
      handler(message)
    }
    ipcRenderer.on(IPC_CHANNEL_PUSH, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNEL_PUSH, listener)
    }
  },
}

contextBridge.exposeInMainWorld('xyqBridge', bridge)
