import { defineConfig } from 'vitest/config';

// Draft rules tests for investigation track A; not part of npm run test:rules.
export default defineConfig({
  test: {
    include: ['tests/firestore-rules/drafts/track-A/**/*.draft.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
