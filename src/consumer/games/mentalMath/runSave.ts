import type { EegSource } from '@nfct/shared';
import type { EegRecordingRefusalReason, EegRecordingSkipReason } from '../../repositories/eegRecordingRepository';

// How a finished run's save is reported (NFCT-21): the session, and separately
// its optional EEG recording, because "run saved, EEG not saved" is a normal
// outcome. EEG never affects the run, its score or progress.

/** The run's EEG recording, reported separately from the session. */
export type EegState =
  | { readonly status: 'none' }
  | { readonly status: 'checking' }
  | { readonly status: 'queued' }
  | { readonly status: 'saved' }
  | { readonly status: 'not-saved'; readonly reason: EegRecordingSkipReason | EegRecordingRefusalReason | 'error' };

export type SaveState =
  | { readonly status: 'saving' }
  | { readonly status: 'queued'; readonly eeg: EegState }
  | { readonly status: 'confirmed'; readonly eeg: EegState }
  | { readonly status: 'failed'; readonly message: string };

/** What the player is told about the EEG provider that ran: its label and its provenance. */
export type EegInfo = { readonly label: string; readonly source: EegSource };

export function saveMessage(save: SaveState): string {
  switch (save.status) {
    case 'saving':
      return 'Saving your run…';
    case 'queued':
      return 'Saved on this device. Uploading to your account…';
    case 'confirmed':
      return 'Run saved to your account.';
    case 'failed':
      return `This run couldn’t be saved. ${save.message}`;
  }
}

export function eegMessage(eeg: EegState, { label, source }: EegInfo): string {
  const simulated = source === 'simulated' ? ' It is simulated data, not a measurement.' : '';
  switch (eeg.status) {
    case 'none':
      return `No ${label} was captured during this run.`;
    case 'checking':
      return `Checking your EEG consent before saving ${label}…`;
    case 'queued':
      return `${label} recording saved on this device. Uploading…${simulated}`;
    case 'saved':
      return `${label} recording saved with this run.${simulated}`;
    case 'not-saved':
      switch (eeg.reason) {
        case 'consent-required':
          return `${label} was not saved: saving EEG needs your EEG consent.`;
        case 'consent-unavailable':
          return `${label} wasn’t saved because your EEG consent couldn’t be confirmed with the server (you may be offline, on a slow connection, or have profile changes still uploading).`;
        case 'consent-withdrawn':
          return `${label} was not saved: your EEG consent was withdrawn.`;
        case 'invalid':
          return `${label} was not saved: the recording was incomplete.`;
        case 'session-not-saved':
          return `${label} was not saved because the run was not saved.`;
        case 'already-recorded':
          return `${label} was already saved for this run.`;
        case 'owner-changed':
          return `${label} was not saved because you signed out.`;
        case 'unknown':
        case 'error':
          return `${label} couldn’t be saved.`;
      }
  }
}
