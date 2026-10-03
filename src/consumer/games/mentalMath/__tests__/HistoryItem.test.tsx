import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { HistoryItem } from '../MentalMathProgress';
import type { HistoryRow, HistoryState } from '../progressSummary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

const BASE: HistoryRow = {
  id: 'sessionAAAAAAAAAAAA1',
  endedAtMs: Date.UTC(2026, 9, 1, 12),
  startLevel: 1,
  completed: true,
  activeMs: 90_000,
  state: 'verified',
  score: 1234,
  personalBest: false,
  awaitingUnlock: false,
};

function render(row: Partial<HistoryRow>) {
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<HistoryItem row={{ ...BASE, ...row }} />); });
  const find = (className: string) => renderer.root.find((node) => typeof node.props.className === 'string' && node.props.className.split(' ').includes(className) && typeof node.type === 'string');
  const tags = renderer.root.findAll((node) => typeof node.props.className === 'string' && node.props.className.startsWith('status-tag'));
  return {
    text: textOf(renderer.root),
    meta: textOf(find('mm-history-meta')),
    score: textOf(find('mm-history-score')),
    tag: tags.length === 1 ? textOf(tags[0]!) : null,
    muted: renderer.root.findAll((node) => node.props.className === 'mm-history-score mm-history-score-muted').length === 1,
  };
}

// The history row as the player sees it (NFCT-66, NFCT-64): a run without its
// trusted result says "Pending" in the score's place; a resolved run shows its
// score; a run ended early carries one neutral "Ended early" tag and is never
// shown as a missing score. No copy about how runs are scored.
describe('HistoryItem', () => {
  it.each<HistoryState>(['checking', 'delayed'])('shows a finished run without a result (%s) as pending, never a dash', (state) => {
    const row = render({ state, score: null });
    expect(row.score).toBe('Pending');
    expect(row.tag).toBeNull();
    expect(row.text).not.toMatch(/—|server|check|confirm|verif|provisional|processing/i);
  });

  it('shows a resolved run’s score, with no status tag unless it set a best', () => {
    expect(render({})).toMatchObject({ tag: null, score: '1,234', meta: 'Start level 1 · 1\u00A0min 30\u00A0s' });
    expect(render({ personalBest: true })).toMatchObject({ tag: 'New best', score: '1,234' });
    expect(render({ state: 'invalid', score: null })).toMatchObject({ tag: 'Not counted', score: '—No score' });
  });

  it('labels a run ended early once, with its play time and its score, quieter than a finished run’s', () => {
    const resolved = render({ completed: false, activeMs: 42_000, score: 210 });
    expect(resolved).toMatchObject({ meta: 'Start level 1 · 42\u00A0s', tag: 'Ended early', score: '210', muted: true });
    expect(resolved.text.match(/Ended early/g)).toHaveLength(1);
    expect(resolved.text).not.toMatch(/No score|—/);
    expect(render({}).muted).toBe(false);
  });

  it('keeps a pending run ended early distinct from a pending finished run', () => {
    expect(render({ completed: false, state: 'checking', score: null })).toMatchObject({ tag: 'Ended early', score: 'Pending' });
    expect(render({ completed: false, state: 'on-device', score: null })).toMatchObject({ tag: 'Ended early', score: 'Pending' });
    expect(render({ state: 'checking', score: null }).tag).toBeNull();
  });

  it('says a run flagged only for its locked start level is waiting on that level, not flagged', () => {
    expect(render({ state: 'flagged', startLevel: 2, awaitingUnlock: true })).toMatchObject({ tag: 'Waiting on level unlock', score: '1,234' });
    expect(render({ state: 'flagged', startLevel: 2, awaitingUnlock: true }).text).not.toMatch(/Flagged/);
    expect(render({ state: 'flagged' })).toMatchObject({ tag: 'Flagged', score: '1,234' });
  });

  it('says a finished run not uploaded yet is still on this device', () => {
    expect(render({ state: 'on-device', score: null })).toMatchObject({ tag: 'Not uploaded yet', score: 'Pending' });
  });
});
