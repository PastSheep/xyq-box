/**
 * @xyq-box/core — 核心类型定义
 *
 * 内核公开的类型与接口，docs/02 与 docs/04 定义的服务契约。
 * 所有类型保持最小够用（YAGNI），扩展走插件而非加参数。
 */

import type { FiberState } from 'cordis'

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/** bootstrap() 选项 */
export interface BootstrapOptions {
  /** 配置 profile 名（决定 plugins.json 加载路径），默认 'default' */
  profile?: string
  /** 应用根路径（用于解析相对路径 local-plugins/*），默认 process.cwd()（Node）或 '/'（浏览器） */
  basePath?: string
  /**
   * 插件清单来源（可选）。
   * 缺省：从 basePath/plugins.json 读取（Node 端）。
   * 浏览器端：Vite 部署入口把打包进产物的清单直接传入（或传入加载函数）。
   */
  manifest?: PluginManifest | (() => Promise<PluginManifest>)
  /**
   * 插件模块加载器（可选）。
   * 缺省：动态 import（Node 端）。
   * 浏览器端：由 Vite 生成的「插件名 → 动态 import」注册表驱动（见 plugin-shell-web 的 vite 插件）。
   */
  loader?: (name: string) => Promise<Record<string, unknown>>
}

// ─── 插件清单（plugins.json） ────────────────────────────────────────────────

export interface PluginManifestEntry {
  /** 插件名（npm 包名，如 '@xyq-box/plugin-logger'）或相对路径（如 './local-plugins/my-thing'） */
  name: string
  /** 可选配置，装载时传给插件 */
  config?: Record<string, unknown>
}

export interface PluginManifest {
  plugins: PluginManifestEntry[]
}

// ─── 内核句柄 ────────────────────────────────────────────────────────────────

export interface KernelHandle {
  /** 当前内核版本 */
  version: string
  /** Cordis 根 Context */
  ctx: import('cordis').Context
  /** 插件管理器 */
  plugins: PluginManager
}

// ─── 插件管理器 ──────────────────────────────────────────────────────────────

export interface PluginManager {
  /** 读取并解析插件清单 */
  loadManifest(): Promise<PluginManifest>
  /** 装载清单中所有插件（已装载的跳过） */
  mountAll(): Promise<void>
  /** 装载单个插件（按名查找清单并装载） */
  mount(name: string): Promise<import('cordis').Fiber>
  /** 卸载单个插件 */
  unmount(name: string): Promise<void>
  /** 热重载单个插件（卸载后重新装载） */
  reload(name: string): Promise<void>
  /** 获取所有已装载插件的状态快照（诊断用） */
  getStatus(): PluginStatus[]
  /** 获取指定插件的状态 */
  getPluginStatus(name: string): PluginStatus | undefined
}

// ─── 插件状态诊断 ────────────────────────────────────────────────────────────

export interface PluginStatus {
  /** 插件名（取自插件声明或包名） */
  name: string
  /** Fiber 状态 */
  state: FiberState
  /** 状态可读描述 */
  stateLabel: string
  /** 错误信息（仅 FAILED 时） */
  error?: string
  /** 依赖的服务列表 */
  inject: string[]
  /** 提供的服务列表 */
  provide: string[]
  /** 是否正在等待依赖（PENDING 且依赖未就绪） */
  waiting?: boolean
}

// ─── Connection 服务（内核内置 RPC 桥，docs/04 §8） ──────────────────────────

export type RpcResult = { ok: true; value: unknown } | { ok: false; error: string }

export interface RpcHandler {
  /** 注册端点（effect 语义，插件卸载自动撤销） */
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown) => Promise<RpcResult>,
    opts?: { authority?: 'loopback' | 'any' },
  ): () => void
  /** 调用远程端点 */
  call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult>
}

export interface ConnectionService {
  rpc: RpcHandler
  /** Node → Web 单向事件推送 */
  push(channel: string, event: string, payload?: unknown): void
  /** 订阅推送事件（effect 语义） */
  onPush(channel: string, handler: (event: string, payload: unknown) => void): () => void
}

// ─── 内核内部符号 ────────────────────────────────────────────────────────────

/** 插件清单文件名 */
export const MANIFEST_FILE = 'plugins.json'
