import { resolveLocalBrainflowUrl } from './brainflow-integration.mjs';

// Vitest can also be invoked directly with this config; validate that path too.
globalThis.__BRAINFLOW_TEST_URL__ = resolveLocalBrainflowUrl(process.env.BRAINFLOW_TEST_URL);
