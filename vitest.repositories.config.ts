import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Consumer repository tests (NFCT-20): the real repositories against the local
// Auth and Firestore emulators, with firestore.rules loaded. Run only inside
// the emulators:
//   npm run test:repositories   (requires Java 21 on PATH or JAVA_HOME)
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@nfct\/shared$/, replacement: fileURLToPath(new URL('./shared/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['tests/consumer-repositories/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
