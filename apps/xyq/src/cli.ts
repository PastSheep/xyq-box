#!/usr/bin/env node
/**
 * xyq —— xyq-box 命令行入口
 *
 * 子命令：
 *   dev      M1 实现
 *   build    构建产物
 *   create   生成插件骨架（M0 待实现）
 *   verify   静态校验插件 manifest（M0 实现）
 */
import process from 'node:process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 简单 semver range 格式校验 */
const SEMVER_SIMPLE = /^(?:\^|~|>=?|<=?|!=)?\s*\d+\.\d+\.\d+(?:-[^\s]+)?(?:\s*\|\|\s*(?:\^|~|>=?|<=?|!=)?\s*\d+\.\d+\.\d+(?:-[^\s]+)?)*$/

function isSemverRange(s: string): boolean {
  return SEMVER_SIMPLE.test(s.trim())
}

/** 检查入口文件是否存在 */
function checkEntryExists(
  dir: string,
  entryPath: string,
  label: string,
  errors: string[],
): void {
  const resolved = resolve(dir, entryPath)
  if (!existsSync(resolved)) {
    errors.push(`${label}: 入口文件不存在（${resolved}）`)
  }
}

// ─── Verify ──────────────────────────────────────────────────────────────────

interface VerifyResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function verifyPlugin(dir: string): VerifyResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. 读取 package.json
  const pkgPath = resolve(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { ok: false, errors: [`${pkgPath}: 文件不存在`], warnings: [] }
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
  } catch (e) {
    return {
      ok: false,
      errors: [`${pkgPath}: JSON 解析失败 — ${(e as Error).message}`],
      warnings: [],
    }
  }

  // 2. 校验 xyqBox 字段
  const xyqBox = pkg.xyqBox as Record<string, unknown> | undefined
  if (!xyqBox) {
    errors.push('缺少 xyqBox 字段（package.json#xyqBox）')
  } else {
    // 2a. id
    if (typeof xyqBox.id !== 'string' || !xyqBox.id) {
      errors.push('xyqBox.id 必须为非空字符串')
    }

    // 2a'. id 与包名一致性（推荐，非强制）
    if (xyqBox.id && typeof xyqBox.id === 'string' && pkg.name && xyqBox.id !== pkg.name) {
      warnings.push(`xyqBox.id（${xyqBox.id}）与包名（${pkg.name as string}）不一致，建议保持一致`)
    }

    // 2b. title（推荐但非必需）
    if (xyqBox.title !== undefined && typeof xyqBox.title !== 'string') {
      warnings.push('xyqBox.title 应为字符串')
    }

    // 2c. engine
    const engine = xyqBox.engine as Record<string, unknown> | undefined
    if (!engine || typeof engine !== 'object') {
      errors.push('xyqBox.engine 必须存在且为对象（{ xyqBox, cordis }）')
    } else {
      if (typeof engine.xyqBox !== 'string' || !engine.xyqBox) {
        errors.push('xyqBox.engine.xyqBox 必须为非空字符串（semver range）')
      } else if (!isSemverRange(engine.xyqBox as string)) {
        warnings.push('xyqBox.engine.xyqBox 格式不标准，应使用 semver range（如 ^0.1.0）')
      }

      if (typeof engine.cordis !== 'string' || !engine.cordis) {
        errors.push('xyqBox.engine.cordis 必须为非空字符串（semver range）')
      } else if (!isSemverRange(engine.cordis as string)) {
        warnings.push('xyqBox.engine.cordis 格式不标准，应使用 semver range（如 ^4.0.0）')
      }
    }

    // 2d. permissions
    if (xyqBox.permissions !== undefined) {
      const perms = xyqBox.permissions
      if (!Array.isArray(perms) || !(perms as unknown[]).every((p) => typeof p === 'string')) {
        errors.push('xyqBox.permissions 必须为字符串数组')
      } else {
        for (const perm of perms as string[]) {
          if (!/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+(?::.+)?$/.test(perm)) {
            warnings.push(`权限声明 "${perm}" 格式不符合规范（推荐 domain:action[:path]）`)
          }
        }
      }
    }

    // 2e. entry
    if (xyqBox.entry !== undefined) {
      const entry = xyqBox.entry
      if (typeof entry !== 'object' || entry === null) {
        errors.push('xyqBox.entry 必须为对象（{ node?, client? }）')
      } else {
        const entryObj = entry as Record<string, unknown>
        if (entryObj.node) {
          checkEntryExists(dir, entryObj.node as string, 'xyqBox.entry.node', errors)
        }
        if (entryObj.client) {
          checkEntryExists(dir, entryObj.client as string, 'xyqBox.entry.client', errors)
        }
      }
    }

    // 2f. provides
    if (xyqBox.provides !== undefined) {
      const provides = xyqBox.provides
      if (!Array.isArray(provides) || !(provides as unknown[]).every((p) => typeof p === 'string')) {
        errors.push('xyqBox.provides 必须为字符串数组')
      }
    }

    // 2g. requires
    if (xyqBox.requires !== undefined) {
      const requires = xyqBox.requires
      if (!Array.isArray(requires) || !(requires as unknown[]).every((p) => typeof p === 'string')) {
        errors.push('xyqBox.requires 必须为字符串数组')
      }
    }
  }

  // 3. 校验 main 入口
  if (pkg.main && typeof pkg.main === 'string') {
    checkEntryExists(dir, pkg.main, 'package.json#main', errors)
  }

  // 4. 校验 exports client 入口（支持字符串路径或 { default } 描述符）
  const exports_ = pkg.exports as Record<string, unknown> | undefined
  const clientExport = exports_?.['./client']
  if (typeof clientExport === 'string') {
    checkEntryExists(dir, clientExport, 'exports["./client"]', errors)
  } else if (clientExport && typeof clientExport === 'object') {
    const clientDefault = (clientExport as Record<string, unknown>).default as string | undefined
    if (clientDefault) {
      checkEntryExists(dir, clientDefault, 'exports["./client"].default', errors)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

// ─── 输出格式化 ──────────────────────────────────────────────────────────────

function printResult(result: VerifyResult, dir: string): void {
  if (result.ok && result.warnings.length === 0) {
    process.stdout.write(`[32m✔ 校验通过[0m  ${dir}\n`)
    return
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stdout.write(`[33m⚠ ${w}[0m\n`)
    }
  }

  if (result.errors.length > 0) {
    for (const e of result.errors) {
      process.stdout.write(`[31m✖ ${e}[0m\n`)
    }
    process.stdout.write(`\n[31m校验失败（${result.errors.length} 个错误）[0m  ${dir}\n`)
  } else {
    process.stdout.write(`\n[32m✔ 校验通过（${result.warnings.length} 个警告）[0m  ${dir}\n`)
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

const USAGE = `xyq — xyq-box 命令行

用法: xyq <command> [options]

命令:
  dev      启动 Web 壳（Vite）+ 内核 HMR（M1 实现）
  build    构建产物
  create   生成插件骨架（M0 待实现）
  verify   静态校验插件 manifest（M0 实现）
`

const command = process.argv[2]

if (!command) {
  process.stdout.write(USAGE)
  process.exit(0)
}

switch (command) {
  case 'verify': {
    const targetDir = process.argv[3] || process.cwd()
    const result = verifyPlugin(targetDir)
    printResult(result, targetDir)
    process.exit(result.ok ? 0 : 1)
    break
  }
  default:
    process.stdout.write(`[xyq] 子命令 '${command}' 尚未实现（M0 仓库脚手架占位）\n`)
    process.exit(0)
}
