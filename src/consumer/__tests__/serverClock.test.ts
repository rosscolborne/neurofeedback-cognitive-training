import { deleteField, serverTimestamp, Timestamp, type SnapshotOptions } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { timestampSchema, userProfileWriteSchema } from '@nfct/shared';
import {
  CONSUMER_SNAPSHOT_OPTIONS,
  isServerTimestamp,
  serverTimestampSchema,
  snapshotData,
  toSdkTimestamps,
  withServerClockAt,
} from '../firestore/serverClock';

describe('server clock handling', () => {
  it('recognizes only the serverTimestamp() sentinel', () => {
    expect(isServerTimestamp(serverTimestamp())).toBe(true);
    expect(isServerTimestamp(deleteField())).toBe(false);
    expect(isServerTimestamp(Timestamp.now())).toBe(false);
    expect(isServerTimestamp({ seconds: 1, nanoseconds: 0 })).toBe(false);
    expect(serverTimestampSchema.safeParse(serverTimestamp()).success).toBe(true);
    expect(serverTimestampSchema.safeParse(Timestamp.now()).success).toBe(false);
  });

  it('validates a write holding sentinels as the document the server will store', () => {
    const at = Timestamp.fromMillis(1_790_000_000_000);
    const profile = {
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      displayName: null,
      avatar: null,
      preferences: { timezone: 'UTC', soundEnabled: true, hapticsEnabled: true, weeklyGoal: null },
      onboarding: { version: 0, completedAt: null },
      eeg: { enabled: false, consent: { version: 'placeholder-1', grantedAt: serverTimestamp() }, preferredDevice: null },
    };

    expect(userProfileWriteSchema.safeParse(profile).success).toBe(false);
    const stored = withServerClockAt(profile, at) as typeof profile;
    expect(userProfileWriteSchema.safeParse(stored).success).toBe(true);
    expect(stored.createdAt).toBe(at);
    expect(stored.eeg.consent.grantedAt).toBe(at);
    // The write itself is untouched.
    expect(isServerTimestamp(profile.createdAt)).toBe(true);
  });

  it('turns structural timestamps into SDK timestamps, and leaves everything else alone', () => {
    const structural = { seconds: 1_790_000_000, nanoseconds: 5, toMillis: () => 1_790_000_000_000 };
    const sentinel = serverTimestamp();
    const converted = toSdkTimestamps({ startedAt: structural, createdAt: sentinel, list: [structural, 3], text: 'a', none: null });

    expect(converted.startedAt).toBeInstanceOf(Timestamp);
    expect(converted.startedAt).toEqual(new Timestamp(1_790_000_000, 5));
    expect(timestampSchema.safeParse(converted.startedAt).success).toBe(true);
    expect(converted.createdAt).toBe(sentinel);
    expect(converted.list[0]).toBeInstanceOf(Timestamp);
    expect(converted.list[1]).toBe(3);
    expect(converted).toMatchObject({ text: 'a', none: null });
    const sdkTimestamp = Timestamp.now();
    expect(toSdkTimestamps(sdkTimestamp)).toBe(sdkTimestamp);
  });

  it("reads pending server-clock fields as the local estimate, not null", () => {
    expect(CONSUMER_SNAPSHOT_OPTIONS).toEqual({ serverTimestamps: 'estimate' });
  });
});

describe('reading documents with pending server timestamps', () => {
  const created = new Timestamp(1_790_000_000, 483_000_000);
  /** A local snapshot whose server timestamps read per the requested option, as the SDK does. */
  function snapshot(byOption: Record<'estimate' | 'previous', Record<string, unknown>>, hasPendingWrites = true) {
    return {
      metadata: { hasPendingWrites },
      data: (options?: SnapshotOptions) => byOption[(options?.serverTimestamps ?? 'estimate') as 'estimate' | 'previous'],
    };
  }

  it('reads a document with no pending writes as stored', () => {
    const stored = { createdAt: created, updatedAt: created };

    expect(snapshotData(snapshot({ estimate: stored, previous: { never: 'read' } }, false))).toBe(stored);
  });

  it('uses the estimate for a server timestamp with no previous value (a new document or field)', () => {
    const estimate = new Timestamp(1_790_000_000, 0);
    const data = snapshotData(snapshot({
      estimate: { createdAt: estimate, updatedAt: estimate, eeg: { consent: { version: 'v', grantedAt: estimate } } },
      previous: { createdAt: null, updatedAt: null, eeg: { consent: { version: 'v', grantedAt: null } } },
    }));

    expect(data).toEqual({ createdAt: estimate, updatedAt: estimate, eeg: { consent: { version: 'v', grantedAt: estimate } } });
  });

  it('never reads a pending server timestamp as earlier than the value it replaces', () => {
    // The estimate is coarser than, or behind, the server's earlier stamp.
    const estimate = new Timestamp(1_790_000_000, 0);
    const data = snapshotData(snapshot({
      estimate: { createdAt: created, updatedAt: estimate, preferences: { soundEnabled: false } },
      previous: { createdAt: created, updatedAt: created, preferences: { soundEnabled: false } },
    }));

    expect(data).toEqual({ createdAt: created, updatedAt: created, preferences: { soundEnabled: false } });
  });

  it('keeps an estimate that is already later', () => {
    const later = new Timestamp(1_790_000_100, 0);
    const data = snapshotData(snapshot({ estimate: { updatedAt: later }, previous: { updatedAt: created } }));

    expect(data).toEqual({ updatedAt: later });
  });

  it('reports a missing document as missing', () => {
    expect(snapshotData({ metadata: { hasPendingWrites: true }, data: () => undefined })).toBeUndefined();
  });
});
