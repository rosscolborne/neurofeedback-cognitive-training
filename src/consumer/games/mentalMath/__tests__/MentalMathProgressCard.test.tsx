import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ProgressWithRecentSessions } from '../../../repositories/progressRepository';
import { MENTAL_MATH_PROGRESS_CARD_BUTTON_ID, MentalMathProgressCard } from '../MentalMathProgressCard';
import { pickerState, playRun, progressWith, sessionRecord } from './fixtures';

// The card is always given a repository here; the app's default is never used.
vi.mock('../../../repositories', () => ({ progressRepository: null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

function renderCard(state: ProgressWithRecentSessions) {
  const progress = { subscribeToProgressWithRecentSessions: vi.fn((_gameId: string, _options: object, onNext: (value: ProgressWithRecentSessions) => void) => { onNext(state); return () => {}; }) };
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<MentalMathProgressCard onOpen={vi.fn()} progress={progress} />); });
  const summary = renderer.root.find((node) => node.props['data-progress-card'] === 'summary');
  return { renderer, summary, tags: summary.findAll((node) => node.props['data-provisional'] === 'true' && typeof node.type === 'string') };
}

describe('MentalMathProgressCard (NFCT-52)', () => {
  it('shows the server’s numbers plainly', () => {
    const { summary, tags, renderer } = renderCard(pickerState(progressWith(3)));
    expect(textOf(summary)).toBe('1 run completed · 2 of 10 start levels unlocked');
    expect(tags).toHaveLength(0);
    // The Records button has the id focus returns to when the game's progress closes.
    expect(renderer.root.findByProps({ id: MENTAL_MATH_PROGRESS_CARD_BUTTON_ID }).props['aria-label']).toBe('Mental Math records and history');
  });

  it('marks the numbers provisional while they count a run the server hasn’t checked', () => {
    const pending = sessionRecord('sessionAAAAAAAAAAAA1', playRun({ seed: 4242, startLevel: 1, correct: 7 }), { seed: 4242 });
    const { summary, tags } = renderCard(pickerState(null, [pending]));
    expect(textOf(summary)).toBe('1 run completed · 2 of 10 start levels unlocked Provisional');
    expect(tags).toHaveLength(1);
  });
});
