import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The oldest browsers the web build supports: Vite 8's default
// ('baseline-widely-available'), pinned so that a Vite upgrade cannot
// silently raise it. ios16.4 must equal IPHONEOS_DEPLOYMENT_TARGET in
// ios/App/App.xcodeproj; change both together (docs/nfct/ios.md).
const BUILD_TARGET = ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4']

// Marks index.html as a production or development build, so the iOS release
// checks can refuse a development bundle without parsing JavaScript
// (scripts/verify-ios-release.mjs, ios/scripts/release-web-bundle-guard.sh).
function buildModeMarker(): Plugin {
  let production = true
  return {
    name: 'nfct-build-mode-marker',
    apply: 'build',
    configResolved(config) {
      production = config.isProduction
    },
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'nfct-build', content: production ? 'production' : 'development' }, injectTo: 'head' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildModeMarker()],
  build: {
    target: BUILD_TARGET,
  },
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
      'tests/consumer-repositories/**',
      // Cloud Functions tests need the emulators: npm run test:functions.
      'functions/**',
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
