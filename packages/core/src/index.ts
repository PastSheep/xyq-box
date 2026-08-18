/**
 * @xyq-box/core —— xyq-box 内核
 *
 * 职责：引导（bootstrap）、插件管理器、清单加载器、connection 服务（内置 RPC 桥）。
 * 实现 docs/02 与 docs/04 定义的内核契约。
 */

export { bootstrap, version } from './bootstrap.js'
export { ConnectionServiceImpl, provideConnection } from './connection.js'
export { createPluginManager } from './plugin-manager.js'
export {
  MANIFEST_FILE,
  type BootstrapOptions,
  type ConnectionService,
  type KernelHandle,
  type PluginManifest,
  type PluginManifestEntry,
  type PluginManager,
  type PluginStatus,
  type RpcHandler,
  type RpcResult,
} from './types.js'