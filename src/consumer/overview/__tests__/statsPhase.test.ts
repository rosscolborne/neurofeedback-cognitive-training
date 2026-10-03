import { describe, expect, it } from 'vitest';
import type { GameSessionHistoryEntry, GameSessionHistoryPage } from '../../repositories/gameSessionRepository';
import { PENDING_RESULT_GRACE_MS, pendingDeadline, runRows, statsPhase, type Loaded, type PlayerOverview } from '../usePlayerOverview';
import { missing, NOW_MS, runEntry } from './overviewFixtures';

// NFCT-83: how long the stats show as loading for a run waiting for its result.

const page = (...entries: GameSessionHistoryEntry[]): Loaded<GameSessionHistoryPage> =>
  ({ status: 'ready', value: { entries, unreadable: [], nextCursor: null, fromCache: false } });
const noSummary: Pick<PlayerOverview, 'summary' | 'todayState'> = { summary: { status: 'ready', value: missing() }, todayState: 'known' };
/** Uploaded and waiting, with no write pending on this device. */
const uploaded = (entry: GameSessionHistoryEntry): GameSessionHistoryEntry => ({ ...entry, hasPendingWrites: false });

describe('statsPhase', () => {
  const fresh = uploaded(runEntry('sessionAAAAAAAAAAAA2', { verified: false, wallStartMs: NOW_MS - 600_000 }));
  const endedAt = fresh.session.endedAt.toMillis();

  it('is checking within the grace after the run ended, then delayed', () => {
    const runs = page(fresh);
    expect(statsPhase(noSummary, runs, true, endedAt + PENDING_RESULT_GRACE_MS - 1, endedAt)).toBe('checking');
    expect(statsPhase(noSummary, runs, true, endedAt + PENDING_RESULT_GRACE_MS, endedAt)).toBe('delayed');
  });

  it('is delayed at once when scoring has recorded a delay', () => {
    const delayed = { ...fresh, session: { ...fresh.session, processing: { attempts: 1 } as never } };
    expect(statsPhase(noSummary, page(delayed), true, endedAt + 1, endedAt + 1)).toBe('delayed');
  });

  it('waits from the oldest waiting run, and never longer than the grace after the screen opened', () => {
    const older = uploaded(runEntry('sessionAAAAAAAAAAAA1', { verified: false, wallStartMs: NOW_MS - 3_600_000 }));
    expect(pendingDeadline(runRows(page(fresh, older))!, NOW_MS)).toBe(older.session.endedAt.toMillis() + PENDING_RESULT_GRACE_MS);
    // A run that ended "later" than this device's clock (another device, a clock behind): the screen's own wait bounds it.
    const openedAt = endedAt - 3_600_000;
    expect(pendingDeadline(runRows(page(fresh))!, openedAt)).toBe(openedAt + PENDING_RESULT_GRACE_MS);
    expect(statsPhase(noSummary, page(fresh), true, openedAt + PENDING_RESULT_GRACE_MS, openedAt)).toBe('delayed');
  });

  it('ignores the grace once every run has its result', () => {
    const scored = runEntry('sessionAAAAAAAAAAAA1');
    expect(pendingDeadline(runRows(page(scored))!, NOW_MS)).toBeNull();
    expect(statsPhase(noSummary, page(scored), true, NOW_MS, NOW_MS)).toBe('catching-up');
  });
});
