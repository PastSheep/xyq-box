#!/usr/bin/env node
/**
 * taskboard-cdp.mjs — 经 Chrome DevTools Protocol 直接读写 DSH 任务看板（CDP 路径）。
 *
 * 前置：dsh-desktop 的 WebView2 需带调试端口启动（已持久化环境变量
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222，重启 GUI 后生效）。
 *
 * 用法：
 *   node scripts/taskboard-cdp.mjs --seed        # 注入 7 张卡（M0 六卡 + 定时报告卡）
 *   node scripts/taskboard-cdp.mjs --read        # 读取当前看板摘要（数量/标题/状态）
 *   node scripts/taskboard-cdp.mjs --exec <js>   # 在 GUI 页面上下文执行任意 JS
 *   node scripts/taskboard-cdp.mjs --list        # 列出调试端口的全部 targets
 *
 * CDP 流程：GET /json/list 找 3080 页面 target → WebSocket 连接 → Runtime.evaluate。
 * 依赖 Node ≥ 22 的原生 WebSocket。
 */
import { CARDS, validateCards, buildLedger } from './taskboard-cards.mjs'

const DEBUG_PORT = 9222
const TARGET_MARK = ':3080'
const STORAGE_KEY = 'dsh.taskBoard.v1'

function log(...args) { console.log(...args) }
function fail(msg) { console.error('[taskboard-cdp]', msg); process.exit(1) }

/** 列出调试端口全部 targets。 */
async function listTargets() {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
  } catch (e) {
    fail(`调试端口 ${DEBUG_PORT} 未开放（${e.cause?.code ?? e.message}）——请先重启 dsh-desktop（环境变量已持久化，重启后生效）`)
  }
  if (!res.ok) fail(`GET /json/list failed: HTTP ${res.status}`)
  return res.json()
}

/** 找 3080 GUI target（URL 含 :3080；实际为外层 page 内的 iframe）。 */
async function findPageTarget() {
  const targets = await listTargets()
  const page = targets.find((t) => (t.type === 'page' || t.type === 'iframe') && t.url.includes(TARGET_MARK))
  if (!page) {
    log('[taskboard-cdp] 未找到 3080 页面 target，当前 targets：')
    for (const t of targets) log('  -', t.type, t.url, t.webSocketDebuggerUrl ?? '')
    fail('请确认 GUI 已用调试端口重启（环境变量已持久化，需重启 dsh-desktop 生效）')
  }
  return page
}

/** 连接 target 的 WebSocket，返回 send(method, params) 的 Promise 化客户端。 */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 1

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  }

  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { ws.close() },
  }
}

/** 在页面上下文执行表达式，返回 result.value；异常时打印并退出。 */
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    fail('页面执行异常: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text))
  }
  return result.result?.value
}

async function readLedger(cdp) {
  const summary = await evaluate(cdp, `(() => {
    const raw = localStorage.getItem('${STORAGE_KEY}')
    if (!raw) return { count: 0, cards: [] }
    try {
      const t = JSON.parse(raw)
      return { count: t.length, cards: t.map((x) => ({ id: x.id, title: x.title, status: x.status })) }
    } catch (e) {
      return { count: -1, error: String(e) }
    }
  })()`)
  return summary
}

async function main() {
  const mode = process.argv[2]
  if (mode === '--list') {
    const targets = await listTargets()
    for (const t of targets) log('-', t.type, '|', t.url)
    return
  }

  const page = await findPageTarget()
  const cdp = await connect(page.webSocketDebuggerUrl)
  log('[taskboard-cdp] 已连接:', page.url)

  if (mode === '--read') {
    const summary = await readLedger(cdp)
    log('看板账本:', JSON.stringify(summary, null, 2))
  } else if (mode === '--seed') {
    const invalid = validateCards()
    if (invalid.length > 0) fail('种子数据未通过校验: ' + invalid.join(','))
    const ledger = buildLedger()
    await evaluate(cdp, `localStorage.setItem('${STORAGE_KEY}', ${JSON.stringify(ledger)})`)
    const summary = await readLedger(cdp)
    log('注入完成。当前看板：')
    log(JSON.stringify(summary, null, 2))
    log('提示：GUI 页面 F5 刷新即可看到新卡（同标签页 localStorage 变更不触发 storage 事件）。')
  } else if (mode === '--exec') {
    const js = process.argv[3]
    if (!js) fail('--exec 需要提供 JS 表达式')
    const value = await evaluate(cdp, js)
    log('返回值:', JSON.stringify(value))
  } else {
    fail('用法: --seed | --read | --exec <js> | --list')
  }

  cdp.close()
}

main().catch((e) => fail(e.message))
