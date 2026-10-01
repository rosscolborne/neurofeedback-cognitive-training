import { Timestamp } from 'firebase/firestore';
import type { EegSource } from '@nfct/shared';
import type { EegRecordingDraft } from '../repositories/eegRecordingRepository';

// Optional EEG capture during a game. A game never waits on EEG and never
// reads it: the runner starts a capture when the run starts, and hands the
// finished summary to the session save untouched. What the capture produced
// is decided by the provider alone, including `source`: the provider stamps
// whether its data is measured or simulated, never the game.
//
// Stage 1 scope (NFCT-21): the structure plus the minimum summary a
// simulated provider needs. The full reduction of a measured stream (band
// power, the 10-second timeline, real signal quality and calibration) is
// NFCT-25's.

/** One analysis window as a provider observed it. Scores are fractions (0-1) or null when unavailable. */
export interface EegWindowSample {
  readonly mindfulness: number | null;
  readonly restfulness: number | null;
  /** False when the window was unusable (poor contact, artifacts). */
  readonly usable: boolean;
}

export interface EegCapture {
  /** Stops capturing and returns the summary to save with the session, or null when nothing was captured. */
  finish(): EegRecordingDraft | null;
  /** Stops capturing and discards everything (for example when the screen closes before the run ends). */
  cancel(): void;
}

export interface EegCaptureProvider {
  /** Provenance, fixed by the provider. A simulated provider always says 'simulated'. */
  readonly source: EegSource;
  /** What the player is told is running, for example "Simulated EEG (Demo Mode)". */
  readonly label: string;
  start(): EegCapture;
}

export interface EegSummaryInput {
  readonly source: EegSource;
  readonly device: EegRecordingDraft['device'];
  readonly processing: EegRecordingDraft['processing'];
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly windows: readonly EegWindowSample[];
}

type Distribution = NonNullable<EegRecordingDraft['summary']['mindfulness']>;

function nearestRank(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}

/** mean, median, p10 and p90 (nearest rank) of the values, or null with none. */
export function distributionOf(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle] as number
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return {
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median,
    p10: nearestRank(sorted, 0.1),
    p90: nearestRank(sorted, 0.9),
    n: sorted.length,
  };
}

function fraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The minimal recording summary: the usable-window fraction and the
 * mindfulness and restfulness distributions of the usable windows. Band power,
 * the timeline and per-channel contact are left empty, and calibration is
 * 'none'. Returns null when no window was captured.
 */
export function summarizeEegWindows(input: EegSummaryInput): EegRecordingDraft | null {
  const { windows } = input;
  if (windows.length === 0) return null;
  const usable = windows.filter((window) => window.usable);
  const scores = (pick: (window: EegWindowSample) => number | null) => usable
    .map(pick)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .map(fraction);
  const usableFraction = usable.length / windows.length;
  const endedAtMs = Math.max(input.endedAtMs, input.startedAtMs + 1);
  return {
    source: input.source,
    startedAt: Timestamp.fromMillis(input.startedAtMs),
    endedAt: Timestamp.fromMillis(endedAtMs),
    device: input.device,
    processing: input.processing,
    calibration: { status: 'none', windowsCollected: 0, windowsRequired: 0 },
    quality: {
      windowsTotal: windows.length,
      windowsUsable: usable.length,
      usableFraction,
      // Per-channel contact is not summarized in Stage 1 (NFCT-25).
      channelGoodFraction: {},
      artifactFraction: 1 - usableFraction,
    },
    summary: {
      mindfulness: distributionOf(scores((window) => window.mindfulness)),
      restfulness: distributionOf(scores((window) => window.restfulness)),
      relativeBandPower: null,
    },
    timeline: null,
  };
}
