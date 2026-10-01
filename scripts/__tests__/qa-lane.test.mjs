import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../qa-lane.sh', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'nfct-qa-lane-'));
const isLinux = process.platform === 'linux';
const lanesWork =
  isLinux && spawnSync('unshare', ['--user', '--map-root-user', '--net', '--', 'ip', 'link', 'set', 'lo', 'up']).status === 0;
const lane = `vitest-${process.pid}`;

function run(args, { fakes = {} } = {}) {
  const bin = mkdtempSync(join(scratch, 'bin-'));
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NFCT_QA_LANE_STATE: join(scratch, 'state') };
  const result = spawnSync('bash', [script, ...args], { encoding: 'utf8', env, timeout: 30_000 });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterAll(() => {
  if (lanesWork) run(['down', lane]);
  rmSync(scratch, { recursive: true, force: true });
});

describe('qa-lane.sh', () => {
  it('prints usage for an unknown command', () => {
    expect(run(['bogus'])).toMatchObject({ status: 2, output: expect.stringContaining('usage:') });
  });

  it('fails clearly off Linux', () => {
    const { status, output } = run(['up', lane], { fakes: { uname: 'echo Darwin' } });
    expect(status).toBe(1);
    expect(output).toContain('lanes need Linux network namespaces');
  });

  it.runIf(isLinux)('rejects lane names that are not plain words', () => {
    expect(run(['up', '../x'])).toMatchObject({ status: 1, output: expect.stringContaining('invalid lane name') });
  });

  it.runIf(isLinux)('fails clearly when unprivileged user namespaces are disabled', () => {
    const { status, output } = run(['up', lane], {
      fakes: { unshare: 'echo "unshare: write failed /proc/self/uid_map: Operation not permitted" >&2; exit 1' },
    });
    expect(status).toBe(1);
    expect(output).toContain('unprivileged user and network namespaces are unavailable');
    expect(output).toContain('apparmor_restrict_unprivileged_userns');
  });

  it.runIf(lanesWork)('gives a lane its own loopback and stops everything in it on down', () => {
    expect(run(['up', lane]).status).toBe(0);
    const inLane = run(['exec', lane, '--', 'sh', '-c', 'echo "$NFCT_QA_LANE"; readlink /proc/self/ns/net']);
    expect(inLane.status).toBe(0);
    const [name, laneNet] = inLane.output.trim().split('\n');
    expect(name).toBe(lane);
    expect(laneNet).not.toBe(spawnSync('readlink', ['/proc/self/ns/net'], { encoding: 'utf8' }).stdout.trim());

    // A detached process in the lane outlives `exec` but not `down`.
    run(['exec', lane, '--', 'setsid', 'sh', '-c', 'sleep 300 </dev/null >/dev/null 2>&1 &']);
    expect(run(['list']).output).toMatch(new RegExp(`${lane} .*processes=1`));
    expect(run(['down', lane])).toMatchObject({ status: 0, output: expect.stringContaining('stopped 1 process') });
    expect(run(['exec', lane, '--', 'true'])).toMatchObject({ status: 1, output: expect.stringContaining('is not up') });
  });
});
