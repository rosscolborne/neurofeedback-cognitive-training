import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NFCT-12, NFCT-13: Home, Train and Progress are the games. Each screen opens
// a game with the control that opened it, so focus can return there (NFCT-52).

vi.mock('../../overview/HomeOverview', () => ({ HomeOverview: 'home-overview', HOME_PLAY_BUTTON_ID: 'home-play', HOME_ALL_RUNS_BUTTON_ID: 'home-all-runs' }));
vi.mock('../../overview/ProgressOverview', () => ({ ProgressOverview: 'progress-overview', PROGRESS_PLAY_BUTTON_ID: 'progress-play' }));
vi.mock('../../games/mentalMath/MentalMathProgressCard', () => ({ MentalMathProgressCard: 'mm-progress-card', MENTAL_MATH_PROGRESS_CARD_BUTTON_ID: 'mm-card' }));
vi.mock('../../games/sequenceMemory/SequenceMemoryProgressCard', () => ({ SequenceMemoryProgressCard: 'sm-progress-card', SEQUENCE_MEMORY_PROGRESS_CARD_BUTTON_ID: 'sm-card' }));

import { HomeScreen } from '../HomeScreen';
import { ProgressScreen } from '../ProgressScreen';
import { TrainScreen } from '../TrainScreen';
import { gameCardButtonId } from '../../catalogue/cardIds';

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(' '));
const element = (renderer: ReactTestRenderer, type: string): ReactTestInstance => renderer.root.find((node) => (node.type as unknown) === type);

let renderer: ReactTestRenderer | null = null;
const onOpenGame = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe('Home', () => {
  const onOpenAchievements = vi.fn();
  const home = (displayName: string | null) =>
    act(() => { renderer = create(<HomeScreen playerId="player-1" displayName={displayName} onOpenGame={onOpenGame} onOpenAchievements={onOpenAchievements} />); });

  it('greets the player, then shows their games, with no neurofeedback training', () => {
    home('Sam Player');
    expect(textOf(renderer!.root.findByType('h1'))).toMatch(/^Good (morning|afternoon|evening) ,? ?Sam\.$/);
    expect(element(renderer!, 'home-overview').props.playerId).toBe('player-1');
    expect(textOf(renderer!.root)).not.toMatch(/Neurofeedback|NeuroGambit|Begin Session|Training Session/);
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });

  it('greets a player who gave no name without one', () => {
    home(null);
    expect(textOf(renderer!.root.findByType('h1'))).toMatch(/^Good (morning|afternoon|evening) \.$/);
  });

  it('opens Mental Math, its progress, or the achievements', () => {
    home('Sam');
    const overview = element(renderer!, 'home-overview');
    act(() => overview.props.onPlay());
    act(() => overview.props.onOpenGameProgress());
    expect(onOpenGame.mock.calls).toEqual([
      [{ gameId: 'mental-math', returnFocusTo: 'home-play' }],
      [{ gameId: 'mental-math', initialView: 'progress', returnFocusTo: 'home-all-runs' }],
    ]);
    expect(overview.props.onOpenAchievements).toBe(onOpenAchievements);
  });
});

describe('Train', () => {
  beforeEach(() => { act(() => { renderer = create(<TrainScreen onOpenGame={onOpenGame} />); }); });

  it('lists only the games', () => {
    expect(textOf(renderer!.root.findByType('h1'))).toBe('Train');
    const titles = renderer!.root.findAllByType('section').map((section) => textOf(renderer!.root.findByProps({ id: section.props['aria-labelledby'] })));
    expect(titles).toEqual(['Games']);
    const cards = renderer!.root.findAllByType('li');
    expect(cards.map((item) => textOf(item.findByType('button')))).toEqual(['Mental Math', 'Sequence Memory']);
    for (const card of cards) expect(card.props.className).toBe('train-card train-game-card');
    expect(textOf(renderer!.root)).not.toMatch(/NeuroGambit|Headset training/);
  });

  it('opens a game from its card', () => {
    const card = renderer!.root.findAll((node) => node.type === 'button' && textOf(node) === 'Mental Math')[0]!;
    act(() => card.props.onClick());
    expect(onOpenGame).toHaveBeenCalledExactlyOnceWith({ gameId: 'mental-math', returnFocusTo: gameCardButtonId('mental-math') });
  });
});

describe('Progress', () => {
  const onSectionFocused = vi.fn();
  beforeEach(() => {
    act(() => { renderer = create(<ProgressScreen playerId="player-1" onOpenGame={onOpenGame} focusSection="achievements" onSectionFocused={onSectionFocused} />); });
  });

  it('shows the title, then the games, with no neurofeedback history', () => {
    expect(textOf(renderer!.root.findByType('h1'))).toBe('Your Progress');
    const overview = element(renderer!, 'progress-overview');
    expect(overview.props).toMatchObject({ playerId: 'player-1', focusSection: 'achievements', onSectionFocused });
    expect(textOf(renderer!.root)).not.toMatch(/Neurofeedback|Session History|target zone|Milestones|Export Data/);
  });

  it('opens Mental Math, its records from its game card, or Sequence Memory\'s start screen from its card', () => {
    const overview = element(renderer!, 'progress-overview');
    act(() => overview.props.onPlay());
    const [mentalMathCard, sequenceMemoryCard] = overview.props.games.props.children;
    expect([mentalMathCard.type, sequenceMemoryCard.type]).toEqual(['mm-progress-card', 'sm-progress-card']);
    act(() => mentalMathCard.props.onOpen());
    act(() => sequenceMemoryCard.props.onOpen());
    expect(onOpenGame.mock.calls).toEqual([
      [{ gameId: 'mental-math', returnFocusTo: 'progress-play' }],
      [{ gameId: 'mental-math', initialView: 'progress', returnFocusTo: 'mm-card' }],
      [{ gameId: 'sequence-memory', returnFocusTo: 'sm-card' }],
    ]);
  });
});
