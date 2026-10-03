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
};

function render(row: Partial<HistoryRow>) {
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<HistoryItem row={{ ...BASE, ...row }} />); });
  const find = (className: string) => renderer.root.find((node) => node.props.className === className);
  const tags = renderer.root.findAll((node) => typeof node.props.className === 'string' && node.props.className.startsWith('status-tag'));
  return {
    text: textOf(renderer.root),
    meta: textOf(find('mm-history-meta')),
    score: textOf(find('mm-history-score')),
    tag: tags.length === 1 ? textOf(tags[0]!) : null,
  };
}

// The history row as the player sees it (NFCT-66): a run without its trusted
// result is "Pending", in neutral words; a resolved run shows its score; an
// ended-early run is told apart from a finished one in either state.
describe('HistoryItem', () => {
  it.each<HistoryState>(['checking', 'delayed'])('shows a run without a result (%s) as pending, with no score yet', (state) => {
    const row = render({ state, score: null });
    expect(row.tag).toBe('Pending');
    expect(row.score).toBe('—Score pending');
    expect(row.text).not.toMatch(/server|check|confirm|verif|provisional|processing/i);
  });

  it('shows a resolved run’s score, with no status tag unless it set a best', () => {
    expect(render({})).toMatchObject({ tag: null, score: '1,234' });
    expect(render({ personalBest: true })).toMatchObject({ tag: 'New best', score: '1,234' });
    expect(render({ state: 'invalid', score: null })).toMatchObject({ tag: 'Not counted', score: '—No score' });
  });

  it('keeps an ended-early run distinct from a finished one, pending or resolved', () => {
    expect(render({ completed: false, state: 'checking', score: null })).toMatchObject({ meta: 'Start level 1 · Ended early', tag: 'Pending' });
    expect(render({ completed: false, score: 210 })).toMatchObject({ meta: 'Start level 1 · Ended early', tag: null, score: '210' });
    expect(render({}).meta).toBe('Start level 1 · 1 min 30 s');
  });

  it('says a run not uploaded yet is still on this device', () => {
    expect(render({ state: 'on-device', score: null })).toMatchObject({ tag: 'Not uploaded yet', score: '—Score pending' });
  });
});
