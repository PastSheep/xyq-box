import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.{test,spec}.ts',
      'packages/**/tests/**/*.{test,spec}.ts',
    ],
  },
})
