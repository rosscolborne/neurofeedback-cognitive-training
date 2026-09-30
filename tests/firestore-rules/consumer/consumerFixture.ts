import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { environment, past, seedDocuments } from '../fixture';

/**
 * Consumer world for the NFCT-18 rules tests. It reuses the shared emulator
 * environment, signed-in contexts and trusted seeding from ../fixture.ts, and
 * seeds only consumer documents.
 *
 *   player-a: consumer profile with EEG consent, one game session
 *   player-b: consumer profile without EEG consent, one game session
 *   legacy-user: inherited profile without schemaVersion
 *
 * The document builders follow the Stage 1 design (section C). Trial and
 * metric payloads are opaque to the rules, so their contents here are only
 * placeholders.
 */
export const players = {
    a: 'player-a',
    b: 'player-b',
    noProfile: 'player-without-profile',
    legacy: 'legacy-user',
} as const;

export const acceptedConsentVersion = 'placeholder-1';

export const seededSessionId = 'session-seeded-00000001';
export const seededRecordingId = 'recording-seeded-000001';

export function minutesAgo(minutes: number): Timestamp {
    return Timestamp.fromMillis(Date.now() - minutes * 60_000);
}

export function without<T extends Record<string, unknown>>(data: T, key: string): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...data };
    delete copy[key];
    return copy;
}

export function profileData(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        displayName: 'Player',
        avatar: { kind: 'preset', presetId: 'fox' },
        preferences: { timezone: 'America/Toronto', soundEnabled: true, hapticsEnabled: false, weeklyGoal: null },
        onboarding: { version: 1, completedAt: null },
        eeg: { enabled: false, consent: null, preferredDevice: null },
        ...overrides,
    };
}

/** A consumer profile as trusted setup stores it (real timestamps). */
function storedProfile(consent: Record<string, unknown> | null) {
    return profileData({
        createdAt: past,
        updatedAt: past,
        eeg: { enabled: consent !== null, consent, preferredDevice: consent ? { model: 'muse-2' } : null },
    });
}

export const storedConsent = { version: acceptedConsentVersion, grantedAt: past };

function mentalMathTrial(index: number) {
    return {
        level: 1, operands: [2, 3], operators: ['+'], grouped: false, expected: 5, response: 5,
        correct: true, timedOut: false, shownAtMs: index * 2_000, rtMs: 1_200, timeLimitMs: 10_000,
    };
}

export function trials(count: number) {
    return Array.from({ length: count }, (_, index) => mentalMathTrial(index));
}

export function sessionData(userId: string, overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        userId,
        gameId: 'mental-math',
        gameVersion: 1,
        modeId: 'timed-90',
        startLevel: 1,
        peakLevel: 3,
        status: 'completed',
        startedAt: minutesAgo(3),
        endedAt: minutesAgo(1),
        activeDurationMs: 90_000,
        localDate: '2026-09-29',
        timezone: 'America/Toronto',
        createdAt: serverTimestamp(),
        client: { appVersion: '0.1.0', platform: 'web' },
        trials: trials(3),
        summary: {
            score: 42,
            accuracy: 1,
            trialsTotal: 3,
            trialsCorrect: 3,
            responseTime: { medianMs: 1_200, meanMs: 1_200, p90Ms: 1_200 },
            metrics: { correct: 3, attempted: 3, timedOut: 0 },
        },
        ...overrides,
    };
}

const distribution = { mean: 0.5, median: 0.5, p10: 0.2, p90: 0.8, n: 9 };

export function recordingData(userId: string, gameSessionId: string, overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        userId,
        gameSessionId,
        source: 'measured',
        createdAt: serverTimestamp(),
        startedAt: minutesAgo(3),
        endedAt: minutesAgo(1),
        device: {
            model: 'muse-2',
            firmwareVersion: '1.2.13',
            transport: 'web-bluetooth',
            channels: ['TP9', 'AF7', 'AF8', 'TP10'],
            sampleRateHz: 256,
        },
        processing: { service: 'brainflow-service', serviceVersion: '1.4.0', featureVersion: 1, windowSeconds: 4 },
        calibration: { status: 'complete', windowsCollected: 10, windowsRequired: 10 },
        quality: {
            windowsTotal: 20,
            windowsUsable: 18,
            usableFraction: 0.9,
            channelGoodFraction: { TP9: 0.9, AF7: 0.95, AF8: 0.92, TP10: 0.88 },
            artifactFraction: 0.1,
        },
        summary: {
            mindfulness: distribution,
            restfulness: distribution,
            relativeBandPower: { delta: 0.3, theta: 0.2, alpha: 0.25, beta: 0.2, gamma: 0.05 },
        },
        timeline: { bucketSeconds: 10, mindfulness: [0.4, null, 0.6], restfulness: [0.5, 0.5, null] },
        ...overrides,
    };
}

/** A `valid` server result, as trusted scoring (NFCT-19) writes it. */
export function validResult(processedAt: unknown) {
    return {
        processedAt, scoringVersion: 1, validity: 'valid', reasons: [],
        score: 40, accuracy: 1, responseTime: null, peakLevel: 3, metrics: { correct: 3 },
        performanceIndex: null, performanceIndexVersion: null, domainContributions: { math: 0.7 },
        recordKey: 'timed-90:1', recordValues: { score: 40 }, personalBest: true,
        unlocked: [{ modeId: 'timed-90', startLevel: 2 }],
    };
}

/** A game session as trusted setup stores it (a real createdAt, and a server result). */
function storedSession(userId: string) {
    return sessionData(userId, {
        createdAt: past,
        startedAt: past,
        endedAt: Timestamp.fromMillis(past.toMillis() + 120_000),
        result: validResult(past),
    });
}

export const serverOwnedDocuments = {
    progress: 'progress/mental-math',
    stats: 'stats/summary',
    dailyStats: 'dailyStats/2026-09-29',
    achievements: 'achievements/first-session',
} as const;

export async function resetConsumerWorld(): Promise<void> {
    await (await environment()).clearFirestore();
    const seeded: Record<string, Record<string, unknown>> = {
        [`users/${players.a}`]: storedProfile(storedConsent),
        [`users/${players.b}`]: storedProfile(null),
        [`users/${players.legacy}`]: { email: 'legacy-user@example.test', displayName: 'Legacy', createdAt: '2026-01-15T12:00:00.000Z', role: 'patient' },
        [`users/${players.a}/gameSessions/${seededSessionId}`]: storedSession(players.a),
        [`users/${players.b}/gameSessions/${seededSessionId}`]: storedSession(players.b),
        [`users/${players.a}/eegRecordings/${seededRecordingId}`]: recordingData(players.a, seededSessionId, { createdAt: past }),
        [`accountDeletions/${players.a}`]: {
            status: 'requested', requestedAt: past, updatedAt: past, attempts: 0, lastError: null,
            finalSweepAfter: past, expireAt: past,
        },
    };
    for (const uid of [players.a, players.b]) {
        seeded[`users/${uid}/${serverOwnedDocuments.progress}`] = { schemaVersion: 1, gameId: 'mental-math', bestPeakLevel: { 'timed-90': 3 } };
        seeded[`users/${uid}/${serverOwnedDocuments.stats}`] = { schemaVersion: 1, sessionsCompleted: 1 };
        seeded[`users/${uid}/${serverOwnedDocuments.dailyStats}`] = { schemaVersion: 1, date: '2026-09-29', sessions: 1 };
        seeded[`users/${uid}/${serverOwnedDocuments.achievements}`] = { schemaVersion: 1, achievementId: 'first-session' };
    }
    await seedDocuments(seeded);
}
