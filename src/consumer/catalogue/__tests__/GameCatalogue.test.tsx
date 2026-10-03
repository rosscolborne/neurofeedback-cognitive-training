import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_CATALOGUE } from '@nfct/shared';

vi.mock('../../games/mentalMath/MentalMathGame', () => ({ MentalMathGame: 'mental-math-game' }));

import { Calculator } from 'lucide-react';
import { CatalogueCard } from '../CatalogueCard';
import { GameCatalogue } from '../GameCatalogue';
import { GameScreen } from '../../games/GameScreen';
import { GAME_SCREENS } from '../../games/gameScreens';

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

const visibleTextOf = (node: ReactTestInstance) => node
  .findAll((child) => child.props.className === 'visually-hidden')
  .reduce((text, hidden) => text.replace(textOf(hidden), ''), textOf(node));

describe('GameCatalogue', () => {
  let renderer: ReactTestRenderer;
  const onOpenGame = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onOpenGame.mockClear();
    act(() => { renderer = create(<GameCatalogue onOpenGame={onOpenGame} />); });
  });

  afterEach(() => { act(() => renderer.unmount()); });

  it('is a labelled Games section listing one card per catalogue game, in catalogue order', () => {
    const section = renderer.root.findByType('section');
    expect(section.props['aria-labelledby']).toBe('train-games-title');
    expect(textOf(renderer.root.findByProps({ id: 'train-games-title' }))).toBe('Games');
    const items = section.findByType('ul').findAllByType('li');
    expect(items.map((item) => textOf(item.findByType('button')))).toEqual(GAME_CATALOGUE.map((listing) => listing.name));
  });

  it('shows Mental Math with its summary, what it trains as percentages heaviest first, run length and levels', () => {
    const [card] = renderer.root.findAllByType('li');
    expect(textOf(card!.findByType('button'))).toBe('Mental Math');
    expect(textOf(card!.findByProps({ className: 'train-card-desc' }))).toBe('Quick arithmetic that adapts to you as you play.');
    const mix = card!.findByProps({ className: 'train-card-mix' });
    expect(visibleTextOf(mix.findByProps({ className: 'train-card-mix-title' }))).toBe('Trains');
    const items = mix.findAllByProps({ className: 'train-card-mix-item' });
    expect(items.map(visibleTextOf)).toEqual(['Math 70%', 'Processing speed 20%', 'Memory 10%']);
    // Screen readers hear a label and a pause between items; the bar is decoration.
    expect(textOf(mix)).toBe('Trains: Math 70%,Processing speed 20%,Memory 10%');
    const bar = mix.findByProps({ className: 'train-card-mix-bar' });
    expect(bar.props['aria-hidden']).toBe('true');
    expect((bar.children as ReactTestInstance[]).map((segment) => segment.props.style)).toEqual([{ flexGrow: 70 }, { flexGrow: 20 }, { flexGrow: 10 }]);
    // The mix replaces the domain chips.
    expect(card!.findAll((node) => String(node.props.className).includes('train-card-tag'))).toHaveLength(0);
    expect(visibleTextOf(card!.findByProps({ className: 'train-card-facts' }))).toBe('Up to 3 minutes10 levels');
  });

  it('describes the button with the card text, by ids that exist', () => {
    const button = renderer.root.findByType('li').findByType('button');
    const ids = String(button.props['aria-describedby']).split(' ');
    expect(ids).toEqual(['game-mental-math-desc', 'game-mental-math-emphasis', 'game-mental-math-facts']);
    for (const id of ids) expect(renderer.root.findAll((node) => typeof node.type === 'string' && node.props.id === id)).toHaveLength(1);
    expect(button.props.type).toBe('button');
  });

  it('opens the game by its ID from the card button', () => {
    act(() => renderer.root.findByType('li').findByType('button').props.onClick());
    expect(onOpenGame).toHaveBeenCalledExactlyOnceWith('mental-math');
  });
});

describe('CatalogueCard emphasis', () => {
  it('names a share that rounds to 0% as under 1% and leaves it out of the bar', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <CatalogueCard
          id="game-fixture" name="Fixture" description="A fixture." icon={Calculator}
          emphasis={[{ label: 'Math', percent: 100 }, { label: 'Memory', percent: 0 }]}
          facts={[]} action="Play" onSelect={() => {}}
        />,
      );
    });
    const items = renderer.root.findAllByProps({ className: 'train-card-mix-item' });
    expect(items.map(visibleTextOf)).toEqual(['Math 100%', 'Memory <1%']);
    expect(renderer.root.findByProps({ className: 'train-card-mix-bar' }).children).toHaveLength(1);
    expect(renderer.root.findAll((node) => String(node.props.className).includes('train-card-tags'))).toHaveLength(0);
    act(() => renderer.unmount());
  });
});

describe('game screens', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('has a playable screen for every catalogue game', () => {
    for (const listing of GAME_CATALOGUE) expect(Object.hasOwn(GAME_SCREENS, listing.definition.id)).toBe(true);
  });

  it('renders the screen of the game it is given and refuses an unknown game', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onExit = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<GameScreen gameId="mental-math" eegProvider={null} onExit={onExit} />); });
    const screen = renderer.root.find((node) => (node.type as unknown) === 'mental-math-game');
    expect(screen.props).toEqual({ eegProvider: null, onExit });
    act(() => renderer.unmount());
    // NFCT-22's Progress-tab card opens the game on its progress view.
    act(() => { renderer = create(<GameScreen gameId="mental-math" initialView="progress" onExit={onExit} />); });
    expect(renderer.root.find((node) => (node.type as unknown) === 'mental-math-game').props).toEqual({ initialView: 'progress', onExit });
    act(() => renderer.unmount());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => { create(<GameScreen gameId="constructor" onExit={onExit} />); })).toThrow(/No screen for game 'constructor'/);
  });
});
