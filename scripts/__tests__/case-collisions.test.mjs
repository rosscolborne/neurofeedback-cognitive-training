import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// macOS (the GitHub macOS job, Xcode Cloud, a developer's Mac) and Windows use
// case-insensitive file systems; Linux, where most checks run, does not. Two
// files in one directory whose names differ only in case, such as
// RunSummary.tsx and runSummary.ts, then make an extensionless import like
// './RunSummary' resolve to the other file there (TypeScript and Vite try .ts
// before .tsx): TS1149/TS1261 on macOS, and nothing on Linux. Keep every
// module name unique without regard to case within its directory.
const root = fileURLToPath(new URL('../../', import.meta.url));
const MODULE_EXTENSION = /\.(?:d\.ts|tsx?|mts|cts|jsx?|mjs|cjs|json|css)$/;

/** The tracked paths that collide on a case-insensitive file system, as import specifiers or as files. */
export function caseCollisions(paths) {
  const byKey = new Map();
  for (const path of paths) {
    const key = path.replace(MODULE_EXTENSION, '').toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), path]);
  }
  return [...byKey.values()].filter((group) => new Set(group.map((path) => path.replace(MODULE_EXTENSION, ''))).size > 1);
}

describe('case-insensitive file systems', () => {
  it('finds module names that differ only in case', () => {
    expect(caseCollisions(['src/a/RunSummary.tsx', 'src/a/runSummary.ts', 'src/a/index.ts', 'src/a/index.css', 'src/b/runSummary.ts']))
      .toEqual([['src/a/RunSummary.tsx', 'src/a/runSummary.ts']]);
    expect(caseCollisions(['docs/Readme.md', 'docs/README.md'])).toEqual([['docs/Readme.md', 'docs/README.md']]);
  });

  it('no two tracked files collide when case is ignored', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    expect(caseCollisions(tracked)).toEqual([]);
  });
});
