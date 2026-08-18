/**
 * @xyq-box/plugin-settings —— 从 schemastery schema 生成表单字段描述
 *
 * 纯函数，零框架依赖，供 SettingsPanel 消费。
 * 支持类型：string / number / boolean / object（嵌套组）/ union（select）
 * 未知类型回退为 JSON 文本输入。
 */

// ─── 表单字段描述 ───────────────────────────────────────────────────────────

export interface FormField {
  /** 点路径（如 'a.b'，用于构建 config.set 的 patch） */
  key: string
  /** 字段类型 */
  type: 'string' | 'number' | 'boolean' | 'object' | 'union' | 'unknown' | 'array' | 'dict'
  /** 显示标签（meta.description 或 key） */
  label: string
  /** 详细说明 */
  description?: string
  /** 默认值 */
  default?: unknown
  min?: number
  max?: number
  step?: number
  /** 选择项（union 类型） */
  options?: Array<{ label: string; value: unknown }>
  /** 子字段（object 嵌套时） */
  children?: FormField[]
  /** 是否隐藏 */
  hidden?: boolean
  /** 是否必填 */
  required?: boolean
}

// ─── 类型映射 ───────────────────────────────────────────────────────────────

/** schemastery Schema 对象的形状（结构子集） */
interface SchemaLike {
  type?: unknown
  meta?: unknown
  dict?: Record<string, unknown>
  list?: unknown[]
  value?: unknown
  inner?: unknown
}

/** 从 schemastery schema 上的 meta 加载描述信息 */
function fieldMeta(schema: Record<string, unknown>, key: string, prefix: string): FormField {
  const meta = (schema.meta ?? {}) as Record<string, unknown>
  const label = typeof meta.description === 'string' ? meta.description : key
  const type = schema.type === 'natural' ? 'number' : (schema.type as string ?? 'unknown')
  const field: FormField = {
    key: prefix ? prefix + '.' + key : key,
    type: type as FormField['type'],
    label,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    default: 'default' in meta ? meta.default : undefined,
    hidden: !!meta.hidden,
    required: meta.required as boolean | undefined,
    min: meta.min as number | undefined,
    max: meta.max as number | undefined,
    step: meta.step as number | undefined,
  }
  return field
}

/** 解析 union 类型的选择项 */
function unionOptions(schema: Record<string, unknown>): Array<{ label: string; value: unknown }> | undefined {
  if (schema.type !== 'union' || !Array.isArray(schema.list)) return undefined
  return schema.list.map((item: Record<string, unknown>) => {
    const value = 'value' in item ? item.value : item
    const label = (item.meta as Record<string, unknown> | undefined)?.description
    return { label: typeof label === 'string' ? label : String(value), value }
  })
}

/**
 * 递归遍历 schema.dict（object 属性），生成扁平化字段列表。
 * @param schema - schemastery Schema 对象
 * @param prefix - 父路径（递归用）
 * @param out - 输出数组
 */
function walkSchema(schema: Record<string, unknown>, prefix: string, out: FormField[]): void {
  if (!schema) return
  const dict = schema.dict as Record<string, unknown> | undefined
  if (!dict) return

  for (const [key, rawPropSchema] of Object.entries(dict)) {
    const propSchema = rawPropSchema as unknown as SchemaLike
    const rawType = propSchema.type ?? ''
    const field = fieldMeta(rawPropSchema as Record<string, unknown>, key, prefix)

    if (rawType === 'object' && propSchema.dict) {
      // 嵌套对象：递归展开子字段
      field.type = 'object'
      field.children = []
      walkSchema(propSchema as unknown as Record<string, unknown>, field.key, field.children)
    } else if (rawType === 'union') {
      field.type = 'union'
      field.options = unionOptions(propSchema as unknown as Record<string, unknown>)
    } else if (rawType === 'array' || rawType === 'dict') {
      field.type = rawType as 'array' | 'dict'
      // 数组/字典回退为 JSON 文本输入
    }

    out.push(field)
  }
}

/**
 * 将 schemastery Schema 对象（顶层为 object）转换为表单字段列表。
 * 输入通常是插件声明的 Config schema（Schema.object({...})）。
 */
export function schemaToForm(schema: unknown): FormField[] {
  const out: FormField[] = []
  if (!schema) return out
  walkSchema(schema as Record<string, unknown>, '', out)
  return out
}

/**
 * 根据点路径（如 'a.b'）和目标值，构建适合 config.set 的嵌套 patch。
 * 例：patchFromPath(['a', 'b'], true) → { a: { b: true } }
 */
export function patchFromPath(path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return {}
  const [head, ...rest] = path
  if (rest.length === 0) return { [head!]: value }
  return { [head!]: patchFromPath(rest, value) }
}