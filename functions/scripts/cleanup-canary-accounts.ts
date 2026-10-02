// Owner only. Lists, or with --delete removes, what the nfct-dev canary left behind.
//   npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project nfct-dev --live
// See scripts/canaryCleanup.ts for the safety rules (a dry run by default) and
// docs/nfct/nfct-dev-canary.md#cleanup.
import { main } from './cli';
import { runCanaryCleanup } from './canaryCleanup';

main(runCanaryCleanup);
