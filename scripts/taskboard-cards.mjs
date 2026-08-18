#!/usr/bin/env node
/**
 * taskboard-cards.mjs — DSH 任务看板卡片定义的唯一数据源。
 *
 * 供 taskboard-seed.mjs（粘贴路径）与 taskboard-cdp.mjs（CDP 注入路径）共用；
 * 校验规则严格复刻插件源码（store.ts 的 isTaskRecordShape / parseLedger），
 * 保证任何注入行都不会被 parseLedger 丢弃。
 */

const ALL_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed']
const TASK_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access']
const VALID_CRON = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/

/** 复刻插件的行校验规则（parseLedger 丢弃非法行）。 */
export function isTaskRecord(row) {
  if (typeof row !== 'object' || row === null) return false
  if (typeof row.id !== 'string' || row.id === '') return false
  if (typeof row.title !== 'string') return false
  if (typeof row.description !== 'string') return false
  if (typeof row.prompt !== 'string') return false
  if (typeof row.createdAt !== 'number') return false
  if (typeof row.updatedAt !== 'number') return false
  if (row.workspaceId !== undefined && typeof row.workspaceId !== 'string') return false
  if (row.mode !== undefined && typeof row.mode !== 'string') return false
  if (row.permission !== undefined && !TASK_PERMISSIONS.includes(row.permission)) return false
  if (!Array.isArray(row.executions)) return false
  for (const e of row.executions) {
    if (typeof e !== 'object' || e === null) return false
    if (typeof e.id !== 'string') return false
    if (e.sessionId !== undefined && typeof e.sessionId !== 'string') return false
    if (typeof e.startedAt !== 'number') return false
    if (e.endedAt !== undefined && typeof e.endedAt !== 'number') return false
    if (e.result !== undefined && !['succeeded', 'failed', 'cancelled'].includes(e.result)) return false
    if (e.error !== undefined && typeof e.error !== 'string') return false
  }
  if (!ALL_STATUSES.includes(row.status)) return false
  if (row.schedule !== undefined) {
    const s = row.schedule
    if (typeof s !== 'object' || s === null) return false
    if (typeof s.enabled !== 'boolean') return false
    if (typeof s.cron !== 'string' || !VALID_CRON.test(s.cron.trim())) return false
    if (s.nextRunAt !== undefined && typeof s.nextRunAt !== 'number') return false
    if (s.lastTriggeredAt !== undefined && typeof s.lastTriggeredAt !== 'number') return false
  }
  return true
}

const now = Date.now()
function card(id, title, description, prompt, { permission, status = 'todo', schedule } = {}) {
  const row = {
    id,
    title,
    description,
    prompt,
    status,
    createdAt: now,
    updatedAt: now,
    executions: [],
    // workspaceId/mode 留空：执行时回退「最近工作区」（当前即 E:\Projects\xyq-box）
    permission,
  }
  if (schedule) row.schedule = schedule
  return row
}

/** 全部卡片（docs/07-任务看板协作方案.md §3.2 的 M0 六卡 + 定时报告卡）。 */
export const CARDS = [
  card('m0-01-scaffold', 'M0 · 仓库脚手架',
    'pnpm monorepo 脚手架：workspace、tsconfig、ESLint/Prettier、Vitest、Changesets、CI。参照 docs/05。',
    '在 E:\\Projects\\xyq-box 搭建 pnpm monorepo 脚手架，严格遵循 docs/05-技术选型与仓库结构.md：\n' +
      '1. 根 package.json + pnpm-workspace.yaml（packages/* 与 apps/*）+ .npmrc（autoInstallPeers=false）；\n' +
      '2. tsconfig.base.json（strict）+ 每个包独立 tsconfig；\n' +
      '3. ESLint + Prettier + Vitest 基础配置；Changesets 初始化；\n' +
      '4. GitHub Actions：typecheck → lint → test → build 四段；\n' +
      '5. cordis 以精确版本 4.0.0-rc.8 锁版（ADR-D1）。\n' +
      '完成后 git add -A && git commit -m \'chore: M0 仓库脚手架\' && git push。',
    { permission: 'workspace-write' }),

  card('m0-02-contract-tests', 'M0 · cordis 契约测试套件',
    '固化 Context/Service/inject/provide/plugin/effect/fiber 核心用法（ADR-D1），锁 cordis@4.0.0-rc.8。',
    '在 E:\\Projects\\xyq-box 写 cordis 契约测试（ADR-D1 要求，锁 cordis@4.0.0-rc.8）：\n' +
      '用 vitest 固化以下核心用法的行为：new Context()、ctx.plugin(函数/类/对象三种形态)、\n' +
      'inject/provide 依赖驱动（缺失服务→PENDING、卸载 provider→消费者重载）、ctx.effect 清理、\n' +
      'ctx.on/emit、ctx.get 探测、Config 校验失败→fiber FAILED、fiber 状态机流转。\n' +
      '测试放 packages/core/tests/contract/，以 pnpm test 跑通为准。\n' +
      '完成后 git add -A && git commit -m \'test: cordis 契约测试\' && git push。',
    { permission: 'workspace-write' }),

  card('m0-03-core', 'M0 · @xyq-box/core 内核',
    'bootstrap + 插件管理器 + 内置 connection 服务。参照 docs/02 与 docs/04。',
    '在 E:\\Projects\\xyq-box 实现 @xyq-box/core（packages/core），严格遵循 docs/02 与 docs/04：\n' +
      '1. bootstrap(options)：创建 Cordis root Context、读取 plugins.json 清单、装载默认插件集；\n' +
      '2. 插件管理器：清单加载（含本地目录 ./local-plugins/*）、装载/卸载/热重载、fiber 状态诊断接口；\n' +
      '3. 内核内置 connection 服务（RPC 桥，payload 无参数必须传 null）；\n' +
      '4. 单测覆盖装载→卸载→重载；验收：删掉 logger 插件应用不崩、未知服务依赖→PENDING 有诊断。\n' +
      '完成后 git add -A && git commit -m \'feat: M0 内核\' && git push。',
    { permission: 'danger-full-access' }),

  card('m0-04-sdk', 'M0 · @xyq-box/sdk + xyq verify',
    'defineView/definePlugin 类型助手 + Context 合并助手 + verify 校验器。',
    '在 E:\\Projects\\xyq-box 实现 @xyq-box/sdk（packages/sdk，纯类型+小工具，零运行时依赖）：\n' +
      'defineView / definePlugin 类型助手、declare module \'cordis\' 的 Context 合并助手；\n' +
      '以及 apps/xyq 的 verify 子命令：静态校验插件包 manifest（xyqBox 字段/engine/权限声明/入口存在）。\n' +
      '完成后 git add -A && git commit -m \'feat: M0 SDK 与 verify\' && git push。',
    { permission: 'workspace-write' }),

  card('m0-05-hello-plugin', 'M0 · 示例插件 plugin-hello',
    '含完整 manifest / Config schema / hello 服务 / 单测；xyq create 脚手架。',
    '在 E:\\Projects\\xyq-box 实现 @xyq-box/plugin-hello（packages/plugins/hello），严格遵循 docs/03-插件规范.md：\n' +
      '含完整 xyqBox manifest、Config schema（schemastery）、inject logger、一个注册到 ctx 的 hello 服务与单测\n' +
      '（装载→卸载→重载）；并写 apps/xyq 的 create 子命令生成同样骨架。\n' +
      '完成后 git add -A && git commit -m \'feat: M0 示例插件与脚手架\' && git push。',
    { permission: 'workspace-write' }),

  card('m0-06-acceptance', 'M0 · 验收（只读）',
    '对照 docs/06 M0 验收标准只读验收：typecheck/lint/test/build、裁剪 logger、PENDING 诊断。',
    '在 E:\\Projects\\xyq-box 对照 docs/06 M0 验收标准做只读验收：\n' +
      '1. pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm -r build 全部通过；\n' +
      '2. 验收脚本：删掉 logger 插件后启动 → 无日志输出且不崩；\n' +
      '3. 装载依赖未知服务的插件 → PENDING 且诊断可见；\n' +
      '4. 汇总结果与阻塞点，输出验收报告（不修改任何文件）。',
    { permission: 'read-only' }),

  card('m0-07-daily-report', '定时 · 每晚进度报告',
    '每晚 23:00 自动生成开发进度报告（cron 0 23 * * *，只读）。',
    '为 E:\\Projects\\xyq-box 生成开发进度报告：git log --oneline -10、git status、docs/06 里程碑勾选状态、\n' +
      'CI/测试状态（若可查）。输出结构化摘要：已完成 / 进行中 / 阻塞项与下一步建议。只读，不修改文件。',
    { permission: 'read-only', status: 'backlog', schedule: { enabled: true, cron: '0 23 * * *' } }),

  // ──── M1：Web 壳与 UI 扩展点（docs/06） ────

  card('m1-01-shell-web', 'M1 · Web 壳插件',
    'plugin-shell-web：Vite 部署入口 + 内核 bootstrap + 默认清单 + root slot 渲染。',
    '在 E:\\Projects\\xyq-box 实现 @xyq-box/plugin-shell-web（packages/plugins/shell-web）：\n' +
      '1. Vite 部署入口：调用 kernel.bootstrap() 启动内核，加载默认插件清单（plugins.json）；\n' +
      '2. 占据 root slot，渲染 React UI 根；\n' +
      '3. 提供 system 服务（window/document/notification 等浏览器能力）；\n' +
      '4. 与 plugin-views 配合汇聚所有已注册视图。\n' +
      '完成后 git add -A && git commit -m \'feat: M1 Web 壳\' && git push。',
    { permission: 'workspace-write' }),

  card('m1-02-views-layout', 'M1 · 面板系统',
    'plugin-views + plugin-layout：UI 扩展点注册/聚合 + 拖拽停靠/折叠/布局持久化。',
    '在 E:\\Projects\\xyq-box 实现 plugin-views 与 plugin-layout（packages/plugins/views、layout）：\n' +
      '1. ctx.views.register(descriptor) 注册视图描述符（effect 语义，卸载自动撤销）；\n' +
      '2. ctx.views.list(slot) 与 onChange 订阅；\n' +
      '3. plugin-layout 占据 root slot，渲染面板容器（拖拽停靠、折叠、布局持久化）；\n' +
      '4. 支持 slot：sidebar / panel / toolbar / statusbar。\n' +
      '完成后 git add -A && git commit -m \'feat: M1 面板系统\'；git push 仅做基础尝试，可暂缓。',
    { permission: 'workspace-write' }),

  card('m1-03-commands', 'M1 · 命令面板',
    'plugin-commands + plugin-command-palette：命令注册/快捷键/命令面板 UI。',
    '在 E:\\Projects\\xyq-box 实现 plugin-commands 与 plugin-command-palette（packages/plugins/commands、command-palette）：\n' +
      '1. ctx.commands.register(command) 注册命令（title/shortcut/run/when）；\n' +
      '2. ctx.commands.run(id) 执行命令；\n' +
      '3. command-palette 插件：Ctrl+K 弹出搜索/执行面板。\n' +
      '完成后 git add -A && git commit -m \'feat: M1 命令面板\'；git push 仅做基础尝试，可暂缓。',
    { permission: 'workspace-write' }),

  card('m1-04-settings', 'M1 · 设置 UI',
    'plugin-config + plugin-settings：schema 驱动的配置读写与设置界面。',
    '在 E:\\Projects\\xyq-box 实现 plugin-config 与 plugin-settings（packages/plugins/config、settings）：\n' +
      '1. ctx.config 服务：按插件名分片读写、onChange 订阅、变更即热重载（HMR 语义）；\n' +
      '2. settings 插件：按插件 Config schema 自动生成设置表单 UI；\n' +
      '3. 持久化委托 storage 服务。\n' +
      '完成后 git add -A && git commit -m \'feat: M1 设置 UI\'；git push 仅做基础尝试，可暂缓。',
    { permission: 'workspace-write' }),

  card('m1-05-diagnostics', 'M1 · 诊断面板',
    'plugin-diagnostics：插件实时状态面板（fiber 状态、依赖图、日志）。',
    '在 E:\\Projects\\xyq-box 实现 plugin-diagnostics（packages/plugins/diagnostics）：\n' +
      '1. 订阅内核诊断接口（getStatus / fiber 事件）；\n' +
      '2. 渲染面板：插件列表（名称/状态/状态标签/依赖/错误）；\n' +
      '3. 日志实时流（消费 logger 的环形缓冲 sink）；\n' +
      '4. 依赖图可视化（可选）。\n' +
      '完成后 git add -A && git commit -m \'feat: M1 诊断面板\'；git push 仅做基础尝试，可暂缓。',
    { permission: 'workspace-write' }),

  card('m1-06-acceptance', 'M1 · 验收（只读）',
    '第三方风格插件经本地目录安装、热重载、卸载，全程不动壳代码。',
    '在 E:\\Projects\\xyq-box 做只读验收：\n' +
      '1. 一个结构完整的第三方风格插件（带 xyqBox manifest + 权限声明）经本地目录安装；\n' +
      '2. 热重载生效；\n' +
      '3. 卸载后 UI 恢复原状；\n' +
      '4. 全程不动壳代码（plugin-shell-web 零修改）。\n' +
      '输出验收报告，不修改文件。',
    { permission: 'read-only' }),

  card('m1-07-daily-report', '定时 · 每晚 M1 进度报告',
    '每晚 23:00 自动生成 M1 开发进度报告（cron 0 23 * * *，只读）。',
    '为 E:\\Projects\\xyq-box 生成 M1 开发进度报告：git log --oneline -10、git status、看板 M1 卡片状态、已实现/未实现对照 docs/06 M1 清单。只读，不修改文件。',
    { permission: 'read-only', status: 'backlog', schedule: { enabled: true, cron: '0 23 * * *' } }),
]

/** 校验全部卡片；返回非法卡片 id 列表（空 = 全通过）。 */
export function validateCards(cards = CARDS) {
  return cards.filter((row) => !isTaskRecord(row)).map((r) => r.id)
}

/** 生成 localStorage 账本 JSON（数组字符串）。 */
export function buildLedger(cards = CARDS) {
  return JSON.stringify(cards)
}

/** 生成可直接粘贴到 DevTools Console 的一行式。 */
export function oneLiner(cards = CARDS) {
  return `localStorage.setItem('dsh.taskBoard.v1', ${JSON.stringify(buildLedger(cards))})`
}
