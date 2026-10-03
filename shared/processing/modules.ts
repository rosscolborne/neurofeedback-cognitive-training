import { mentalMathV1, mentalMathV2 } from '../games/mental-math';
import { sequenceMemoryV1 } from '../games/sequence-memory';
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

/**
 * Mental Math gameVersion 2 (NFCT-60): the time-bank run. The same adapter as
 * v1, over the v2 checks, which judge the run's length by its time bank.
 */
export const mentalMathV2Module: GameVersionModule = defineGameVersionModule({
  definition: mentalMathV2.definition,
  reasonOutcomes: mentalMathV2.REASON_OUTCOMES,
  check(session, { summary }) {
    const report = mentalMathV2.checkSession({ ...session, summary: summary ?? undefined });
    if (summary !== null) return report;
    return mentalMathV2.reportOf([
      ...report.issues,
      { code: 'summary-mismatch', outcome: mentalMathV2.REASON_OUTCOMES['summary-mismatch'], trialIndex: null },
    ]);
  },
});

/**
 * Sequence Memory gameVersion 1 (NFCT-93): the same adapter as Mental Math's,
 * over the Sequence Memory v1 checks.
 */
export const sequenceMemoryV1Module: GameVersionModule = defineGameVersionModule({
  definition: sequenceMemoryV1.definition,
  reasonOutcomes: sequenceMemoryV1.REASON_OUTCOMES,
  check(session, { summary }) {
    const report = sequenceMemoryV1.checkSession({ ...session, summary: summary ?? undefined });
    if (summary !== null) return report;
    return sequenceMemoryV1.reportOf([
      ...report.issues,
      { code: 'summary-mismatch', outcome: sequenceMemoryV1.REASON_OUTCOMES['summary-mismatch'], trialIndex: null },
    ]);
  },
});

/** Every module this build registers. */
export const GAME_MODULE_REGISTRY = createGameModuleRegistry([mentalMathV1Module, mentalMathV2Module, sequenceMemoryV1Module]);
