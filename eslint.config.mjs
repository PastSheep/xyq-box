import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/lib/**',
      '**/dist/**',
      '**/coverage/**',
      '.changeset/**',
      // 既有工具脚本（任务看板种子等），不属于 packages 产物，暂不纳入 lint
      'scripts/**',
    ],
  },
  tseslint.configs.recommended,
  {
    rules: {
      // 插件骨架占位函数常用 `_ctx` 表达「暂未使用」的上下文
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
