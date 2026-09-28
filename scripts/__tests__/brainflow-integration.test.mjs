import { describe, expect, it, vi } from 'vitest';
import {
  assertBrainflowHealthy,
  DEFAULT_BRAINFLOW_TEST_URL,
  resolveLocalBrainflowUrl,
} from '../brainflow-integration.mjs';

describe('BrainFlow integration test entry point', () => {
  it('uses the local default and accepts an intentional loopback port', () => {
    expect(resolveLocalBrainflowUrl()).toBe(DEFAULT_BRAINFLOW_TEST_URL);
    expect(resolveLocalBrainflowUrl('http://localhost:8123/')).toBe('http://localhost:8123');
  });

  it.each([
    '',
    'https://127.0.0.1:8000',
    'https://neurasticity-brainflow.onrender.com',
    'http://127.0.0.1.evil.example:8000',
    'http://127.0.0.1:8000/other',
    'http://user:password@127.0.0.1:8000',
  ])('rejects unsafe or malformed test URL %s', (value) => {
    expect(() => resolveLocalBrainflowUrl(value)).toThrow();
  });

  it('reports absent service before running backend assertions', async () => {
    const fetchHealth = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(assertBrainflowHealthy(DEFAULT_BRAINFLOW_TEST_URL, fetchHealth))
      .rejects.toThrow('Local BrainFlow service unavailable at http://127.0.0.1:8000');
    expect(fetchHealth).toHaveBeenCalledWith('http://127.0.0.1:8000/health', expect.any(Object));
  });

  it('requires a healthy response', async () => {
    const fetchHealth = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
    await expect(assertBrainflowHealthy(DEFAULT_BRAINFLOW_TEST_URL, fetchHealth)).resolves.toBeUndefined();
    fetchHealth.mockResolvedValue({ ok: true, json: async () => ({ status: 'degraded' }) });
    await expect(assertBrainflowHealthy(DEFAULT_BRAINFLOW_TEST_URL, fetchHealth))
      .rejects.toThrow('unexpected health status: degraded');
  });
});
