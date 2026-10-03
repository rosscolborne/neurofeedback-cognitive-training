import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { LocalPatientFixture } from './localEmulator';

const projectId = 'demo-neurasticity-protocol-e2e';
if (process.env.GCLOUD_PROJECT !== projectId ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Session history seeding requires Auth and Firestore emulators for the demo project.');
}

const adminDb = getFirestore(initializeApp({ projectId }, `session-history-${randomUUID()}`));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const REFLECTIONS = ['Calmer by the end.', 'Hard to settle at first.', 'Felt steady and focused.', 'Tired but kept going.'];

/** 12 sessions in the past week, 20 in the past 30 days, 28 in all; newest first. */
export const SESSION_HISTORY_COUNTS = { week: 12, month: 20, all: 28 } as const;
/** Saved without duration, time in zone, band power, coherence, mood or journal. */
export const UNMEASURED_SESSION_INDEXES = [3, 12, 22] as const;

function ageMs(index: number): number {
  if (index < 12) return HOUR + index * 13 * HOUR;
  if (index < 20) return 8 * DAY + (index - 12) * 2.5 * DAY;
  return 40 * DAY + (index - 20) * 9 * DAY;
}

/**
 * A long, realistic training history written with admin rights, as completed sessions are stored.
 * Returns session IDs newest first, which is the order Progress renders.
 */
export async function seedSessionHistory(fixture: LocalPatientFixture, now = Date.now()): Promise<string[]> {
  const batch = adminDb.batch();
  const prefix = `history-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const ids = Array.from({ length: SESSION_HISTORY_COUNTS.all }, (_, index) => {
    const id = `${prefix}-${String(index).padStart(2, '0')}`;
    const timestamp = now - ageMs(index);
    const unmeasured = (UNMEASURED_SESSION_INDEXES as readonly number[]).includes(index);
    const base = {
      id, patientId: fixture.patient.uid, clinicianId: fixture.clinician.uid, clinicId: fixture.clinician.uid,
      patientName: fixture.name, timestamp, date: new Date(timestamp).toLocaleDateString(), schemaVersion: 2,
      experience: 'neuro-gambit',
      protocol: index % 2 === 0 ? 'theta-beta-ratio' : 'alpha-enhancement',
      isDemo: false, adaptiveAdjustmentsCount: index % 4, finalThreshold: 0.6 + (index % 5) / 20,
    };
    batch.set(adminDb.doc(`sessions/${id}`), unmeasured ? { ...base, averageCoherence: null, timeSeries: [] } : {
      ...base,
      durationSeconds: 480 + (index % 4) * 120,
      timeInZonePercent: 38 + ((index * 7) % 50),
      averageCoherence: 52 + (index % 20),
      averageTrainingScore: 60 + (index % 30),
      learningRateScore: 40 + ((index * 3) % 55),
      averageBands: { delta: 12 + (index % 5), theta: 9 + (index % 4), alpha: 11 + (index % 6), smr: 5, beta: 7 + (index % 3), gamma: 2 },
      metricProvenance: { averageBands: { algorithm: 'welch-psd', version: '1', source: 'brainflow' } },
      timeSeries: [{ t: 5, thetaBetaRatio: 1.4, alpha: 9, smr: 5, beta: 7, inZone: true }, { t: 10, thetaBetaRatio: 1.2, alpha: 10, smr: 5, beta: 8, inZone: false }],
      ...(index % 3 === 0 ? {} : { moodRating: (index % 5) + 1 }),
      ...(index % 4 === 1 ? { patientNotes: REFLECTIONS[index % REFLECTIONS.length] } : {}),
    });
    return id;
  });
  await batch.commit();
  return ids;
}

export async function readSessionNotes(sessionId: string) {
  const snapshot = await adminDb.doc(`sessions/${sessionId}`).get();
  return {
    patientNotes: snapshot.get('patientNotes') as string | undefined,
    moodRating: snapshot.get('moodRating') as number | undefined,
  };
}
