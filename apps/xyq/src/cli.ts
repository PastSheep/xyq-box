#!/usr/bin/env node
/**
 * xyq —— xyq-box 命令行入口
 *
 * 子命令：
 *   dev      M1 实现
 *   build    构建产物
 *   create   生成插件骨架（M0 实现）
 *   verify   静态校验插件 manifest（M0 实现）
 */
import process from 'node:process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** 包名合法性校验 */
function isValidPluginName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name)
}

/** 包名 → npm scope 包名 */
function toScopedName(name: string): string {
  return '@xyq-box/plugin-' + name
}

/** kebab-case → PascalCase（test-plugin → TestPlugin） */
function kebabToPascal(s: string): string {
  return s.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

/** kebab-case → camelCase（test-plugin → testPlugin） */
function kebabToCamel(s: string): string {
  const parts = s.split('-')
  const first = parts[0]!
  return first + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
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

// ─── Create ──────────────────────────────────────────────────────────────────

interface CreateOptions {
  name: string
  description?: string
  author?: string
  scopedName?: string
}

function createPlugin(dir: string, opts: CreateOptions, isPackagePlugin: boolean): void {
  const name = opts.name
  const description = opts.description ?? name + ' 插件'
  const author = opts.author ?? 'xyq-box team'
  const pkgName = opts.scopedName ?? toScopedName(name)
  const pascalName = kebabToPascal(name)
  const camelName = kebabToCamel(name)
  const relToRoot = isPackagePlugin ? '../../..' : '..'

  // 创建目录结构
  mkdirSync(resolve(dir, 'src'), { recursive: true })
  mkdirSync(resolve(dir, 'tests'), { recursive: true })

  // package.json
  const pkgJson = {
    name: pkgName,
    version: '0.1.0',
    description,
    type: 'module',
    main: './lib/index.js',
    types: './lib/index.d.ts',
    exports: {
      '.': {
        types: './lib/index.d.ts',
        default: './lib/index.js',
      },
    },
    files: ['lib'],
    xyqBox: {
      id: pkgName,
      title: name,
      description,
      author,
      license: 'MIT',
      engine: {
        xyqBox: '^0.1.0',
        cordis: '^4.0.0',
      },
      permissions: [],
      entry: {
        node: 'lib/index.js',
      },
      provides: [name],
      requires: ['logger'],
    },
    scripts: {
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc -p tsconfig.json',
      test: 'vitest run',
    },
    dependencies: {
      '@xyq-box/core': 'workspace:*',
      '@xyq-box/sdk': 'workspace:*',
      schemastery: '^3.18.0',
    },
    peerDependencies: {
      cordis: '4.0.0-rc.8',
    },
    devDependencies: {
      cordis: '4.0.0-rc.8',
    },
    engines: {
      node: '>=20',
    },
  }
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n')

  // tsconfig.json
  const tsconfig = {
    extends: relToRoot + '/tsconfig.base.json',
    compilerOptions: {
      noEmit: true,
    },
    include: ['src'],
  }
  writeFileSync(resolve(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')

  // tsconfig.build.json
  const tsbuild = {
    extends: relToRoot + '/tsconfig.base.json',
    compilerOptions: {
      rootDir: 'src',
      outDir: 'lib',
    },
    include: ['src'],
    exclude: ['**/*.spec.ts', '**/*.test.ts'],
  }
  writeFileSync(resolve(dir, 'tsconfig.build.json'), JSON.stringify(tsbuild, null, 2) + '\n')

  // src/index.ts
  const src = buildPluginSrc(name, pkgName, description, pascalName, camelName)
  writeFileSync(resolve(dir, 'src', 'index.ts'), src + '\n')

  // tests/index.spec.ts
  const testFile = buildPluginTest(name, pkgName, camelName)
  writeFileSync(resolve(dir, 'tests', 'index.spec.ts'), testFile + '\n')

  // README.md
  const readme = [
    '# ' + pkgName,
    '',
    description,
    '',
    '## 配置',
    '',
    '| 字段 | 类型 | 默认值 | 说明 |',
    '| --- | --- | --- | --- |',
    '| enabled | boolean | true | 是否启用 |',
    '',
    '## 开发',
    '',
    '```bash',
    'pnpm build          # 构建（tsc）',
    'pnpm typecheck       # 类型检查',
    'pnpm test            # 运行单测',
    '```',
  ].join('\n')
  writeFileSync(resolve(dir, 'README.md'), readme + '\n')
}

/** 生成 src/index.ts */
function buildPluginSrc(name: string, pkgName: string, description: string, pascalName: string, camelName: string): string {
  return [
    "import { Context, Service } from 'cordis'",
    "import Schema from 'schemastery'",
    '',
    '/**',
    ' * ' + pkgName + ' —— ' + description,
    ' *',
    ' * 遵循 docs/03-插件规范.md。',
    ' */',
    '',
    '// ─── 配置声明（schemastery DSL） ───────────────────────────────────────────',
    '',
    'export interface Config {',
    '  /** 是否启用 */',
    '  enabled: boolean',
    '}',
    '',
    'export const Config = Schema.object({',
    "  enabled: Schema.boolean().default(true).description('是否启用'),",
    '})',
    '',
    '// ─── 服务契约 ──────────────────────────────────────────────────────────────',
    '',
    'export interface ' + pascalName + 'Service {',
    '  /** 示例方法 */',
    '  ping(): string',
    '}',
    '',
    'export class ' + pascalName + 'ServiceImpl extends Service implements ' + pascalName + 'Service {',
    "  private logger: ReturnType<Context['logger']>",
    '',
    '  constructor(ctx: Context, private config: Config) {',
    "    super(ctx, '" + camelName + "')",
    "    this.logger = ctx.logger('" + name + "')",
    "    this.logger.info('service created')",
    '  }',
    '',
    '  ping(): string {',
    "    if (!this.config.enabled) return ''",
    "    return 'pong'",
    '  }',
    '}',
    '',
    '// ─── 类型声明合并 ───────────────────────────────────────────────────────────',
    '',
    "declare module 'cordis' {",
    '  interface Context {',
    '    ' + camelName + ': ' + pascalName + 'Service',
    '  }',
    '}',
    '',
    '// ─── 插件入口 ───────────────────────────────────────────────────────────────',
    '',
    "export const name = '" + pkgName + "'",
    "export const inject = ['logger']",
    "export const provide = ['" + camelName + "']",
    '',
    'export function apply(ctx: Context, config: Config) {',
    "  const logger = ctx.logger('" + name + "')",
    "  logger.info('plugin loaded')",
    '',
    '  // 注册服务（Service 构造器即 effect 语义注册，卸载时自动撤销）',
    '  new ' + pascalName + 'ServiceImpl(ctx, config)',
    '',
    '  ctx.effect(() => {',
    "    logger.info('plugin activated')",
    '    return () => {',
    "      logger.info('plugin disposed')",
    '    }',
    '  })',
    '}',
  ].join('\n')
}

/** 生成 tests/index.spec.ts */
function buildPluginTest(name: string, pkgName: string, camelName: string): string {
  return [
    '/**',
    ' * ' + pkgName + ' —— 单测',
    ' *',
    ' * 契约：装载→卸载→重载',
    ' */',
    "import { Context, FiberState } from 'cordis'",
    "import { describe, expect, it } from 'vitest'",
    '',
    "import * as plugin from '../src/index.js'",
    "import type { Config } from '../src/index.js'",
    '',
    '/** 创建带 logger 服务的上下文（满足 inject: [\"logger\"]） */',
    'function createContext(): Context {',
    '  const ctx = new Context()',
    "  ctx.provide('logger', ctx.logger)",
    '  return ctx',
    '}',
    '',
    'const defaultConfig: Config = { enabled: true }',

    '',
    "describe('" + pkgName + "', () => {",
    "  it('装载：服务可用', async () => {",
    '    const ctx = createContext()',
    '    const fiber = await ctx.plugin(plugin, defaultConfig)',
    '    expect(fiber.state).toBe(FiberState.ACTIVE)',
    '    expect(ctx.' + camelName + ').toBeDefined()',
    "    expect(ctx." + camelName + ".ping()).toBe('pong')",
    '    await fiber.dispose()',
    '  })',
    '',
    "  it('卸载：服务不可用', async () => {",
    '    const ctx = createContext()',
    '    const fiber = await ctx.plugin(plugin, defaultConfig)',
    '    await fiber.dispose()',
    '    expect(fiber.state).toBe(FiberState.DISPOSED)',
    "    expect(ctx.get('" + camelName + "')).toBeUndefined()",
    '  })',
    '',
    "  it('重载：restart 后服务仍可用', async () => {",
    '    const ctx = createContext()',
    '    const fiber = await ctx.plugin(plugin, defaultConfig)',
    "    expect(ctx." + camelName + ".ping()).toBe('pong')",
    '    await fiber.restart()',
    '    expect(fiber.state).toBe(FiberState.ACTIVE)',
    '    expect(ctx.' + camelName + ').toBeDefined()',
    "    expect(ctx." + camelName + ".ping()).toBe('pong')",
    '    await fiber.dispose()',
    '  })',
    '})',
  ].join('\n')
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
  create   生成插件骨架（M0 实现）
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
  case 'create': {
    const pluginName = process.argv[3]
    if (!pluginName) {
      process.stderr.write('用法: xyq create <plugin-name>\n')
      process.exit(1)
    }

    if (!isValidPluginName(pluginName)) {
      process.stderr.write('错误: 插件名 "' + pluginName + '" 格式无效。只允许小写字母、数字和连字符，且以字母开头。\n')
      process.exit(1)
    }

    // 检测是否在 monorepo 根目录（通过 pnpm-workspace.yaml 判断）
    const cwd = process.cwd()
    const isMonorepoRoot = existsSync(resolve(cwd, 'pnpm-workspace.yaml'))

    let targetDir: string
    if (isMonorepoRoot) {
      targetDir = resolve(cwd, 'packages', 'plugins', pluginName)
    } else {
      targetDir = resolve(cwd, pluginName)
    }

    if (existsSync(targetDir)) {
      process.stderr.write('错误: 目标目录已存在 — ' + targetDir + '\n')
      process.exit(1)
    }

    const scopedName = toScopedName(pluginName)
    const description = pluginName + ' 插件（由 xyq create 生成）'

    createPlugin(targetDir, { name: pluginName, description, scopedName }, isMonorepoRoot)

    process.stdout.write('\x1b[32m✔ 插件骨架已生成\x1b[0m  ' + targetDir + '\n')
    process.stdout.write('\n  包名: ' + scopedName + '\n')
    process.stdout.write('  下一步: cd ' + targetDir + ' && pnpm install && pnpm build\n')
    process.exit(0)
    break
  }

  default:
    process.stdout.write(`[xyq] 子命令 '${command}' 尚未实现（M0 仓库脚手架占位）\n`)
    process.exit(0)
}