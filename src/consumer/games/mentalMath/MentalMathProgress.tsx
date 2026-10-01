import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { mentalMath } from '@nfct/shared';
import { FactGrid } from '../../../components/ui/FactGrid';
import type { GameSessionCursor, GameSessionHistoryEntry, GameSessionHistoryPage, GameSessionRepository } from '../../repositories/gameSessionRepository';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { formatPlayTime, gameOverview, historyRow, isTimed90, type HistoryRow, type HistoryState } from './progressSummary';
import { currentProgress } from './startLevel';

// Mental Math's per-game progress (NFCT-22): totals, unlocked start levels,
// bests per start level and the cursor-paged history of runs. Stage 1 shows
// only these; streaks, daily stats and achievements are Stage 2 (NFCT-13).
// Nothing EEG-derived appears here.

/** Runs per history page. */
export const HISTORY_PAGE_SIZE = 10;

const numberFormat = new Intl.NumberFormat();

export interface MentalMathProgressProps {
  readonly progress: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
  readonly gameSessions: Pick<GameSessionRepository, 'subscribeToGameSessionHistory' | 'listGameSessionHistory'>;
  readonly onBack: () => void;
  readonly onPlay: () => void;
}

type Loaded<T> = { readonly status: 'loading' } | { readonly status: 'ready'; readonly value: T } | { readonly status: 'unavailable' };

/** Pages after the live first page, loaded on request. */
interface OlderPages {
  /** The first page's cursor these pages continue from; they are dropped if the first page moves on. */
  readonly after: string;
  readonly entries: readonly GameSessionHistoryEntry[];
  readonly unreadable: number;
  readonly nextCursor: GameSessionCursor | null;
}

function historyTag(row: HistoryRow): { readonly text: string; readonly tone: string } | null {
  const tags: Record<HistoryState, { text: string; tone: string } | null> = {
    verified: row.personalBest ? { text: 'Personal best', tone: 'status-tag-completed' } : null,
    flagged: { text: 'Flagged', tone: 'status-tag-paused' },
    invalid: { text: 'Not counted', tone: 'status-tag-alert' },
    'on-device': { text: 'Not uploaded yet', tone: 'status-tag-neutral' },
    checking: { text: 'Checking', tone: 'status-tag-neutral' },
    delayed: { text: 'Not checked yet', tone: 'status-tag-neutral' },
  };
  return tags[row.state];
}

function formatWhen(ms: number): string {
  const date = new Date(ms);
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${day} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

const HistoryItem: React.FC<{ readonly row: HistoryRow }> = ({ row }) => {
  const tag = historyTag(row);
  return (
    <li className="mm-history-row" data-history-row={row.id}>
      <span className="mm-history-main">
        <span className="mm-history-when">{formatWhen(row.endedAtMs)}</span>
        <span className="mm-history-meta">
          Start level {row.startLevel} · {row.completed ? formatPlayTime(row.activeMs) : 'Ended early'}
        </span>
      </span>
      <span className="mm-history-side">
        <span className="mm-history-score">
          {row.score === null ? <><span aria-hidden="true">—</span><span className="mm-visually-hidden">No score</span></> : numberFormat.format(row.score)}
        </span>
        {tag && <span className={`status-tag ${tag.tone}`}>{tag.text}</span>}
      </span>
    </li>
  );
};

export const MentalMathProgress: React.FC<MentalMathProgressProps> = ({ progress, gameSessions, onBack, onPlay }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [progressState, setProgressState] = useState<Loaded<ProgressWithRecentSessions>>({ status: 'loading' });
  const [firstPage, setFirstPage] = useState<Loaded<GameSessionHistoryPage>>({ status: 'loading' });
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [loadingMore, setLoadingMore] = useState<'idle' | 'loading' | 'failed'>('idle');
  const request = useRef(0);

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    const fail = () => setProgressState({ status: 'unavailable' });
    let stop: () => void = () => {};
    try {
      stop = progress.subscribeToProgressWithRecentSessions(mentalMath.GAME_ID, {}, (value) => setProgressState({ status: 'ready', value }), fail);
    } catch {
      fail();
    }
    return () => stop();
  }, [progress]);

  useEffect(() => {
    const fail = () => setFirstPage({ status: 'unavailable' });
    let stop: () => void = () => {};
    try {
      stop = gameSessions.subscribeToGameSessionHistory({ gameId: mentalMath.GAME_ID, pageSize: HISTORY_PAGE_SIZE },
        (value) => setFirstPage({ status: 'ready', value }), fail);
    } catch {
      fail();
    }
    return () => stop();
  }, [gameSessions]);

  const first = firstPage.status === 'ready' ? firstPage.value : null;
  const firstBoundary = first?.nextCursor?.id ?? null;
  // Older pages continue from the first page's last run. If a new run moves that boundary, they are dropped.
  const olderPages = older !== null && older.after === firstBoundary ? older : null;

  const loadMore = useCallback(async () => {
    const cursor = olderPages ? olderPages.nextCursor : first?.nextCursor ?? null;
    if (!cursor || firstBoundary === null || loadingMore === 'loading') return;
    const ticket = request.current + 1;
    request.current = ticket;
    setLoadingMore('loading');
    try {
      const page = await gameSessions.listGameSessionHistory({ gameId: mentalMath.GAME_ID, pageSize: HISTORY_PAGE_SIZE, cursor });
      if (request.current !== ticket) return;
      setOlder({
        after: firstBoundary,
        entries: [...(olderPages?.entries ?? []), ...page.entries],
        unreadable: (olderPages?.unreadable ?? 0) + page.unreadable.length,
        nextCursor: page.nextCursor,
      });
      setLoadingMore('idle');
    } catch {
      if (request.current === ticket) setLoadingMore('failed');
    }
  }, [first, firstBoundary, gameSessions, loadingMore, olderPages]);

  const progressNow = useMemo(() => (progressState.status === 'ready' ? currentProgress(progressState.value) : null), [progressState]);
  const overview = useMemo(() => gameOverview(progressNow?.progress ?? null), [progressNow]);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...(first?.entries ?? []), ...(olderPages?.entries ?? [])]
      .filter((entry) => isTimed90(entry) && !seen.has(entry.id) && seen.add(entry.id))
      .map(historyRow);
  }, [first, olderPages]);
  const unreadable = (first?.unreadable.length ?? 0) + (olderPages?.unreadable ?? 0);
  const nextCursor = olderPages ? olderPages.nextCursor : first?.nextCursor ?? null;
  const ready = progressState.status === 'ready';
  const lockedFrom = overview.unlocked + 1;

  return (
    <div className="mm-screen mm-progress">
      <div className="mm-topbar">
        <button type="button" className="btn btn-ghost mm-back" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" /> Back
        </button>
      </div>

      <section className="mm-panel" aria-labelledby="mm-progress-title">
        <div>
          <h1 id="mm-progress-title" ref={headingRef} tabIndex={-1} className="mm-title font-display">Your Mental Math</h1>
          <p className="mm-muted">Records are kept separately for each start level, so runs only compete with runs that started at the same level.</p>
        </div>
        {progressState.status === 'unavailable' ? (
          <p className="mm-help" role="alert">Your progress couldn’t be loaded right now. Check your connection and try again.</p>
        ) : (
          <>
            <FactGrid
              minColumnWidth={128}
              facts={[
                { label: 'Runs completed', value: <span data-total="runs-completed">{ready ? numberFormat.format(overview.sessionsCompleted) : '—'}</span> },
                { label: 'Time played', value: <span data-total="time-played">{ready ? formatPlayTime(overview.activeMs) : '—'}</span> },
                { label: 'Highest level reached', value: ready && overview.bestPeakLevel !== null ? overview.bestPeakLevel : '—' },
                { label: 'Start levels unlocked', value: <span data-total="unlocked">{ready ? `${overview.unlocked} of ${overview.maxLevel}` : '—'}</span> },
              ]}
            />
            <p className="mm-help" data-progress="next-unlock">
              {!ready ? 'Loading your progress…'
                : overview.unlock.kind === 'next' ? `Reach level ${overview.unlock.reachLevel} in a finished run to unlock start level ${overview.unlock.nextLevel}.`
                  : 'Every start level is unlocked.'}
              {ready && progressNow?.previewed ? ' Includes runs the server hasn’t checked yet.' : ''}
            </p>
          </>
        )}
      </section>

      <section className="mm-panel" aria-labelledby="mm-bests-title">
        <h2 id="mm-bests-title" className="mm-section-title">Bests by start level</h2>
        {!ready ? <p className="mm-help">{progressState.status === 'unavailable' ? 'Your bests couldn’t be loaded.' : 'Loading your bests…'}</p> : (
          <>
            <ul className="mm-bests">
              {overview.levels.map(({ startLevel, bests }) => (
                <li key={startLevel} className="mm-best-row" data-best-level={startLevel}>
                  <span className="mm-best-level">Level {startLevel}</span>
                  {bests ? (
                    <span className="mm-best-values">
                      <span className="mm-best-score" data-best="score">{bests.score === null ? '—' : numberFormat.format(bests.score)}</span>
                      <span className="mm-best-detail">
                        {bests.correct === null ? '' : `${bests.correct} correct`}
                        {bests.correct !== null && bests.peakLevel !== null ? ' · ' : ''}
                        {bests.peakLevel === null ? '' : `reached level ${bests.peakLevel}`}
                      </span>
                    </span>
                  ) : <span className="mm-best-empty">No finished runs yet</span>}
                </li>
              ))}
            </ul>
            {lockedFrom <= overview.maxLevel && (
              <p className="mm-help">
                {lockedFrom === overview.maxLevel ? `Level ${lockedFrom} is` : `Levels ${lockedFrom}–${overview.maxLevel} are`} still locked.
              </p>
            )}
          </>
        )}
      </section>

      <section className="mm-panel" aria-labelledby="mm-history-title">
        <h2 id="mm-history-title" className="mm-section-title">Recent runs</h2>
        {firstPage.status === 'loading' && <p className="mm-help">Loading your runs…</p>}
        {firstPage.status === 'unavailable' && <p className="mm-help" role="alert">Your runs couldn’t be loaded right now.</p>}
        {first && rows.length === 0 && unreadable === 0 && (
          <p className="mm-help">No runs yet. Every run you play, finished or not, appears here.</p>
        )}
        {rows.length > 0 && (
          <ol className="mm-history" aria-label="Runs, newest first">
            {rows.map((row) => <HistoryItem key={row.id} row={row} />)}
          </ol>
        )}
        {unreadable > 0 && (
          <p className="mm-help">{unreadable === 1 ? '1 run couldn’t be shown.' : `${unreadable} runs couldn’t be shown.`}</p>
        )}
        {nextCursor && (
          <div className="mm-more">
            {/* aria-disabled, not disabled, so focus stays on the button while the page loads. */}
            <button type="button" className="btn btn-secondary" onClick={() => { void loadMore(); }} aria-disabled={loadingMore === 'loading' || undefined}>
              {loadingMore === 'loading' ? 'Loading…' : 'Show more runs'}
            </button>
            {loadingMore === 'failed' && <p className="mm-help" role="alert">More runs couldn’t be loaded. Try again.</p>}
          </div>
        )}
      </section>

      <button type="button" className="btn btn-primary mm-start" onClick={onPlay}>Play Mental Math</button>
    </div>
  );
};
