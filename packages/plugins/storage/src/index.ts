/**
 * @xyq-box/plugin-storage —— 存储服务（M1：键值持久化）
 *
 * docs/04 §4 定义的 StorageService 键值部分实现。
 * 提供一个可替换的存储抽象：
 * - Web 端：localStorage（JSON 序列化，键值小型状态）；
 * - Node / 无 localStorage 环境：进程内内存 Map（可裁剪：没有本插件就没有持久化）。
 *
 * 职责范围（M1）：get / set / remove 键值持久化，供 config 等基础设施插件委托写入。
 * collection（文档集合）与 readFile/writeFile（大对象文件）列为 M2 桌面壳工作
 * （docs/06 M2：storage 桌面实现 = 用户数据目录 + 真实 fs）。
 *
 * 遵循 docs/03-插件规范.md：
 * - 服务注册走 effect 语义（Service 构造器），插件卸载自动撤销；
 * - 消费方只按名依赖（ctx.storage），不 import 本实现。
 */

import { Context, Service } from 'cordis'

// ─── 键值存储后端抽象 ────────────────────────────────────────────────────────

export interface StorageBackend {
  /** 读取原始字符串（不存在返回 null） */
  read(key: string): string | null | Promise<string | null>
  /** 写入原始字符串 */
  write(key: string, value: string): void | Promise<void>
  /** 移除键 */
  remove(key: string): void | Promise<void>
  /** 重置（测试用） */
  clear?(): void | Promise<void>
}

/** localStorage 后端（Web） */
export class LocalStorageBackend implements StorageBackend {
  read(key: string): string | null {
    try {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem(key)
    } catch {
      // 私有模式 / 配额异常：按缺失处理
      return null
    }
  }

  write(key: string, value: string): void {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(key, value)
    } catch {
      // 静默忽略（私有模式或非浏览器环境）
    }
  }

  remove(key: string): void {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.removeItem(key)
    } catch {
      // 静默忽略
    }
  }
}

/** 内存后端（Node / 无 localStorage 环境；进程内不跨重启持久） */
export class MemoryStorageBackend implements StorageBackend {
  private map = new Map<string, string>()

  read(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  write(key: string, value: string): void {
    this.map.set(key, value)
  }

  remove(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}

// ─── 服务类型 ────────────────────────────────────────────────────────────────

/** 存储服务（docs/04 §4 键值部分，M1 范围） */
export interface StorageService {
  /** 读取键值（不存在返回 undefined） */
  get(key: string): Promise<unknown | undefined>
  /** 写入键值（值须可 JSON 序列化） */
  set(key: string, value: unknown): Promise<void>
  /** 删除键 */
  remove(key: string): Promise<void>
}

// ─── 实现 ────────────────────────────────────────────────────────────────────

export class StorageServiceImpl extends Service implements StorageService {
  private backend: StorageBackend
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context, backend?: StorageBackend) {
    super(ctx, 'storage')
    this.logger = ctx.logger('storage')
    this.backend = backend ?? new LocalStorageBackend()
    this.logger.info(
      'storage service created (backend=%s)',
      this.backend instanceof MemoryStorageBackend ? 'memory' : 'localStorage',
    )
  }

  async get(key: string): Promise<unknown | undefined> {
    const raw = await this.backend.read(key)
    if (raw === null || raw === undefined) return undefined
    try {
      return JSON.parse(raw) as unknown
    } catch (error) {
      this.logger.warn(
        'storage.get(%s): 存储值不是合法 JSON（%s）—— 按缺失处理',
        key,
        error instanceof Error ? error.message : String(error),
      )
      return undefined
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.backend.write(key, JSON.stringify(value))
  }

  async remove(key: string): Promise<void> {
    await this.backend.remove(key)
  }
}

// ─── 类型声明合并 ───────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    storage: StorageService
  }
}

// ─── 插件入口 ────────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-storage'
export const provide = ['storage']

export function apply(ctx: Context) {
  const logger = ctx.logger('storage')
  logger.info('plugin loaded')

  // Service 构造器即 effect 语义注册，卸载时自动撤销
  new StorageServiceImpl(ctx)
}
