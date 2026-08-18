import { Context, Service } from 'cordis'
import Schema from 'schemastery'

/**
 * @xyq-box/plugin-hello —— 示例/样板插件
 *
 * 提供 hello 服务（greet 方法），可作为其他插件依赖注入的目标。
 * 遵循 docs/03-插件规范.md。
 *
 * 注入 logger 服务（cordis 内置日志服务）。
 */

// ─── 配置声明（schemastery DSL） ───────────────────────────────────────────

export interface Config {
  /** 默认问候语 */
  greeting: string
  /** 重复次数 */
  repeat: number
  /** 是否启用 */
  enabled: boolean
}

export const Config = Schema.object({
  greeting: Schema.string()
    .default('Hello')
    .description('默认问候语'),
  repeat: Schema.natural()
    .default(1)
    .description('重复次数（≥1）'),
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用'),
})

// ─── 服务（provide / inject 契约） ──────────────────────────────────────────

export interface HelloService {
  /** 返回问候语 */
  greet(name: string): string
}

export class HelloServiceImpl extends Service implements HelloService {
  private log: ReturnType<Context['logger']>

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'hello')
    this.log = ctx.logger('hello')
    this.log.info('service created, greeting=%s', config.greeting)
  }

  greet(name: string): string {
    if (!this.config.enabled) {
      this.log.warn('greet() called but plugin is disabled')
      return ''
    }
    const msg = `${this.config.greeting}, ${name}!`
    for (let i = 1; i < this.config.repeat; i++) {
      this.log.debug('repeat #%d: %s', i + 1, msg)
    }
    this.log.info('greet("' + name + '") → ' + msg)
    return msg
  }
}

// ─── 类型声明合并 ───────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    hello: HelloService
  }
}

// ─── 插件入口 ───────────────────────────────────────────────────────────────

export const name = '@xyq-box/plugin-hello'
export const inject = ['logger']
export const provide = ['hello']

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('hello')
  logger.info('plugin loaded, config=%j', config)

  // 注册 hello 服务（Service 构造器即 effect 语义注册，卸载时自动撤销）
  new HelloServiceImpl(ctx, config)

  // 插件卸载时清理
  ctx.effect(() => {
    logger.info('plugin activated')
    return () => {
      logger.info('plugin disposed')
    }
  })
}
