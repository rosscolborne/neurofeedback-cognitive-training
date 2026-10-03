import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientProfile } from '../../../types';
import { HomeScreen } from '../HomeScreen';
import { ProgressHistory } from '../ProgressHistory';

// NFCT-13: Home and Progress are the games. The inherited neurofeedback
// training and its session history are gone.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client: ClientProfile = { id: 'p', name: 'Sam Player', email: 'p@example.test', status: 'active', brainMaps: [] };

const nodeText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(nodeText).join(' '));
const games = <section data-testid="games"><h2>Games come first</h2></section>;

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe('Home', () => {
  it('greets the player and shows the games, with no neurofeedback training', () => {
    act(() => { renderer = create(<HomeScreen client={client} gamesSection={games} />); });
    const text = nodeText(renderer!.root);
    expect(text).toMatch(/Good (morning|afternoon|evening) ,? ?Sam\./);
    expect(text).toContain('Games come first');
    expect(text).not.toMatch(/Neurofeedback|NeuroGambit|Begin Session|Training Session/);
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });
});

describe('Progress', () => {
  it('shows the title and the games, with no neurofeedback history', () => {
    act(() => { renderer = create(<ProgressHistory gamesSection={games} />); });
    const text = nodeText(renderer!.root);
    expect(text.indexOf('Your Progress')).toBeLessThan(text.indexOf('Games come first'));
    expect(text).not.toMatch(/Neurofeedback|Session History|target zone|Milestones|Export Data/);
  });
});
