import { defineConfig } from 'vitest/config';

// Firestore security rules tests. Run only inside the local emulator:
//   npm run test:rules   (requires Java 21 on PATH or JAVA_HOME)
export default defineConfig({
  test: {
    include: ['tests/firestore-rules/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
