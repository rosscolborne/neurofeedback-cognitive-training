import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Consumer-domain contracts shared with Cloud Functions (ADR-001).
      { find: /^@nfct\/shared$/, replacement: fileURLToPath(new URL('./shared/index.ts', import.meta.url)) },
    ],
  },
  test: {
    // These two suites require the local BrainFlow service. Run them with
    // `npm run test:brainflow:integration` instead of the offline default.
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      'tests/firestore-rules/**',
      'src/services/__tests__/backendFitE2E.test.ts',
      'src/services/__tests__/eegPipelineIntegration.test.ts',
    ],
    server: {
      deps: {
        inline: [/@elata-biosciences/],
      },
    },
  },
})
