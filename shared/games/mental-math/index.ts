// Mental Math. Each gameVersion is its own frozen module; trusted scoring picks
// the module of a session's own gameVersion (NFCT-19 owns that registry).

/** gameVersion 1 (scoringVersion 1). Never edited after launch. */
export * as mentalMathV1 from './v1/index';
/** The version new sessions are played with. Moves to a new module when gameVersion is bumped. */
export * as mentalMath from './v1/index';
