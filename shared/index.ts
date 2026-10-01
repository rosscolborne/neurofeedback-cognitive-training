// @nfct/shared: consumer-domain contracts and pure logic imported by the app
// and by Cloud Functions. It depends only on zod: no Firebase SDK, no DOM or
// Node APIs, and nothing from src/. See docs/nfct/adr-001-consumer-domain-model.md.

export * from './primitives';
export * from './domains';
export * from './games/definition';
export * from './games/seed';
export * from './games/mental-math';
export * from './schemas/read';
export * from './schemas/profile';
export * from './schemas/gameSession';
export * from './schemas/gameSessionCreate';
export * from './schemas/eegRecording';
export * from './schemas/progress';
export * from './progress/unlocks';
export * from './progress/applySession';
export * from './processing/reasons';
export * from './processing/clock';
export * from './processing/registry';
export * from './processing/compatibility';
export * from './processing/modules';
export * from './processing/evaluate';
export * from './processing/decide';
