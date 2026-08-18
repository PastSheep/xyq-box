/**
 * @xyq-box/plugin-storage —— 单测
 *
 * 契约：get/set/remove 键值持久化，内存后端可跨实例恢复。
 */
import { Context } from 'cordis'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
  MemoryStorageBackend,
  StorageServiceImpl,
  type StorageService,
} from '../src/index.js'
import * as storagePlugin from '../src/index.js'

// ─── 辅助 ───────────────────────────────────────────────────────────────────

function createContext(): Context {
  const ctx = new Context()
  return ctx
}

function disposeAll(ctx: Context): void {
  ctx.registry.forEach((runtime) => {
    for (const fiber of runtime.fibers) {
      fiber.dispose()
    }
  })
}

// ─── MemoryStorageBackend ─────────────────────────────────────────────────────

describe('MemoryStorageBackend', () => {
  let backend: MemoryStorageBackend

  beforeEach(() => {
    backend = new MemoryStorageBackend()
  })

  it('read/write roundtrip', () => {
    expect(backend.read('key')).toBeNull()
    backend.write('key', 'value')
    expect(backend.read('key')).toBe('value')
  })

  it('remove deletes key', () => {
    backend.write('key', 'value')
    backend.remove('key')
    expect(backend.read('key')).toBeNull()
  })

  it('clear removes all keys', () => {
    backend.write('a', '1')
    backend.write('b', '2')
    backend.clear()
    expect(backend.read('a')).toBeNull()
    expect(backend.read('b')).toBeNull()
  })
})

// ─── StorageServiceImpl ──────────────────────────────────────────────────────

describe('StorageServiceImpl', () => {
  let ctx: Context
  let storage: StorageService
  let backend: MemoryStorageBackend

  beforeEach(() => {
    ctx = createContext()
    backend = new MemoryStorageBackend()
    storage = new StorageServiceImpl(ctx, backend)
  })

  afterEach(() => {
    disposeAll(ctx)
  })

  it('get returns undefined for missing key', async () => {
    const val = await storage.get('missing')
    expect(val).toBeUndefined()
  })

  it('set/get roundtrip', async () => {
    await storage.set('foo', { bar: 42 })
    const val = await storage.get('foo')
    expect(val).toEqual({ bar: 42 })
  })

  it('set/get with primitive values', async () => {
    await storage.set('str', 'hello')
    await storage.set('num', 123)
    await storage.set('bool', true)
    await storage.set('null', null)
    expect(await storage.get('str')).toBe('hello')
    expect(await storage.get('num')).toBe(123)
    expect(await storage.get('bool')).toBe(true)
    expect(await storage.get('null')).toBeNull()
  })

  it('remove deletes key', async () => {
    await storage.set('temp', 'value')
    expect(await storage.get('temp')).toBe('value')
    await storage.remove('temp')
    expect(await storage.get('temp')).toBeUndefined()
  })

  it('跨实例持久化（同一 backend）：后一个实例能读到前一个写入的值', async () => {
    // 用两个独立 context（模拟两次应用运行）共享同一 backend
    const ctxA = createContext()
    const ctxB = createContext()
    const s1 = new StorageServiceImpl(ctxA, backend)
    await s1.set('shared', { data: 1 })

    const s2 = new StorageServiceImpl(ctxB, backend)
    const val = await s2.get('shared')
    expect(val).toEqual({ data: 1 })
    disposeAll(ctxA)
    disposeAll(ctxB)
  })
})

// ─── 插件级导出 ──────────────────────────────────────────────────────────────

describe('plugin-storage 导出', () => {
  it('导出 name / provide / apply', () => {
    expect(storagePlugin.name).toBe('@xyq-box/plugin-storage')
    expect(storagePlugin.provide).toContain('storage')
    expect(typeof storagePlugin.apply).toBe('function')
  })

  it('装载后 ctx.storage 可用', async () => {
    const ctx = createContext()
    await ctx.plugin(storagePlugin)
    expect(ctx.storage).toBeDefined()
    expect(typeof ctx.storage.get).toBe('function')
    expect(typeof ctx.storage.set).toBe('function')
    expect(typeof ctx.storage.remove).toBe('function')
    disposeAll(ctx)
  })

  it('卸载后 ctx.storage 消失', async () => {
    const ctx = createContext()
    const fiber = await ctx.plugin(storagePlugin)
    expect(ctx.storage).toBeDefined()
    await fiber.dispose()
    expect(ctx.storage).toBeUndefined()
    disposeAll(ctx)
  })
})
