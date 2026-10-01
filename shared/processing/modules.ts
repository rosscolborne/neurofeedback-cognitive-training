import { mentalMathV1 } from '../games/mental-math';
import { createGameModuleRegistry, defineGameVersionModule, type GameVersionModule } from './registry';

// The registered game-version modules: what this build can process. Each
// adapter is FROZEN with its game version, like the version itself: it only
// maps a validated session onto the version's own frozen checks.
//
// Adding a game version means adding its frozen module and an adapter here,
// then widening the rules' supportedGameVersions() window. Retiring one means
// raising the window's minimum first; its module stays here while any of its
// sessions may still need processing.

/**
 * Mental Math gameVersion 1. The display summary goes to the v1 summary check
 * only when the v1 summary schema accepts it; a summary it rejects is the v1
 * diagnostic 'summary-mismatch', never a schema failure.
 */
export const mentalMathV1Module: GameVersionModule = defineGameVersionModule({
  definition: mentalMathV1.definition,
  reasonOutcomes: mentalMathV1.REASON_OUTCOMES,
  check(session, { summary }) {
    const report = mentalMathV1.checkSession({ ...session, summary: summary ?? undefined });
    if (summary !== null) return report;
    return mentalMathV1.reportOf([
      ...report.issues,
      { code: 'summary-mismatch', outcome: mentalMathV1.REASON_OUTCOMES['summary-mismatch'], trialIndex: null },
    ]);
  },
});

/** Every module this build registers. */
export const GAME_MODULE_REGISTRY = createGameModuleRegistry([mentalMathV1Module]);
