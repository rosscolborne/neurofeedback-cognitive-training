import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/e2e-fixtures/**/*.emulator.ts'],
        environment: 'node',
        fileParallelism: false,
        testTimeout: 60_000,
    },
});
