import type { RecordLine, UnlockLine, Verification } from './runSummaryModel';

// The lines every game's post-session summary shows (NFCT-22): the score's
// status tag and caption, the record line and the unlock line. The score is
// marked Pending until trusted scoring has decided; the copy never describes
// how (NFCT-66). Each game supplies its own record metric words and its own
// reasons for a flag.

const numberFormat = new Intl.NumberFormat();

/** The status tag on the score: provisional until trusted scoring has decided. */
export function verificationTag(verification: Verification): { readonly text: string; readonly tone: string } {
  switch (verification.kind) {
    case 'provisional':
      return { text: 'Pending', tone: 'status-tag-neutral' };
    case 'verified':
      return { text: 'Final', tone: 'status-tag-active' };
    case 'flagged':
      // The same words as the run's history row: trusted scoring upgrades it once its start level unlocks.
      return verification.upgradable
        ? { text: 'Waiting on level unlock', tone: 'status-tag-neutral' }
        : { text: 'Flagged', tone: 'status-tag-paused' };
    case 'invalid':
      return { text: 'Not counted', tone: 'status-tag-alert' };
    case 'not-saved':
      return { text: 'Not saved', tone: 'status-tag-alert' };
  }
}

export function verificationCaption(verification: Verification, flagExplanation: (reasons: readonly string[]) => string): string {
  switch (verification.kind) {
    case 'provisional':
      // Pending says enough while the result is on its way (the save line covers an upload);
      // only a result that is taking a while gets a line, and it says nothing about why.
      return verification.detail === 'delayed' ? 'Your final score isn’t ready yet. Check back later.' : '';
    case 'verified':
      return '';
    case 'flagged':
      // ADR-001 decision 12: once the start level is unlocked, trusted scoring upgrades the run to valid.
      return verification.upgradable
        ? `${flagExplanation(verification.reasons)} It counts toward your totals now, and toward your records and unlocks once that level is unlocked.`
        : `${flagExplanation(verification.reasons)} It counts toward your totals, but not your records or unlocks.`;
    case 'invalid':
      return 'This run didn’t meet the scoring rules, so it doesn’t count toward your progress.';
    case 'not-saved':
      return 'This run wasn’t saved, so its score doesn’t count.';
  }
  return '';
}

export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function bestSentence(startLevel: number, bestScore: number | null): string {
  return bestScore === null ? `No record yet from level ${startLevel}.` : `Your best from level ${startLevel} is ${numberFormat.format(bestScore)}.`;
}

export interface Line {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'achieved' | 'neutral' | 'muted';
  /**
   * A verdict from the provisional preview, not yet decided by trusted scoring:
   * an achievement, or a flagged or invalid prediction. Its text is the same
   * as once confirmed, so the layout never shifts; only its styling (and a
   * screen-reader note) differs.
   */
  readonly pending?: boolean;
}

export function recordLine<Metric extends string>(
  record: RecordLine<Metric>,
  provisional: boolean,
  unavailable: boolean,
  metricWords: Readonly<Record<Metric, string>>,
): Line {
  switch (record.kind) {
    case 'loading':
      return unavailable
        ? { title: 'Records unavailable', detail: 'Your records couldn’t be loaded right now.', tone: 'muted' }
        : { title: 'Records', detail: 'Loading your records…', tone: 'muted' };
    case 'pending':
      return { title: 'Records', detail: 'Loading your records…', tone: 'muted' };
    case 'new-best': {
      // Kept to two lines at phone width, so the card never outgrows its reserved height (NFCT-52).
      const what = record.metrics.length > 0 ? `From level ${record.startLevel}: ${listWords(record.metrics.map((metric) => metricWords[metric]))}.` : `From level ${record.startLevel}.`;
      return { title: 'New personal best', detail: what, tone: 'achieved', pending: provisional };
    }
    case 'best-so-far':
      return {
        title: record.bestScore === null ? `No record yet from level ${record.startLevel}` : `Your best from level ${record.startLevel}: ${numberFormat.format(record.bestScore)}`,
        detail: 'Each start level has its own records.',
        tone: 'neutral',
      };
    case 'ineligible':
      switch (record.reason) {
        case 'abandoned':
          return { title: 'Unfinished runs don’t set records', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted' };
        case 'flagged':
          // Flagged only for its locked start level: the upgrade (ADR-001 decision 12) can still make it count.
          return record.upgradable
            ? { title: 'Not a record yet', detail: `This run can still set a record once level ${record.startLevel} is unlocked.`, tone: 'muted', pending: provisional }
            : { title: 'Flagged runs don’t set records', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted', pending: provisional };
        case 'invalid':
          return { title: 'Not counted', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted', pending: provisional };
        case 'not-saved':
          return { title: 'Not saved', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted' };
      }
  }
  return { title: '', detail: '', tone: 'muted' };
}

function levelsText(levels: readonly number[]): string {
  if (levels.length === 1) return `Level ${levels[0]}`;
  const sorted = [...levels].sort((a, b) => a - b);
  const contiguous = sorted.every((level, index) => index === 0 || level === sorted[index - 1]! + 1);
  return contiguous && sorted.length > 2 ? `Levels ${sorted[0]}–${sorted.at(-1)}` : `Levels ${listWords(sorted.map(String))}`;
}

export function unlockLine(unlock: UnlockLine, provisional: boolean, unavailable: boolean): Line {
  switch (unlock.kind) {
    case 'loading':
      return unavailable
        ? { title: 'Start levels', detail: 'Your start levels couldn’t be loaded right now.', tone: 'muted' }
        : { title: 'Start levels', detail: 'Loading your start levels…', tone: 'muted' };
    case 'unlocked': {
      const highest = Math.max(...unlock.levels);
      return { title: `${levelsText(unlock.levels)} unlocked`, detail: `You can now start a run at level ${highest}.`, tone: 'achieved', pending: provisional };
    }
    case 'next':
      return {
        title: `Next unlock: start level ${unlock.nextLevel}`,
        detail: `Reach level ${unlock.reachLevel} in a finished run to unlock it.`,
        tone: 'neutral',
      };
    case 'all':
      return { title: 'Every start level is unlocked', detail: `You can start at any level from 1 to ${unlock.maxLevel}.`, tone: 'neutral' };
  }
}
