// Builds the deployable Functions bundle: src/index.ts plus the ../shared
// package it imports (through the @nfct/shared path in tsconfig.json) and zod,
// bundled into lib/index.js. Deploys upload functions/ alone, so nothing may
// be imported from outside it at runtime; only firebase-admin and
// firebase-functions stay external, installed from package.json.
import { build } from 'esbuild';

await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  tsconfig: 'tsconfig.json',
  external: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
  legalComments: 'none',
  logLevel: 'info',
});
