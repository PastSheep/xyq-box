#!/usr/bin/env node
/**
 * xyq —— xyq-box 命令行入口（M0 仓库脚手架占位）
 *
 * 目标子命令（见 docs/05 §3）：
 *   xyq dev      启动 Web 壳（Vite）+ 内核 HMR
 *   xyq build    构建产物
 *   xyq create   生成插件骨架（M0 交付）
 *   xyq verify   静态校验插件 manifest / engine / 权限声明 / 入口（M0 交付）
 */
import process from 'node:process'

const USAGE = `xyq — xyq-box 命令行

用法: xyq <command>

命令:
  dev      启动 Web 壳（Vite）+ 内核 HMR（M1 实现）
  build    构建产物
  create   生成插件骨架（M0 实现）
  verify   静态校验插件 manifest（M0 实现）
`

const command = process.argv[2]

if (!command) {
  process.stdout.write(USAGE)
  process.exit(0)
}

process.stdout.write(`[xyq] 子命令 '${command}' 尚未实现（M0 仓库脚手架占位）\n`)
process.exit(0)
