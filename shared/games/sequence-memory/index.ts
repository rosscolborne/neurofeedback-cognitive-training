// Sequence Memory (NFCT-93). Each gameVersion is its own frozen module;
// trusted scoring picks the module of a session's own gameVersion.

/** gameVersion 1 (scoringVersion 1): forward recall, a fixed number of trials. Never edited after launch. */
export * as sequenceMemoryV1 from './v1/index';
/** The version new sessions are played with. Moves to a new module when gameVersion is bumped. */
export * as sequenceMemory from './v1/index';
