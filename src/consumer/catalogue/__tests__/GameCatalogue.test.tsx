import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_CATALOGUE } from '@nfct/shared';

vi.mock('../../games/mentalMath/MentalMathGame', () => ({ MentalMathGame: 'mental-math-game' }));

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

  it('shows Mental Math with its summary, its domains heaviest first, run length and levels', () => {
    const [card] = renderer.root.findAllByType('li');
    expect(textOf(card!.findByType('button'))).toBe('Mental Math');
    expect(textOf(card!.findByProps({ className: 'train-card-desc' }))).toBe('Quick arithmetic that adapts to you as you play.');
    const tags = card!.findAll((node) => node.type === 'span' && String(node.props.className).includes('train-card-tag'));
    expect(tags.map(visibleTextOf)).toEqual(['Math', 'Processing speed', 'Memory']);
    // Screen readers hear a label and a pause between chips; browsers add the spaces between the chip boxes.
    expect(textOf(card!.findByProps({ className: 'train-card-tags' }))).toBe('Domains: Math,Processing speed,Memory');
    expect(visibleTextOf(card!.findByProps({ className: 'train-card-facts' }))).toBe('90 seconds10 levels');
  });

  it('describes the button with the card text, by ids that exist', () => {
    const button = renderer.root.findByType('li').findByType('button');
    const ids = String(button.props['aria-describedby']).split(' ');
    expect(ids).toEqual(['game-mental-math-desc', 'game-mental-math-tags', 'game-mental-math-facts']);
    for (const id of ids) expect(renderer.root.findAllByProps({ id })).toHaveLength(1);
    expect(button.props.type).toBe('button');
  });

  it('opens the game by its ID from the card button', () => {
    act(() => renderer.root.findByType('li').findByType('button').props.onClick());
    expect(onOpenGame).toHaveBeenCalledExactlyOnceWith('mental-math');
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
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => { create(<GameScreen gameId="constructor" onExit={onExit} />); })).toThrow(/No screen for game 'constructor'/);
  });
});
