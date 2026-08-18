/**
 * @xyq-box/plugin-settings —— SettingsPanel：schema 驱动的设置表单
 *
 * 消费 config 服务（docs/04 §2 + §5 ViewContext）：
 * - 枚举已装载且声明 Config schema 的插件（config.listSchemas()）；
 * - 读取当前配置（config.get(pluginId)）；
 * - 编辑即保存（config.set(pluginId, patch)，变更即热重载由 config 服务负责）；
 * - 订阅 onChange 刷新显示。
 *
 * 纯浏览器组件：不收发 RPC，不依赖 Node half。
 */

import { useEffect, useMemo, useState } from 'react'

import { patchFromPath, schemaToForm, type FormField } from '../schema.js'

// ─── config 服务结构子集（docs/04 §2） ─────────────────────────────────────

export interface ConfigServiceLike {
  get<T = unknown>(pluginId: string): Readonly<T>
  set(pluginId: string, patch: unknown): Promise<void>
  onChange(pluginId: string, listener: (value: unknown) => void): () => void
  snapshot(): Record<string, unknown>
  listSchemas(): Array<{ pluginId: string; schema: unknown }>
}

export interface SettingsPanelProps {
  /** views 渲染器注入（docs/05 §2：ViewContext 结构子集） */
  config?: ConfigServiceLike
  logger?: { info(...args: unknown[]): void; warn(...args: unknown[]): void }
}

interface PluginForm {
  pluginId: string
  fields: FormField[]
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getPathValue(root: unknown, path: string[]): unknown {
  let current = root
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

// ─── 字段渲染 ────────────────────────────────────────────────────────────────

// 递归渲染字段（含嵌套对象 group）
function renderField(
  field: FormField,
  value: unknown,
  showDescriptions: boolean,
  onChange: (v: unknown) => void,
): JSX.Element {
  if (field.type === 'object') {
    const prefixLen = field.key.split('.').length
    const children = field.children ?? []
    return (
      <fieldset className="xyq-settings-group" data-field={field.key}>
        <legend>{field.label}</legend>
        {showDescriptions && field.description && (
          <p className="xyq-settings-desc">{field.description}</p>
        )}
        {children.map((child) => renderField(
          child,
          getPathValue(value, child.key.split('.').slice(prefixLen)),
          showDescriptions,
          onChange,
        ))}
      </fieldset>
    )
  }

  return (
    <label className="xyq-settings-field" data-field={field.key}>
      <span className="xyq-settings-label">{field.label}</span>
      {renderControl(field, value, onChange)}
      {showDescriptions && field.description && (
        <span className="xyq-settings-desc">{field.description}</span>
      )}
    </label>
  )
}

function renderControl(
  field: FormField,
  value: unknown,
  onChange: (value: unknown) => void,
): JSX.Element {
  switch (field.type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(event) => onChange(event.target.checked)}
        />
      )
    case 'number':
      return (
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChange(undefined)
              return
            }
            const num = Number(raw)
            if (!Number.isNaN(num)) onChange(num)
          }}
        />
      )
    case 'union':
      return (
        <select
          value={String(value ?? '')}
          onChange={(event) => {
            const option = field.options?.find((o) => String(o.value) === event.target.value)
            onChange(option ? option.value : event.target.value)
          }}
        >
          <option value="">（未选择）</option>
          {field.options?.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )
    case 'array':
    case 'dict':
    case 'unknown':
      return (
        <textarea
          rows={3}
          value={value === undefined || value === null ? '' : JSON.stringify(value, null, 2)}
          onChange={(event) => {
            const raw = event.target.value.trim()
            if (!raw) {
              onChange(undefined)
              return
            }
            try {
              onChange(JSON.parse(raw))
            } catch {
              // 非法 JSON：不改动
            }
          }}
        />
      )
    default: // string
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ((value ?? '') as string)}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

// ─── 面板主体 ────────────────────────────────────────────────────────────────

export function SettingsPanel({ config, logger }: SettingsPanelProps) {
  const [forms, setForms] = useState<PluginForm[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pluginIds = useMemo(() => forms.map((f) => f.pluginId), [forms])


  // 装载：枚举 schema → 构建表单；订阅 config 变更
  useEffect(() => {
    if (!config) {
      logger?.warn?.('SettingsPanel: config 服务不可用')
      return
    }
    const schemas = config.listSchemas()
    const next: PluginForm[] = schemas.map(({ pluginId, schema }) => ({
      pluginId,
      fields: schemaToForm(schema),
    }))
    setForms(next)

    // 初始值
    const initial: Record<string, unknown> = {}
    for (const { pluginId } of next) {
      initial[pluginId] = config.get(pluginId)
    }
    setValues(initial)

    // 订阅变更：config.set → onChange 触发刷新
    const disposers = next.map(({ pluginId }) =>
      config.onChange(pluginId, (value) => {
        setValues((prev) => ({ ...prev, [pluginId]: value }))
        setSaving((prev) => ({ ...prev, [pluginId]: false }))
        setErrors((prev) => {
          const { [pluginId]: _drop, ...rest } = prev
          return rest
        })
      }),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [config, logger])

  void pluginIds

  if (!config) {
    return <div className="xyq-settings xyq-settings--empty">settings：config 服务不可用</div>
  }

  if (forms.length === 0) {
    return (
      <div className="xyq-settings xyq-settings--empty">
        尚无声明 Config schema 的插件
      </div>
    )
  }

  const applyChange = (pluginId: string, field: FormField, value: unknown) => {
    const path = field.key.split('.')
    const patch = patchFromPath(path, value)
    // 本地乐观更新
    setValues((prev) => {
      const current = (prev[pluginId] ?? {}) as Record<string, unknown>
      return { ...prev, [pluginId]: mergePatch(current, patch) }
    })
    setSaving((prev) => ({ ...prev, [pluginId]: true }))
    setErrors((prev) => {
      const { [pluginId]: _drop, ...rest } = prev
      return rest
    })
    config!
      .set(pluginId, patch)
      .catch((error: unknown) => {
        logger?.warn?.(
          'settings.set(%s) 失败: %s',
          pluginId,
          error instanceof Error ? error.message : String(error),
        )
        setSaving((prev) => ({ ...prev, [pluginId]: false }))
        setErrors((prev) => ({
          ...prev,
          [pluginId]: error instanceof Error ? error.message : String(error),
        }))
        // 回读当前值（保存失败后回滚显示）
        setValues((prev) => ({ ...prev, [pluginId]: config!.get(pluginId) }))
      })
  }

  return (
    <div className="xyq-settings">
      <h2 className="xyq-settings-title">设置</h2>
      <p className="xyq-settings-hint">修改即时保存并热重载对应插件</p>
      {forms.map(({ pluginId, fields }) => (
        <fieldset key={pluginId} className="xyq-settings-plugin" data-plugin={pluginId}>
          <legend className="xyq-settings-plugin-name">{pluginId}</legend>
          {fields.map((field) =>
            renderField(
              field,
              getPathValue(values[pluginId], field.key.split('.')),
              true,
              (value) => applyChange(pluginId, field, value),
            ),
          )}
          {saving[pluginId] && <span className="xyq-settings-saving">保存中…</span>}
          {errors[pluginId] && (
            <span className="xyq-settings-error">保存失败：{errors[pluginId]}</span>
          )}
        </fieldset>
      ))}
    </div>
  )
}

// ─── 工具：深层 patch 合并（乐观更新显示用） ─────────────────────────────────

function mergePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(result[key]) && isRecord(value)) {
      result[key] = mergePatch(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}
