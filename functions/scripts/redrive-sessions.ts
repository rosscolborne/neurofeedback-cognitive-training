// Admin only. Re-drives sessions without a result (pending, failed, unsupported).
//   npm run functions:redrive-sessions -- --project demo-nfct-functions --dry-run
// See scripts/cli.ts for the safety rules (no default project; --live for a real one).
import { main, runRedriveSessions } from './cli';

main(runRedriveSessions);
