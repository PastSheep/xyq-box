/**
 * @xyq-box/plugin-diagnostics —— 诊断控制器
 *
 * 订阅内核诊断接口（getStatus/fiber 事件）与日志环形缓冲。
 * 框架无关，可测试；不依赖 @xyq-box/core。
 */

import type { Context } from 'cordis'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 插件状态（与 core PluginStatus 结构等价，避免包级依赖） */
export interface DiagnosticsPluginStatus {
  name: string
  state: number
  stateLabel: string
  error?: string
  inject: string[]
  provide: string[]
  waiting?: boolean
}

/** 依赖图节点 */
export interface GraphNode {
  id: string
  label: string
  state: number
  stateLabel: string
}

/** 依赖图边 */
export interface GraphEdge {
  source: string
  target: string
  service: string
}

/** 依赖图数据 */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 日志条目 */
export interface LogEntry {
  sn: number
  ts: number
  type: 'error' | 'warn' | 'info' | 'debug'
  level: number
  name: string
  text: string
}

// ─── FiberState 常量（cordis 4.0.0-rc.8 const enum 值） ─────────────────────

const STATE_LABELS: Record<number, string> = {
  0: 'PENDING',
  1: 'LOADING',
  2: 'ACTIVE',
  3: 'FAILED',
  4: 'DISPOSED',
  5: 'UNLOADING',
}

// ─── 日志格式化 ──────────────────────────────────────────────────────────────

/** 简单 printf 格式化（支持 %s %d %j %o %O %%） */
function formatMessage(args: unknown[]): string {
  if (args.length === 0) return ''
  const fmt = String(args[0])
  if (args.length === 1) return fmt
  let i = 1
  return (
    fmt.replace(/%[%sdjoO]/g, (spec) => {
      if (spec === '%%') return '%'
      const val = args[i++]
      if (val === undefined) return 'undefined'
      if (val === null) return 'null'
      switch (spec) {
        case '%s':
          return String(val)
        case '%d':
          return String(Number(val))
        case '%j':
        case '%o':
        case '%O':
          return tryJson(val)
        default:
          return String(val)
      }
    }) +
    (i < args.length
      ? ' ' +
        args
          .slice(i)
          .map((v) => (typeof v === 'object' ? tryJson(v) : String(v)))
          .join(' ')
      : '')
  )
}

function tryJson(val: unknown): string {
  try {
    return JSON.stringify(val)
  } catch {
    return String(val)
  }
}

/** 将 Logger 消息转换为 LogEntry */
function toLogEntry(msg: {
  sn: number
  ts: number
  type: string
  level: number
  name: string
  args: unknown[]
}): LogEntry {
  const type = ['error', 'warn', 'info', 'debug'].includes(msg.type)
    ? (msg.type as LogEntry['type'])
    : 'info'
  return {
    sn: msg.sn,
    ts: msg.ts,
    type,
    level: msg.level,
    name: msg.name,
    text: formatMessage(msg.args),
  }
}

// ─── LoggerService 结构子集 ─────────────────────────────────────────────────

interface LoggerServiceLike {
  buffer: Array<{
    sn: number
    ts: number
    type: string
    level: number
    name: string
    args: unknown[]
  }>
  exporter(exporter: {
    colors?: number
    levels?: Record<string, number>
    export(msg: Record<string, unknown>): void
  }): () => void
}

// ─── 诊断控制器 ──────────────────────────────────────────────────────────────

export class DiagnosticsController {
  private listeners = new Set<() => void>()
  private _statuses: DiagnosticsPluginStatus[] = []
  private _logs: LogEntry[] = []
  private _graph: GraphData = { nodes: [], edges: [] }
  private maxLogs: number
  private disposeExporter?: () => void
  private disposeFiberEvents?: () => void

  constructor(
    private ctx: Context,
    options: { maxLogs?: number } = {},
  ) {
    this.maxLogs = options.maxLogs ?? 500

    // 1. 初始状态快照（从 registry 读取，同 plugin-manager getStatus）
    this.refresh()

    // 2. 订阅 fiber 状态变更事件（effect 语义，插件卸载自动清理）
    this.disposeFiberEvents = ctx.on('internal/status', () => {
      this.refresh()
      this.notify()
    })

    // 3. 日志环形缓冲：初始快照 + 实时导出
    const svc = this.ctx.logger as unknown as LoggerServiceLike
    if (svc?.buffer) {
      this._logs = svc.buffer.slice().map(toLogEntry).slice(-this.maxLogs)
    }
    if (svc?.exporter) {
      this.disposeExporter = svc.exporter({
        export: (msg: Record<string, unknown>) => {
          this.pushLog(msg as Parameters<typeof toLogEntry>[0])
        },
      })
    }
  }

  /** 读取当前插件状态快照 */
  get statuses(): DiagnosticsPluginStatus[] {
    return this._statuses
  }

  /** 当前日志列表 */
  get logs(): LogEntry[] {
    return this._logs
  }

  /** 当前依赖图 */
  get graph(): GraphData {
    return this._graph
  }

  /** 订阅变更通知 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 手动刷新状态快照 + 重建依赖图 */
  refresh(): void {
    const statuses = this.collectStatuses()
    this._statuses = statuses
    this._graph = buildGraph(statuses)
  }

  /** 清理所有订阅（插件卸载时调用） */
  dispose(): void {
    this.disposeFiberEvents?.()
    this.disposeExporter?.()
    this.listeners.clear()
  }

  // ─── 内部 ────────────────────────────────────────────────────────────────

  private collectStatuses(): DiagnosticsPluginStatus[] {
    const result: DiagnosticsPluginStatus[] = []
    // registry.forEach 回调参数为 cordis Plugin.Runtime，其 fibers 是
    // DisposableList<Fiber>（可迭代）；此处用结构类型收敛，避免依赖 core 类型
    this.ctx.registry.forEach((runtime: { name?: string; fibers: Iterable<object> }) => {
      const name = runtime.name ?? 'unnamed'
      for (const fiber of runtime.fibers) {
        const f = fiber as Record<string, unknown>
        const state = f.state as number
        const inject = f.inject ? Object.keys(f.inject as Record<string, unknown>) : []
        const provide = f.store ? Object.keys(f.store as Record<string, unknown>) : []
        const error = f['_error'] instanceof Error ? (f['_error'] as Error).message : undefined
        result.push({
          name,
          state,
          stateLabel: STATE_LABELS[state] ?? 'UNKNOWN',
          error,
          inject,
          provide,
          waiting: state === 0 && inject.length > 0,
        })
      }
    })
    return result
  }

  private pushLog(msg: {
    sn: number
    ts: number
    type: string
    level: number
    name: string
    args: unknown[]
  }): void {
    this._logs = [...this._logs.slice(-(this.maxLogs - 1)), toLogEntry(msg)]
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 忽略
      }
    }
  }
}

// ─── 依赖图构建 ──────────────────────────────────────────────────────────────

/**
 * 从插件状态列表构建依赖图。
 * 边 = 插件 A 的 inject 包含服务 S，插件 B 的 provide 包含 S（A 依赖 B）。
 */
export function buildGraph(statuses: DiagnosticsPluginStatus[]): GraphData {
  const nodes: GraphNode[] = statuses.map((s) => ({
    id: s.name,
    label: s.name,
    state: s.state,
    stateLabel: s.stateLabel,
  }))

  // 服务名 → 提供该服务的插件列表
  const providerMap = new Map<string, string[]>()
  for (const status of statuses) {
    for (const svc of status.provide) {
      let list = providerMap.get(svc)
      if (!list) {
        list = []
        providerMap.set(svc, list)
      }
      list.push(status.name)
    }
  }

  // 构建边
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []
  for (const status of statuses) {
    for (const svc of status.inject) {
      const providers = providerMap.get(svc)
      if (!providers) continue
      for (const provider of providers) {
        if (provider === status.name) continue
        const key = status.name + '->' + provider + ':' + svc
        if (edgeSet.has(key)) continue
        edgeSet.add(key)
        edges.push({ source: status.name, target: provider, service: svc })
      }
    }
  }

  return { nodes, edges }
}

/**
 * 将图数据转换为分层布局坐标（x, y）。
 * 边方向 = 依赖方向（A inject 服务 S，B provide S → A 指向 B）；
 * 布局按「提供者在下、消费者在上」分层：把边反向计算层——
 * 提供者（edge.target）为第 0 层（底部），消费者递增向上。
 */
export function layoutGraph(graph: GraphData): Array<GraphNode & { x: number; y: number }> {
  const { nodes, edges } = graph
  if (nodes.length === 0) return []

  // 反向边的入度（层 = 到提供者的距离，提供者为根）
  const indegree = new Map<string, number>()
  const outEdges = new Map<string, GraphEdge[]>()
  for (const node of nodes) {
    indegree.set(node.id, 0)
    outEdges.set(node.id, [])
  }
  for (const edge of edges) {
    // 反向：provider(edge.target) → consumer(edge.source)
    indegree.set(edge.source, (indegree.get(edge.source) ?? 0) + 1)
    const list = outEdges.get(edge.target)
    if (list) list.push({ ...edge, source: edge.target, target: edge.source })
  }

  // 拓扑排序计算层
  const level = new Map<string, number>()
  const queue: string[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) {
      level.set(id, 0)
      queue.push(id)
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!
    const lvl = level.get(id) ?? 0
    for (const edge of outEdges.get(id) ?? []) {
      const next = indegree.get(edge.target) ?? 1
      if (next > 0) {
        const newLevel = lvl + 1
        const curLevel = level.get(edge.target) ?? 0
        if (newLevel > curLevel) {
          level.set(edge.target, newLevel)
        }
        indegree.set(edge.target, next - 1)
        if (next - 1 === 0) {
          queue.push(edge.target)
        }
      }
    }
  }

  // 同级节点按 id 排序
  const byLevel = new Map<number, string[]>()
  for (const [id, lvl] of level) {
    let list = byLevel.get(lvl)
    if (!list) {
      list = []
      byLevel.set(lvl, list)
    }
    list.push(id)
  }

  // 分配坐标
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const result: Array<GraphNode & { x: number; y: number }> = []
  const spacingX = 180
  const spacingY = 60

  for (const [lvl, ids] of byLevel) {
    const sorted = ids.sort()
    const totalWidth = (sorted.length - 1) * spacingX
    const startX = -totalWidth / 2
    for (let i = 0; i < sorted.length; i++) {
      const node = nodeMap.get(sorted[i]!)
      if (!node) continue
      result.push({
        ...node,
        x: startX + i * spacingX,
        y: lvl * spacingY,
      })
    }
  }

  return result
}

// ─── 模块级控制器持有者（供 React 层消费） ──────────────────────────────

let currentController: DiagnosticsController | null = null

/** 设置当前诊断控制器（插件入口 apply 时调用） */
export function setController(c: DiagnosticsController | null): void {
  currentController = c
}

/** 获取当前诊断控制器（React 组件通过此函数读取） */
export function getController(): DiagnosticsController | null {
  return currentController
}
