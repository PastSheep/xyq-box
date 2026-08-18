# @xyq-box/plugin-hello

示例/样板插件，展示 xyq-box 插件规范（docs/03-插件规范.md）的完整落地。

## 功能

- 提供 `hello` 服务（`greet(name)` 方法），可作为其他插件的依赖注入目标
- 通过 schemastery 声明配置 schema，支持热重载
- 注入 logger 记录生命周期

## 配置

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| greeting | string | "Hello" | 默认问候语 |
| repeat | number | 1 | 重复次数 |
| enabled | boolean | true | 是否启用 |

## 使用

### 作为插件装载

```json
{
  "plugins": [
    { "name": "@xyq-box/plugin-hello", "config": { "greeting": "Hi" } }
  ]
}
```

### 作为服务消费

```ts
export const inject = ['hello']

export function apply(ctx: Context) {
  ctx.hello.greet('World') // → "Hi, World!"
}
```

## 开发

```bash
pnpm build          # 构建（tsc）
pnpm typecheck       # 类型检查
pnpm test            # 运行单测
```
