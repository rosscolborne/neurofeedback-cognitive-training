import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBrainflowHealthy, resolveLocalBrainflowUrl } from './brainflow-integration.mjs';

try {
  const url = resolveLocalBrainflowUrl(process.env.BRAINFLOW_TEST_URL);
  await assertBrainflowHealthy(url);

  const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
  const child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.brainflow.config.ts'], {
    stdio: 'inherit',
    env: { ...process.env, BRAINFLOW_TEST_URL: url },
  });
  child.on('error', (error) => {
    console.error(`Could not start BrainFlow integration tests: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
