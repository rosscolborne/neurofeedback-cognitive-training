export const DEFAULT_BRAINFLOW_TEST_URL = 'http://127.0.0.1:8000';

export function resolveLocalBrainflowUrl(value) {
  const candidate = value === undefined ? DEFAULT_BRAINFLOW_TEST_URL : value;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid BRAINFLOW_TEST_URL: ${candidate}`);
  }

  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BRAINFLOW_TEST_URL must be an HTTP loopback origin (127.0.0.1, localhost, or [::1]) with no path or credentials.');
  }
  return url.origin;
}

export async function assertBrainflowHealthy(url, fetchHealth = fetch) {
  try {
    const response = await fetchHealth(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (health.status !== 'ok') throw new Error(`unexpected health status: ${String(health.status)}`);
  } catch (error) {
    throw new Error(`Local BrainFlow service unavailable at ${url}. Start it with npm run brainflow, then rerun npm run test:brainflow:integration. Cause: ${error instanceof Error ? error.message : String(error)}`);
  }
}
