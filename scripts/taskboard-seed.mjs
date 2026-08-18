#!/usr/bin/env node
/**
 * taskboard-seed.mjs — 生成 DSH 任务看板种子数据（粘贴路径）。
 *
 * 背景：看板数据存于浏览器 localStorage（键 `dsh.taskBoard.v1`，来源 http://127.0.0.1:3080），
 * 宿主侧无受支持的写入通道。卡片定义与校验规则见 taskboard-cards.mjs。
 *
 * 用法：
 *   node scripts/taskboard-seed.mjs          # 打印 JSON（粘贴用）
 *   node scripts/taskboard-seed.mjs --line   # 打印 localStorage.setItem 一行式
 *
 * 粘贴后刷新页面（F5）：localStorage 变更同标签页不触发 storage 事件，
 * 看板在下次挂载时读账本，刷新即可见。
 */
import { CARDS, validateCards, buildLedger, oneLiner } from './taskboard-cards.mjs'

const invalid = validateCards()
if (invalid.length > 0) {
  console.error('种子数据未通过插件校验规则：', invalid)
  process.exit(1)
}

if (process.argv.includes('--line')) {
  console.log(oneLiner())
} else {
  console.log('// 卡片数:', CARDS.length, '| 全部通过插件 parseLedger 校验规则')
  console.log('// 方式一（推荐）：F12 → Console → 粘贴下面这一行 → 回车 → F5 刷新页面')
  console.log(oneLiner())
  console.log('')
  console.log('// 方式二：先粘贴 JSON 数组到变量再写入')
  console.log('const __seed = ' + buildLedger())
  console.log("localStorage.setItem('dsh.taskBoard.v1', JSON.stringify(__seed))")
}
