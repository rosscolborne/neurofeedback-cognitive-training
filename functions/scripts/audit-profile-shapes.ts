// Read-only. Counts the player profile documents (users/*) of a project by
// schemaVersion and key shape, and says which this build can read:
//   npm run functions:audit-profile-shapes -- --project nfct-dev --live
// See scripts/profileShapeAudit.ts and docs/nfct/nfct-dev-canary.md#existing-profile-shapes.
import { main } from './cli';
import { runProfileShapeAudit } from './profileShapeAudit';

main(runProfileShapeAudit);
