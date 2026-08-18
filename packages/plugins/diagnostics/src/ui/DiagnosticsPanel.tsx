/**
 * @xyq-box/plugin-diagnostics —— DiagnosticsPanel：诊断面板
 *
 * 三标签页：
 * 1. 插件列表（名称/状态/依赖/错误）
 * 2. 日志流（实时输出，可选过滤级别）
 * 3. 依赖图（SVG 拓扑可视化）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getController,
  type DiagnosticsPluginStatus,
  type LogEntry,
  layoutGraph,
} from '../diagnostics.js'
import type { GraphData } from '../diagnostics.js'
import './diagnostics.css'

// ─── 时间格式化 ──────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

// ─── 状态徽章类 ──────────────────────────────────────────────────────────────

function badgeClass(state: number): string {
  switch (state) {
    case 2:
      return 'xyq-diag-badge--active'
    case 0:
      return 'xyq-diag-badge--pending'
    case 3:
      return 'xyq-diag-badge--failed'
    case 1:
      return 'xyq-diag-badge--loading'
    case 5:
      return 'xyq-diag-badge--unloading'
    case 4:
      return 'xyq-diag-badge--disposed'
    default:
      return 'xyq-diag-badge--unknown'
  }
}

// ─── 选项卡 ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'plugins', label: '插件列表' },
  { id: 'logs', label: '日志流' },
  { id: 'graph', label: '依赖图' },
] as const

type TabId = (typeof TABS)[number]['id']

// ─── 插件列表标签页 ──────────────────────────────────────────────────────────

function PluginList({ statuses }: { statuses: DiagnosticsPluginStatus[] }) {
  if (statuses.length === 0) {
    return <div className="xyq-diag-empty">暂无插件状态</div>
  }

  return (
    <table className="xyq-diag-table">
      <thead>
        <tr>
          <th>插件名</th>
          <th>状态</th>
          <th>依赖 (inject)</th>
          <th>提供 (provide)</th>
          <th>错误</th>
        </tr>
      </thead>
      <tbody>
        {statuses.map((s) => (
          <tr key={s.name}>
            <td className="xyq-diag-name">{s.name}</td>
            <td>
              <span className={'xyq-diag-badge ' + badgeClass(s.state)}>
                {s.stateLabel}
                {s.waiting ? ' (等待中)' : ''}
              </span>
            </td>
            <td>
              {s.inject.length > 0 ? (
                <div className="xyq-diag-chips">
                  {s.inject.map((svc) => (
                    <span key={svc} className="xyq-diag-chip">
                      {svc}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="xyq-diag-empty">—</span>
              )}
            </td>
            <td>
              {s.provide.length > 0 ? (
                <div className="xyq-diag-chips">
                  {s.provide.map((svc) => (
                    <span key={svc} className="xyq-diag-chip">
                      {svc}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="xyq-diag-empty">—</span>
              )}
            </td>
            <td>
              {s.error ? (
                <span className="xyq-diag-error">{s.error}</span>
              ) : (
                <span className="xyq-diag-empty">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── 日志流标签页 ────────────────────────────────────────────────────────────

const LEVEL_ORDER = ['error', 'warn', 'info', 'debug'] as const

function LogView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<string>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (filter === 'all') return logs
    const idx = LEVEL_ORDER.indexOf(filter as (typeof LEVEL_ORDER)[number])
    if (idx < 0) return logs
    return logs.filter((entry) => LEVEL_ORDER.indexOf(entry.type) <= idx)
  }, [logs, filter])

  // 自动滚动到底部
  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [filtered.length, autoScroll])

  const handleScroll = useCallback(() => {
    if (!bodyRef.current) return
    const el = bodyRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    setAutoScroll(atBottom)
  }, [])

  return (
    <div className="xyq-diag-log">
      <div className="xyq-diag-log__toolbar">
        <label>
          级别：
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="error">error</option>
            <option value="warn">warn+</option>
            <option value="info">info+</option>
            <option value="debug">debug+</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          自动滚动
        </label>
        <span style={{ color: 'var(--xyq-fg-dim, #888)', fontSize: 11, marginLeft: 'auto' }}>
          {logs.length} 条
        </span>
      </div>
      <div className="xyq-diag-log__body" ref={bodyRef} onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="xyq-diag-empty">暂无日志</div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.sn} className="xyq-diag-log__row">
              <span className="xyq-diag-log__time">{fmtTime(entry.ts)}</span>
              <span className={'xyq-diag-log__level xyq-diag-log__level--' + entry.type}>
                {entry.type.toUpperCase()}
              </span>
              <span className="xyq-diag-log__scope">[{entry.name}]</span>
              <span className="xyq-diag-log__text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── 依赖图标签页 ────────────────────────────────────────────────────────────

function GraphView({ graph }: { graph: GraphData }) {
  const laidOut = useMemo(() => layoutGraph(graph), [graph])

  if (laidOut.length === 0) {
    return <div className="xyq-diag-empty">暂无依赖图数据</div>
  }

  const padding = 30
  const nodeW = 140
  const nodeH = 24
  const xs = laidOut.map((n) => n.x)
  const ys = laidOut.map((n) => n.y)
  const minX = Math.min(...xs) - padding
  const maxX = Math.max(...xs) + nodeW + padding
  const minY = Math.min(...ys) - padding
  const maxY = Math.max(...ys) + nodeH + padding
  const viewBox = [minX, minY, maxX - minX, maxY - minY].join(' ')

  return (
    <div className="xyq-diag-graph">
      <svg width="100%" height="300" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker
            id="xyq-diag-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#90a4ae" />
          </marker>
        </defs>

        {/* 边 */}
        {graph.edges.map((edge, i) => {
          const src = laidOut.find((n) => n.id === edge.source)
          const tgt = laidOut.find((n) => n.id === edge.target)
          if (!src || !tgt) return null
          const x1 = src.x + nodeW / 2
          const y1 = src.y + nodeH / 2
          const x2 = tgt.x + nodeW / 2
          const y2 = tgt.y + nodeH / 2
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="xyq-diag-graph__edge" />
        })}

        {/* 节点 */}
        {laidOut.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={nodeW}
              height={nodeH}
              rx={4}
              className={
                'xyq-diag-graph__node xyq-diag-graph__node--' +
                (node.state === 2
                  ? 'active'
                  : node.state === 3
                    ? 'failed'
                    : node.state === 0
                      ? 'pending'
                      : '')
              }
            />
            <text
              x={node.x + nodeW / 2}
              y={node.y + nodeH / 2 + 3}
              textAnchor="middle"
              className="xyq-diag-graph__label"
            >
              {truncateCtx(node.label, 18)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function truncateCtx(label: string, max: number): string {
  if (label.length <= max) return label
  return label.slice(0, max - 3) + '...'
}

// ─── 主面板 ──────────────────────────────────────────────────────────────────

export function DiagnosticsPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('plugins')
  const [, forceUpdate] = useState(0)
  const controller = getController()

  // 订阅控制器变更
  useEffect(() => {
    const ctrl = getController()
    if (!ctrl) return
    const dispose = ctrl.subscribe(() => forceUpdate((n) => n + 1))
    return dispose
  }, [])

  // 定时刷新（兜底：若 fiber 事件偶有漏发）
  useEffect(() => {
    const interval = window.setInterval(() => {
      const ctrl = getController()
      if (ctrl) {
        ctrl.refresh()
        forceUpdate((n) => n + 1)
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [])

  const statuses = controller?.statuses ?? []
  const logs = controller?.logs ?? []
  const graph = controller?.graph ?? { nodes: [], edges: [] }

  return (
    <div className="xyq-diag">
      <div className="xyq-diag-header">
        <h2 className="xyq-diag-title">诊断</h2>
        <span className="xyq-diag-count">
          {statuses.length} 插件
          {statuses.filter((s) => s.state === 3).length > 0 && (
            <span style={{ color: '#c0392b', marginLeft: 6 }}>
              · {statuses.filter((s) => s.state === 3).length} 异常
            </span>
          )}
          {statuses.filter((s) => s.state === 0).length > 0 && (
            <span style={{ color: '#ef6c00', marginLeft: 6 }}>
              · {statuses.filter((s) => s.state === 0).length} 等待中
            </span>
          )}
        </span>
      </div>

      <div className="xyq-diag-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={'xyq-diag-tab' + (activeTab === tab.id ? ' xyq-diag-tab--active' : '')}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="xyq-diag-tab-content">
        {activeTab === 'plugins' && <PluginList statuses={statuses} />}
        {activeTab === 'logs' && <LogView logs={logs} />}
        {activeTab === 'graph' && <GraphView graph={graph} />}
      </div>
    </div>
  )
}
