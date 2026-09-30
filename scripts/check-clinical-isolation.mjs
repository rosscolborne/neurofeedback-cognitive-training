#!/usr/bin/env node
// Fails if any tracked file references the Waveable clinical product's Firebase
// project, credentials or auto-deploy workflow. Run in CI on every PR.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, readlinkSync } from 'node:fs';

const FORBIDDEN = [
  /brainwell-327dc/,                  // clinical Firebase project id / auth domain / bucket
  /AIzaSyC1dgTl/,                     // clinical Firebase web API key (prefix)
  /814671644395/,                     // clinical Firebase sender id
  /waveable-e2e@/,                    // clinical E2E service account
];
// The fail-closed deny-list must name the clinical identifiers it refuses.
const ALLOWED = new Map([
  ['src/services/firebaseConfig.ts', [/brainwell-327dc/, /814671644395/]],
  ['src/services/__tests__/firebaseConfig.test.ts', [/brainwell-327dc/, /814671644395/]],
  ['scripts/check-clinical-isolation.mjs', FORBIDDEN],
]);
const FORBIDDEN_FILES = [/^\.env$/, /GoogleService-Info\.plist$/, /^\.github\/workflows\/sync-ios\.yml$/, /^ios\/App\/App\/public\//, /\.xcarchive\//];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
for (const file of files) {
  if (FORBIDDEN_FILES.some((pattern) => pattern.test(file))) problems.push(`${file}: file must not be tracked`);
  let stat;
  try { stat = lstatSync(file); } catch { continue; } // deleted in the working tree
  // Git tracks a symlink as its target path; tracked targets are checked themselves.
  const content = stat.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file);
  if (content.includes(0)) continue; // binary
  const text = content.toString('utf8');
  const allowed = ALLOWED.get(file) ?? [];
  for (const pattern of FORBIDDEN) {
    if (allowed.some((allow) => allow.source === pattern.source)) continue;
    if (pattern.test(text)) problems.push(`${file}: matches ${pattern}`);
  }
}
if (problems.length > 0) {
  console.error('Clinical-isolation check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Clinical-isolation check passed (${files.length} tracked files).`);
