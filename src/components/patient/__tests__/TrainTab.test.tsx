import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrainTab } from '../TrainTab';

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

const sections = (renderer: ReactTestRenderer) => renderer.root.findAllByType('section')
  .map((section) => ({ title: textOf(renderer.root.findByProps({ id: section.props['aria-labelledby'] })), section }));
const cardNames = (section: ReactTestInstance) => section.findAllByType('li').map((item) => textOf(item.findByType('button')));
const cardButton = (renderer: ReactTestRenderer, name: string) => renderer.root.findAll((node) => node.type === 'button' && textOf(node) === name)[0]!;

describe('Train tab', () => {
  let renderer: ReactTestRenderer;
  const onOpenGame = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    act(() => { renderer = create(<TrainTab onOpenGame={onOpenGame} />); });
  });

  afterEach(() => { act(() => renderer.unmount()); });

  it('lists only the games', () => {
    expect(textOf(renderer.root.findByType('h1'))).toBe('Train');
    expect(sections(renderer).map(({ title }) => title)).toEqual(['Games']);
    const [games] = sections(renderer).map(({ section }) => section);
    expect(cardNames(games!)).toEqual(['Mental Math']);
    expect(games!.findByType('li').props.className).toBe('train-card train-game-card');
    expect(textOf(renderer.root.findByType('div'))).not.toMatch(/NeuroGambit|Headset training/);
  });

  it('opens a game through its own path', () => {
    act(() => cardButton(renderer, 'Mental Math').props.onClick());
    expect(onOpenGame).toHaveBeenCalledExactlyOnceWith('mental-math');
  });
});
