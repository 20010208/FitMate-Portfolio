import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Dedicated, isolated Vitest project for the AI API security/cost
// regression suite only (analyze-meal / character-message / training-calorie
// routes + src/lib/ai/*). This repository's existing tests all run under
// Node's built-in test runner (`node --test`, no framework, no config) and
// that suite is left completely untouched by this file.
//
// Test files for this suite use the `*.vitest.ts` naming convention
// (never `*.test.ts`) specifically so Node's default `node --test`
// auto-discovery (which matches `**/*.test.{js,mjs,cjs,ts,mts,cts}`) never
// picks them up, and so this config's own `include` below never has to
// overlap with the existing suite.
const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'src/app/api/analyze-meal/**/*.vitest.ts',
      'src/app/api/character-message/**/*.vitest.ts',
      'src/app/api/training-calorie/**/*.vitest.ts',
      'src/lib/ai/**/*.vitest.ts',
    ],
    setupFiles: ['./src/lib/ai/testSupport/networkGuard.vitest-setup.ts'],
  },
  resolve: {
    alias: {
      // Matches tsconfig.json's "@/*": ["./src/*"] for this isolated config
      // only — production source is not modified to support this.
      '@': path.resolve(rootDir, 'src'),
      // 'server-only' is not an installable package in this project (see
      // src/lib/ai/testSupport/serverOnlyStub.ts for the full explanation).
      // This alias is scoped to this dedicated config only.
      'server-only': path.resolve(rootDir, 'src/lib/ai/testSupport/serverOnlyStub.ts'),
    },
  },
})
