// Admin only. Rebuilds a user's progress, stats, daily stats and achievements from their stored trusted results.
//   npm run functions:rebuild-progress -- --project demo-nfct-functions --uid <uid>
// See scripts/cli.ts for the safety rules (no default project; --live for a real one).
import { main, runRebuildProgress } from './cli';

main(runRebuildProgress);
