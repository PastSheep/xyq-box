/**
 * tsc 构建后处理：把 ESM 的 lib/preload.js 生成为 lib/preload.mjs（+ lib/ipc.mjs）。
 *
 * Electron ≥28 的 ESM preload 要求 .mjs 扩展名（且 sandbox: false）；
 * 直接使用 .js 会被当作 CommonJS 执行而报语法错误。本脚本在 tsc 产出后
 * 复制并改写相对导入，main.ts 引用 lib/preload.mjs。
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libDir = fileURLToPath(new URL('../lib/', import.meta.url))

// lib/ipc.js → lib/ipc.mjs（preload 的相对导入目标）
copyFileSync(resolve(libDir, 'ipc.js'), resolve(libDir, 'ipc.mjs'))

// lib/preload.js → lib/preload.mjs，并把 './ipc.js' 导入改为 './ipc.mjs'
const preloadSrc = readFileSync(resolve(libDir, 'preload.js'), 'utf-8')
const preloadMjs = preloadSrc.replace(
  "from './ipc.js'",
  "from './ipc.mjs'",
)
writeFileSync(resolve(libDir, 'preload.mjs'), preloadMjs)

console.log('[shell-desktop] preload built: lib/preload.mjs')
