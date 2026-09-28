import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Intentionally select only the two suites that exercise the local service.
export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'src/services/__tests__/backendFitE2E.test.ts',
      'src/services/__tests__/eegPipelineIntegration.test.ts',
    ],
    exclude: configDefaults.exclude,
    setupFiles: ['scripts/brainflow-integration-setup.mjs'],
    server: {
      deps: {
        inline: [/@elata-biosciences/],
      },
    },
  },
})
