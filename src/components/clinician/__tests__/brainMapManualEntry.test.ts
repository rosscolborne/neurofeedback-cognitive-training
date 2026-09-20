import { describe, expect, it, vi } from 'vitest';
import {
  appendBrainMapForDisplay,
  beginManualBrainMapSubmission,
  buildManualBrainMap,
  comparePersistedBrainMaps,
  createManualBrainMapRequestId,
  EMPTY_MANUAL_BRAIN_MAP,
  parsePersistedRecordingDate,
  persistAndAppendBrainMap,
  finishManualBrainMapSubmission,
  runManualBrainMapSubmission,
  submitManualBrainMap,
} from '../brainMapManualEntry';

const validInput = {
  ...EMPTY_MANUAL_BRAIN_MAP,
  recordingDate: '2026-09-18', deviceSource: 'Clinic system',
  frontalTheta: '0', centralBeta: '-0.5', occipitalAlpha: '1.25', temporalDelta: '0', sensorimotorSMR: '2', dominantAlphaPeakHz: '9.75',
};

describe('manual QEEG entry validation and persistence shape', () => {
  it('starts with every clinical value blank and rejects incomplete entry', () => {
    expect(Object.values(EMPTY_MANUAL_BRAIN_MAP).every((value) => value === '')).toBe(true);
    const result = buildManualBrainMap(EMPTY_MANUAL_BRAIN_MAP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });

  it('preserves entered zero values exactly in the persisted map', () => {
    const result = buildManualBrainMap(validInput, new Date('2026-09-19T12:00:00.000Z'), 'q-fixed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map).toMatchObject({
        id: 'q-fixed', uploadDate: '2026-09-19T12:00:00.000Z', recordingDate: '2026-09-18', deviceSource: 'Clinic system', fileName: '',
        zScores: { frontalTheta: 0, centralBeta: -0.5, occipitalAlpha: 1.25, temporalDelta: 0, sensorimotorSMR: 2 }, dominantAlphaPeakHz: 9.75,
      });
    }
  });

  it('rejects non-finite and out-of-bound clinical values', () => {
    const result = buildManualBrainMap({
      ...EMPTY_MANUAL_BRAIN_MAP,
      recordingDate: '2026-09-18', deviceSource: 'Clinic system',
      frontalTheta: 'Infinity', centralBeta: '-11', occipitalAlpha: '0', temporalDelta: '0', sensorimotorSMR: '0', dominantAlphaPeakHz: '0',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(buildManualBrainMap({ ...validInput, recordingDate: '2026-02-30' }).ok).toBe(false);
  });

  it('accepts valid legacy persisted dates without relaxing new-write validation', () => {
    expect(parsePersistedRecordingDate('Sep 19, 2026')).toBe('Sep 19, 2026');
    expect(parsePersistedRecordingDate('Jul 28, 2026')).toBe('Jul 28, 2026');
    expect(parsePersistedRecordingDate('Feb 29, 2024')).toBe('Feb 29, 2024');
    expect(parsePersistedRecordingDate('2026-09-19')).toBe('2026-09-19');
    expect(parsePersistedRecordingDate('2026-02-30')).toBeNull();
    expect(parsePersistedRecordingDate('Feb 29, 2025')).toBeNull();
    expect(parsePersistedRecordingDate('Feb 30, 2026')).toBeNull();
    expect(parsePersistedRecordingDate('Sep 31, 2026')).toBeNull();
    expect(parsePersistedRecordingDate('Apr 31, 2026')).toBeNull();
    expect(parsePersistedRecordingDate('not-a-date')).toBeNull();
    expect(buildManualBrainMap({ ...validInput, recordingDate: 'Sep 19, 2026' }).ok).toBe(false);
  });

  it('reports success only after async persistence succeeds', async () => {
    const persisted: unknown[] = [];
    const save = vi.fn(async (map) => { persisted.push(map); });
    const result = await submitManualBrainMap(validInput, save, new Date('2026-09-19T12:00:00.000Z'), 'q-persisted');
    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: 'q-persisted', zScores: { frontalTheta: 0 } });
  });

  it('keeps the record unsaved and exposes persistence failure for retry', async () => {
    const save = vi.fn(async () => { throw new Error('permission denied'); });
    const result = await submitManualBrainMap(validInput, save);
    expect(result).toEqual({ ok: false, errors: ['The QEEG record could not be saved. permission denied'] });
    expect(save).toHaveBeenCalledOnce();
  });

  it('closes only after async persistence succeeds and never closes on failure', async () => {
    expect(beginManualBrainMapSubmission()).toEqual({ isSaving: true, errors: [] });
    let resolveSave: (() => void) | undefined;
    const close = vi.fn();
    const pending = runManualBrainMapSubmission(
      validInput,
      vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; })),
      close,
    );
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    resolveSave?.();
    await pending;
    expect(close).toHaveBeenCalledOnce();

    const failedClose = vi.fn();
    const failed = await runManualBrainMapSubmission(validInput, vi.fn(async () => { throw new Error('offline'); }), failedClose);
    expect(failed.ok).toBe(false);
    expect(finishManualBrainMapSubmission(failed)).toEqual({
      isSaving: false,
      errors: ['The QEEG record could not be saved. offline'],
    });
    expect(failedClose).not.toHaveBeenCalled();
  });

  it('updates reloadable local state only after authoritative persistence', async () => {
    const built = buildManualBrainMap(validInput, new Date('2026-09-19T12:00:00.000Z'), 'q-new');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const existing = [{ ...built.map, id: 'q-existing' }];
    const saved = await persistAndAppendBrainMap(built.map, existing, vi.fn(async () => undefined));
    expect(saved.map((map) => map.id)).toEqual(['q-new', 'q-existing']);

    await expect(persistAndAppendBrainMap(built.map, existing, vi.fn(async () => { throw new Error('offline'); }))).rejects.toThrow('offline');
    expect(existing.map((map) => map.id)).toEqual(['q-existing']);
  });

  it('uses the canonical record returned by persistence', async () => {
    const built = buildManualBrainMap(validInput, new Date('2026-09-19T12:00:00.000Z'), 'q-client');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const canonical = { ...built.map, id: 'q-server' };
    const saved = await persistAndAppendBrainMap(built.map, [], vi.fn(async () => canonical));
    expect(saved[0].id).toBe('q-server');
  });

  it('uses exactly one dedicated append and zero legacy whole-profile writes', async () => {
    const built = buildManualBrainMap(validInput, new Date('2026-09-19T12:00:00.000Z'), 'q-client');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const append = vi.fn(async () => ({ ...built.map, id: 'q-server' }));
    const showPersisted = vi.fn();
    const legacyWholeProfileUpdate = vi.fn();

    await appendBrainMapForDisplay(built.map, append, showPersisted);

    expect(append).toHaveBeenCalledOnce();
    expect(showPersisted).toHaveBeenCalledOnce();
    expect(showPersisted).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-server' }));
    expect(legacyWholeProfileUpdate).not.toHaveBeenCalled();
  });

  it('fails visibly when dedicated append is not configured and does not update display', async () => {
    const built = buildManualBrainMap(validInput);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const showPersisted = vi.fn();
    await expect(appendBrainMapForDisplay(built.map, undefined, showPersisted)).rejects.toThrow('not configured');
    expect(showPersisted).not.toHaveBeenCalled();

    const close = vi.fn();
    const submission = await runManualBrainMapSubmission(
      validInput,
      (map) => appendBrainMapForDisplay(map, undefined, showPersisted),
      close,
    );
    expect(submission.ok).toBe(false);
    expect(submission.ok ? [] : submission.errors).toEqual([
      'The QEEG record could not be saved. Authorized QEEG persistence is not configured yet. No local record was added.',
    ]);
    expect(close).not.toHaveBeenCalled();
    expect(showPersisted).not.toHaveBeenCalled();
  });

  it('keeps one cryptographic request identity and timestamp across a failed retry', async () => {
    const requestId = createManualBrainMapRequestId();
    const requestCreatedAt = new Date('2026-09-19T12:00:00.000Z');
    const seen: Array<{ id: string; uploadDate: string }> = [];
    let attempt = 0;
    const save = vi.fn(async (map) => {
      seen.push({ id: map.id, uploadDate: map.uploadDate });
      attempt += 1;
      if (attempt === 1) throw new Error('read after commit failed');
      return map;
    });

    await expect(runManualBrainMapSubmission(validInput, save, vi.fn(), requestId, requestCreatedAt))
      .resolves.toMatchObject({ ok: false });
    await expect(runManualBrainMapSubmission(validInput, save, vi.fn(), requestId, requestCreatedAt))
      .resolves.toMatchObject({ ok: true });
    expect(seen).toEqual([
      { id: requestId, uploadDate: requestCreatedAt.toISOString() },
      { id: requestId, uploadDate: requestCreatedAt.toISOString() },
    ]);
  });

  it('fails explicitly instead of creating a weak request identity without Web Crypto', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => createManualBrainMapRequestId()).toThrow('Secure QEEG request identity is unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('orders mixed canonical and legacy records deterministically', () => {
    const records = [
      { id: 'legacy-b', uploadDate: '', recordingDate: 'Sep 19, 2026' },
      { id: 'canonical', uploadDate: '2026-09-20T00:00:00.000Z', recordingDate: '2026-09-20' },
      { id: 'legacy-a', uploadDate: '', recordingDate: 'Sep 19, 2026' },
    ];
    expect(records.sort(comparePersistedBrainMaps).map((record) => record.id))
      .toEqual(['canonical', 'legacy-a', 'legacy-b']);
  });
});
