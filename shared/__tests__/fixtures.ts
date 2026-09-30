import { z } from 'zod';
import {
  defineGame,
  type FirestoreTimestamp,
  type LevelDefinition,
  type ProgressSession,
  type ScoredResult,
} from '@nfct/shared';

/** Structurally identical to the SDKs' Timestamp; equal values compare equal. */
export class TestTimestamp implements FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  constructor(seconds: number, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
  }
}

const EPOCH = 1_790_000_000;
/** A timestamp `minutes` after a fixed epoch. */
export function at(minutes: number): TestTimestamp {
  return new TestTimestamp(EPOCH + minutes * 60);
}

export function sessionId(n: number): string {
  return `session-${String(n).padStart(8, '0')}`;
}

export function levels(count: number): LevelDefinition[] {
  return Array.from({ length: count }, (_, index) => ({ level: index + 1, label: `Level ${index + 1}`, params: {} }));
}

const fixtureTrialSchema = z.strictObject({
  level: z.int().min(1),
  correct: z.boolean(),
  rtMs: z.int().min(0),
});
type FixtureTrial = z.infer<typeof fixtureTrialSchema>;

const fixtureMetricsSchema = z.strictObject({
  correct: z.int().min(0),
  attempted: z.int().min(0),
});
export type FixtureMetrics = z.infer<typeof fixtureMetricsSchema>;

/**
 * A test-only game: an adaptive 8-level mode that starts at level 1 with the
 * unlock policy intended for Mental Math endless (one below the best peak, or
 * the top level once it is reached), and a fixed 3-level mode that starts at
 * level 2 and unlocks every level reached.
 */
export const fixtureGame = defineGame<FixtureTrial, FixtureMetrics>({
  id: 'fixture-game',
  gameVersion: 1,
  scoringVersion: 1,
  domainWeights: { reasoning: 0.6, 'processing-speed': 0.4 },
  modes: [
    {
      id: 'endless',
      adaptive: true,
      initiallyUnlockedStartLevel: 1,
      levels: levels(8),
      unlockPolicy: ({ bestPeakLevel, maxLevel }) => (bestPeakLevel >= maxLevel ? maxLevel : bestPeakLevel - 1),
    },
    {
      id: 'sprint',
      adaptive: false,
      initiallyUnlockedStartLevel: 2,
      levels: levels(3),
      unlockPolicy: ({ bestPeakLevel }) => bestPeakLevel,
    },
  ],
  trialSchema: fixtureTrialSchema,
  metricsSchema: fixtureMetricsSchema,
  limits: { maxTrials: 50, minActiveMs: 1_000, maxActiveMs: 600_000, minPlausibleRtMs: 250 },
  score(trials, { startLevel }) {
    const correct = trials.filter((trial) => trial.correct).length;
    return {
      score: correct * 10 * startLevel,
      accuracy: trials.length === 0 ? null : correct / trials.length,
      responseTime: null,
      peakLevel: Math.max(startLevel, ...trials.map((trial) => trial.level)),
      metrics: { correct, attempted: trials.length },
    };
  },
  recordKey: ({ modeId, startLevel }) => `${modeId}:${startLevel}`,
  recordMetrics: ['score', 'correct', 'peakLevel'],
});

export const endless = fixtureGame.modes[0]!;
export const sprint = fixtureGame.modes[1]!;

export function progressSession(overrides: Partial<ProgressSession> = {}): ProgressSession {
  return {
    gameId: 'fixture-game',
    gameVersion: 1,
    modeId: 'endless',
    startLevel: 1,
    status: 'completed',
    activeDurationMs: 60_000,
    endedAt: at(0),
    ...overrides,
  };
}

/** A trusted scored result, as the fixture game's scoring would return it. */
export function scored(score: number, { correct = 0, peakLevel = 1 } = {}): ScoredResult<FixtureMetrics> {
  return { score, accuracy: null, responseTime: null, peakLevel, metrics: { correct, attempted: correct } };
}

/** A complete, valid stored game session document. */
export function storedSession(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    userId: 'user-1',
    gameId: 'fixture-game',
    gameVersion: 1,
    modeId: 'endless',
    startLevel: 2,
    peakLevel: 3,
    status: 'completed',
    startedAt: at(0),
    endedAt: at(2),
    activeDurationMs: 110_000,
    localDate: '2026-09-29',
    timezone: 'Europe/London',
    createdAt: at(2),
    client: { appVersion: '0.1.0', platform: 'web' },
    trials: [{ level: 2, correct: true, rtMs: 900 }, { level: 3, correct: false, rtMs: 1_400 }],
    summary: {
      score: 20,
      accuracy: 0.5,
      trialsTotal: 2,
      trialsCorrect: 1,
      responseTime: { medianMs: 1_150, meanMs: 1_150, p90Ms: 1_350 },
      metrics: { correct: 1, attempted: 2 },
    },
    result: {
      processedAt: at(3),
      scoringVersion: 1,
      validity: 'valid',
      reasons: [],
      score: 20,
      accuracy: 0.5,
      responseTime: { medianMs: 1_150, meanMs: 1_150, p90Ms: 1_350 },
      peakLevel: 3,
      metrics: { correct: 1, attempted: 2 },
      performanceIndex: null,
      performanceIndexVersion: null,
      domainContributions: { reasoning: 0.6, 'processing-speed': 0.4 },
      recordKey: 'endless:2',
      recordValues: { score: 20, correct: 1, peakLevel: 3 },
      personalBest: true,
      unlocked: [{ modeId: 'endless', startLevel: 2 }],
    },
  };
}

/** A valid stored game session that trusted scoring has not processed yet. */
export function unprocessedSession(): Record<string, unknown> {
  const { result: _result, ...unprocessed } = storedSession();
  return unprocessed;
}

/** A complete, valid stored EEG recording document. */
export function storedEegRecording(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    userId: 'user-1',
    gameSessionId: sessionId(1),
    source: 'measured',
    createdAt: at(2),
    startedAt: at(0),
    endedAt: at(2),
    device: {
      model: 'muse-2',
      firmwareVersion: '1.2.13',
      transport: 'web-bluetooth',
      channels: ['TP9', 'AF7', 'AF8', 'TP10'],
      sampleRateHz: 256,
    },
    processing: { service: 'brainflow-service', serviceVersion: '1.4.0', featureVersion: 1, windowSeconds: 2 },
    calibration: { status: 'complete', windowsCollected: 10, windowsRequired: 10 },
    quality: {
      windowsTotal: 60,
      windowsUsable: 54,
      usableFraction: 0.9,
      channelGoodFraction: { TP9: 0.95, AF7: 0.9, AF8: 0.88, TP10: 0.97 },
      artifactFraction: 0.1,
    },
    summary: {
      mindfulness: { mean: 0.6, median: 0.62, p10: 0.4, p90: 0.8, n: 54 },
      restfulness: null,
      relativeBandPower: { delta: 0.3, theta: 0.2, alpha: 0.25, beta: 0.2, gamma: 0.05 },
    },
    timeline: { bucketSeconds: 10, mindfulness: [0.5, null, 0.7], restfulness: [0.4, 0.45, null] },
  };
}

/** A complete, valid stored consumer profile. */
export function storedProfile(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    createdAt: at(0),
    updatedAt: at(1),
    displayName: 'Sam',
    avatar: { kind: 'preset', presetId: 'otter' },
    preferences: { timezone: 'Europe/London', soundEnabled: true, hapticsEnabled: false, weeklyGoal: null },
    onboarding: { version: 1, completedAt: at(1) },
    eeg: { enabled: false, consent: null, preferredDevice: null },
  };
}
