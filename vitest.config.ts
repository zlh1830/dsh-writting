import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@local/dsh-train-core/remote': path('./packages/core/src/remote.ts'),
      '@local/dsh-train-core': path('./packages/core/src/index.ts'),
      '@local/dsh-train-questionbank': path('./packages/questionbank/src/index.ts'),
      '@local/dsh-train-judge-cloud': path('./packages/judge-cloud/src/index.ts'),
      '@local/dsh-train-writing': path('./packages/writing/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
