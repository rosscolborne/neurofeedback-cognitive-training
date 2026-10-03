import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperienceType } from '../../../types';
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
  const onStartExperience = vi.fn();
  const render = (allowedExperiences: string[]) => act(() => {
    renderer = create(
      <TrainTab allowedExperiences={allowedExperiences as ExperienceType[]} onOpenGame={onOpenGame} onStartExperience={onStartExperience} />,
    );
  });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(() => { act(() => renderer.unmount()); });

  it('lists the games first and NeuroGambit after them, as optional headset training', () => {
    render(['neuro-gambit']);
    expect(textOf(renderer.root.findByType('h1'))).toBe('Train');
    expect(sections(renderer).map(({ title }) => title)).toEqual(['Games', 'Headset training']);
    const [games, headset] = sections(renderer).map(({ section }) => section);
    expect(cardNames(games!)).toEqual(['Mental Math']);
    expect(cardNames(headset!)).toEqual(['NeuroGambit']);
    expect(textOf(headset!)).toContain('Optional');
    expect(textOf(headset!)).toContain('Muse headset or Demo Mode');
    // NeuroGambit keeps the experience card the clinical-era suites count; games do not carry it.
    expect(headset!.findByType('li').props.className).toBe('train-card card-patient');
    expect(games!.findByType('li').props.className).toBe('train-card train-game-card');
  });

  it('opens a game and starts NeuroGambit through their own paths', () => {
    render(['neuro-gambit']);
    act(() => cardButton(renderer, 'Mental Math').props.onClick());
    expect(onOpenGame).toHaveBeenCalledExactlyOnceWith('mental-math');
    expect(onStartExperience).not.toHaveBeenCalled();
    act(() => cardButton(renderer, 'NeuroGambit').props.onClick());
    expect(onStartExperience).toHaveBeenCalledExactlyOnceWith('neuro-gambit');
    expect(onOpenGame).toHaveBeenCalledTimes(1);
  });

  it('still lists every game when no headset experience is assigned, and leaves the headset section out', () => {
    for (const allowed of [[], ['skyline-drift']]) {
      render(allowed);
      expect(sections(renderer).map(({ title }) => title)).toEqual(['Games']);
      expect(cardNames(sections(renderer)[0]!.section)).toEqual(['Mental Math']);
      expect(textOf(renderer.root.findByType('div'))).not.toContain('NeuroGambit');
      act(() => renderer.unmount());
    }
    render([]);
  });
});
