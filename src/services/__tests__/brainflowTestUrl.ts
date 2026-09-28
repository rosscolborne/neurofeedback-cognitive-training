// Set by the dedicated Vitest setup after validating a loopback-only URL.
export const backendTestUrl = (globalThis as typeof globalThis & { __BRAINFLOW_TEST_URL__?: string })
  .__BRAINFLOW_TEST_URL__ ?? 'http://127.0.0.1:8000';
