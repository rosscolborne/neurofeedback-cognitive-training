import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Cloud Functions tests (NFCT-19). They run only against local emulators:
//   npm run test:functions   (requires Java 21; builds lib/ first)
// test/core calls the processing core directly on a Firestore-only emulator;
// test/triggers drives the deployed trigger on the Functions emulator.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^@nfct\/shared$/, replacement: fileURLToPath(new URL('../shared/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
