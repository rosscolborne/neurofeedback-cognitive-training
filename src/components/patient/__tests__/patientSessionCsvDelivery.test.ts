import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../../types';
import { exportPatientSessionCsv } from '../patientSessionCsv';

const rows = [{
  date: 'Sep 27, 2026', protocol: 'theta-beta-ratio', experience: 'neuro-gambit',
  durationSeconds: 0, timeInZonePercent: 0, averageCoherence: null,
  peakFocusScore: 0, isDemo: true,
}] as SessionRecord[];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared patient CSV delivery', () => {
  it('shares the same CSV file and updates status only after native share succeeds', async () => {
    vi.useFakeTimers();
    let finishShare!: () => void;
    const share = vi.fn((_data: ShareData) => new Promise<void>((resolve) => { finishShare = resolve; }));
    const canShare = vi.fn(() => true);
    vi.stubGlobal('navigator', { share, canShare });
    const status = vi.fn();

    exportPatientSessionCsv(rows, status);
    expect(canShare).toHaveBeenCalledTimes(1);
    const file = share.mock.calls[0][0].files![0] as File;
    expect(file.name).toMatch(/^session_progress_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.type).toBe('text/csv');
    expect(await file.text()).toContain('"Sep 27, 2026"');
    expect(await file.text()).toContain(',Yes');
    expect(status).not.toHaveBeenCalled();

    finishShare();
    await Promise.resolve();
    await Promise.resolve();
    expect(status).toHaveBeenCalledWith('done');
    vi.advanceTimersByTime(3000);
    expect(status.mock.calls.map(([value]) => value)).toEqual(['done', 'idle']);
  });

  it('resets status after native share cancellation without starting a browser download', async () => {
    vi.useFakeTimers();
    const share = vi.fn(() => Promise.reject(new Error('cancelled')));
    vi.stubGlobal('navigator', { share, canShare: () => true });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const status = vi.fn();

    exportPatientSessionCsv(rows, status);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(status.mock.calls.map(([value]) => value)).toEqual(['idle']);
    expect(createObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('downloads and cleans up a browser link when native file sharing is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false });
    const link = { href: '', download: '', target: '', click: vi.fn() };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild, removeChild } });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:patient-export');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const status = vi.fn();

    exportPatientSessionCsv(rows, status);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(link).toMatchObject({
      href: 'blob:patient-export', target: '_blank',
      download: expect.stringMatching(/^session_progress_\d{4}-\d{2}-\d{2}\.csv$/),
    });
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith('done');
    vi.advanceTimersByTime(199);
    expect(removeChild).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(removeChild).toHaveBeenCalledWith(link);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:patient-export');
    vi.advanceTimersByTime(2800);
    expect(status.mock.calls.map(([value]) => value)).toEqual(['done', 'idle']);
  });
});
