/**
 * @xyq-box/plugin-config —— 配置服务（M1：schema 驱动的配置读写）
 *
 * docs/04 §2 定义的 ConfigService 实现：
 * - 按插件名分片读写（各插件配置互不干扰）；
 * - onChange 订阅（effect 语义，随消费者/提供者卸载自动退订）；
 * - 变更即热重载：set 后通过 fiber.update() 让受影响插件以新配置重启（HMR 语义）；
 * - 持久化委托 storage 服务：分片写入 'config:<pluginId>' 键，并维护分片索引 'config:shards'；
 *   没有 storage 插件 = 配置仅内存保留（可裁剪，可验证）；
 * - get 合并「schema 默认值 + 用户配置」（经 cordis resolveConfig 归一化）。
 *
 * 服务替换语义（docs/02 §2.3）：卸载本插件 → 依赖 config 的插件 PENDING；
 * 装载新 config provider → 消费者自动重连。
 */

import { Context, Service } from 'cordis'
import { resolveConfig, type Plugin } from 'cordis'

// ─── 类型定义（docs/04 §2） ─────────────────────────────────────────────────

export interface ConfigService {
  /** 读取某插件的配置（合并 schema 默认值 + 用户配置） */
  get<T = unknown>(pluginId: string): Readonly<T>
  /** 局部更新（按插件名分片合并写入；持久化 + 变更通知 + 热重载） */
  set(pluginId: string, patch: unknown): Promise<void>
  /** 订阅某插件配置变更（effect 语义，返回退订函数） */
  onChange(pluginId: string, listener: (value: unknown) => void): () => void
  /** 全部插件配置的快照（已装载且声明 schema 的插件含默认值；供设置 UI / 导出） */
  snapshot(): Record<string, unknown>
  /** 枚举已装载且声明了 Config schema 的插件（设置 UI 用，schema 即插件导出的 schemastery 对象） */
  listSchemas(): Array<{ pluginId: string; schema: unknown }>
}

// ─── 实现 ────────────────────────────────────────────────────────────────────

/** storage 分片键前缀 */
const CONFIG_KEY_PREFIX = 'config:'
/** storage 中的分片索引键（记录已持久化的插件 id 列表） */
const SHARD_INDEX_KEY = 'config:shards'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** 递归合并：仅对两侧都是普通对象的字段深合并，其余字段以 patch 为准 */
function mergeDeep(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = mergeDeep(base[key], value)
  }
  return result
}

export class ConfigServiceImpl extends Service implements ConfigService {
  /** 用户配置缓存（仅含用户显式写入的字段，默认值在 get 时合并） */
  private store = new Map<string, unknown>()
  /** pluginId → 订阅者集合 */
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private logger: ReturnType<Context['logger']>
  /** 进行中的水合任务（set 前等待，避免覆盖已持久化配置） */
  private hydrating: Promise<void> | null = null

  constructor(ctx: Context) {
    super(ctx, 'config')
    this.logger = ctx.logger('config')

    // storage 可能晚于本插件装载（清单顺序无关，docs/02 §7）：
    // 订阅服务变更事件，storage 就绪/被替换时重新水合。
    // ctx.on 基于 fiber effect 注册，插件卸载自动退订。
    ctx.on('internal/service', (name: string) => {
      if (name === 'storage') {
        void this.hydrate()
      }
    })

    void this.hydrate()
  }

  // ─── 内部辅助 ──────────────────────────────────────────────────────────────

  /** 全量水合：从 storage 读取分片索引与各分片，填充内存缓存 */
  private async doHydrate(): Promise<void> {
    const storage = this.ctx.get('storage') as
      | { get(key: string): Promise<unknown | undefined> }
      | undefined
    if (!storage?.get) {
      if (this.store.size === 0) {
        this.logger.debug('storage 服务不可用，配置仅内存保留（不持久化）')
      }
      return
    }
    try {
      const index = (await storage.get(SHARD_INDEX_KEY)) as string[] | undefined
      if (!Array.isArray(index)) return
      for (const pluginId of index) {
        const value = await storage.get(CONFIG_KEY_PREFIX + pluginId)
        if (value !== undefined) {
          this.store.set(pluginId, value)
        }
      }
      this.logger.info('config hydrated %d shards from storage', this.store.size)
    } catch (error) {
      this.logger.warn('config 水合失败：%s', error instanceof Error ? error.message : String(error))
    }
  }

  private hydrate(): Promise<void> {
    if (this.hydrating) return this.hydrating
    this.hydrating = this.doHydrate().finally(() => {
      this.hydrating = null
    })
    return this.hydrating
  }

  /** 按插件名查找已装载的运行时（含其 Config schema） */
  private findRuntime(pluginId: string): Plugin.Runtime | undefined {
    let found: Plugin.Runtime | undefined
    this.ctx.registry.forEach((runtime) => {
      if (runtime.name === pluginId) found = runtime
    })
    return found
  }

  /** 校验合并后的配置（插件声明了 schema 时）；不通过抛 ValidationError */
  private validate(pluginId: string, merged: unknown): void {
    const runtime = this.findRuntime(pluginId)
    if (!runtime?.Config) return
    // resolveConfig 校验并返回归一化结果；校验失败抛 ValidationError（docs/03 §5）
    resolveConfig(runtime, merged)
  }

  /** 持久化分片（委托 storage；无 storage 时仅内存） */
  private async persist(pluginId: string, value: unknown): Promise<void> {
    const storage = this.ctx.get('storage') as
      | { get(key: string): Promise<unknown | undefined>; set(key: string, value: unknown): Promise<void> }
      | undefined
    if (!storage?.get || !storage.set) {
      this.logger.warn('storage 服务不可用，配置 ' + pluginId + ' 仅内存保留（不持久化）')
      return
    }
    await storage.set(CONFIG_KEY_PREFIX + pluginId, value)
    // 维护分片索引
    const index = ((await storage.get(SHARD_INDEX_KEY)) as string[] | undefined) ?? []
    if (!index.includes(pluginId)) {
      index.push(pluginId)
      await storage.set(SHARD_INDEX_KEY, index)
    }
  }

  /** 变更即热重载：让受影响插件的 fiber 以新配置重启（HMR 语义，docs/02 §5） */
  private reloadPlugin(pluginId: string, config: unknown): void {
    // 不重载自身（配置服务卸载即全盘失效，交由 cordis 依赖语义处理）
    if (pluginId === name) return
    const runtime = this.findRuntime(pluginId)
    if (!runtime) return // 插件未装载：仅保存，装载时生效
    for (const fiber of runtime.fibers) {
      try {
        fiber.update(config)
      } catch (error) {
        this.logger.warn(
          '热重载 ' + pluginId + ' 失败：' + (error instanceof Error ? error.message : String(error)) + '（配置已保存，插件可能处于 FAILED）',
        )
      }
    }
  }

  private notify(pluginId: string, value: unknown): void {
    const set = this.listeners.get(pluginId)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(value)
      } catch (error) {
        this.logger.warn('onChange listener 抛出异常：' + error)
      }
    }
  }

  // ─── 服务接口 ──────────────────────────────────────────────────────────────

  get<T = unknown>(pluginId: string): Readonly<T> {
    const saved = this.store.get(pluginId)
    const runtime = this.findRuntime(pluginId)
    if (!runtime?.Config) {
      return Object.freeze((saved ?? {}) as T)
    }
    try {
      // 合并 schema 默认值 + 用户配置（docs/04 §2）
      const resolved = resolveConfig(runtime, saved)
      return Object.freeze(resolved as T)
    } catch (error) {
      this.logger.warn(
        'config.get(' + pluginId + '): 已存配置不合法（' + (error instanceof Error ? error.message : String(error)) + '）—— 返回原值',
      )
      return Object.freeze((saved ?? {}) as T)
    }
  }

  async set(pluginId: string, patch: unknown): Promise<void> {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new TypeError('pluginId must be a non-empty string')
    }
    if (!isPlainObject(patch)) {
      throw new TypeError('config.set: patch 必须是对象')
    }
    // 等待水合完成，避免覆盖已持久化配置
    await this.hydrate()

    const current = this.store.get(pluginId)
    const merged = mergeDeep(current, patch)
    // 校验（未装载插件或无数值的 schema 直接通过）
    this.validate(pluginId, merged)

    this.store.set(pluginId, merged)
    // 持久化委托 storage（docs/04 §2：配置仓库持久化委托 ctx.storage）
    await this.persist(pluginId, merged)
    // 通知订阅者
    this.notify(pluginId, merged)
    // 变更即热重载（HMR 语义）
    this.reloadPlugin(pluginId, merged)
  }

  onChange(pluginId: string, listener: (value: unknown) => void): () => void {
    let set = this.listeners.get(pluginId)
    if (!set) {
      set = new Set()
      this.listeners.set(pluginId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) this.listeners.delete(pluginId)
    }
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const ids = new Set<string>([...this.store.keys()])
    for (const { pluginId } of this.listSchemas()) ids.add(pluginId)
    for (const id of ids) {
      result[id] = this.get(id)
    }
    return result
  }

  listSchemas(): Array<{ pluginId: string; schema: unknown }> {
    const result: Array<{ pluginId: string; schema: unknown }> = []
    this.ctx.registry.forEach((runtime) => {
      if (runtime.name && runtime.Config) {
        result.push({ pluginId: runtime.name, schema: runtime.Config })
      }
    })
    return result
  }
}

// ─── 类型声明合并 ───────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    config: ConfigService
  }
}

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-config'
export const provide = ['config']

export function apply(ctx: Context) {
  const logger = ctx.logger('config')
  logger.info('plugin loaded')

  // Service 构造器即 effect 语义注册，卸载时自动撤销
  new ConfigServiceImpl(ctx)
}