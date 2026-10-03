import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@nfct/shared';
import type { User } from 'firebase/auth';

// The signed-in shell: each tab has its own path, the shell stays mounted as
// the tabs change, and a game opens in place of the tabs.

vi.mock('../../../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../../games/GameScreen', () => ({ GameScreen: 'game-screen' }));
vi.mock('../HomeScreen', () => ({ HomeScreen: 'home-screen' }));
vi.mock('../TrainScreen', () => ({ TrainScreen: 'train-screen' }));
vi.mock('../ProgressScreen', () => ({ ProgressScreen: 'progress-screen' }));
vi.mock('../../profile/ProfileScreen', () => ({ ProfileScreen: 'profile-screen' }));

import { AppShell } from '../AppShell';

const player = { uid: 'player-1', email: 'p@example.com' } as User;
const profile = { displayName: 'Pat' } as UserProfile;

/** The router's current location, and a way to move it as the browser's Back or an address would. */
const router: { location?: Location; navigate?: NavigateFunction } = {};
const observe = (location: Location, navigate: NavigateFunction) => Object.assign(router, { location, navigate });
const RouterProbe = ({ onRender }: { onRender: typeof observe }) => {
  onRender(useLocation(), useNavigate());
  return null;
};

const element = (renderer: ReactTestRenderer, type: string): ReactTestInstance => renderer.root.find((node) => (node.type as unknown) === type);
const elements = (renderer: ReactTestRenderer, type: string): ReactTestInstance[] => renderer.root.findAll((node) => (node.type as unknown) === type);
const tabButton = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findByType('nav').findAllByType('button').find((button) => button.props['aria-label'] === label)!;
const pressTab = (renderer: ReactTestRenderer, label: string) => act(() => tabButton(renderer, label).props.onClick());
const currentTab = (renderer: ReactTestRenderer) =>
  renderer.root.findByType('nav').findAllByType('button').filter((button) => button.props['aria-current'] === 'page').map((button) => button.props['aria-label']);

describe('the app shell', () => {
  let renderer: ReactTestRenderer;
  const onSetUpHeadset = vi.fn();

  const render = async (path: string) => {
    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={[path]}>
          <RouterProbe onRender={observe} />
          <Routes>
            <Route path="/*" element={<AppShell user={player} profile={profile} onSetUpHeadset={onSetUpHeadset} />} />
          </Routes>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it.each([
    ['/', 'Home', 'home-screen'],
    ['/train', 'Train', 'train-screen'],
    ['/progress', 'Progress', 'progress-screen'],
    ['/profile', 'Profile', 'profile-screen'],
    ['/train/', 'Train', 'train-screen'],
  ])('opens %s on its tab', async (path, tab, screen) => {
    await render(path);
    expect(currentTab(renderer)).toEqual([tab]);
    expect(elements(renderer, screen)).toHaveLength(1);
    expect(renderer.root.findByType('main').children).toHaveLength(1);
  });

  it('sends any other path to Home', async () => {
    await render('/role-selection');
    expect(router.location!.pathname).toBe('/');
    expect(currentTab(renderer)).toEqual(['Home']);
  });

  it('gives each screen the signed-in player', async () => {
    await render('/');
    expect(element(renderer, 'home-screen').props).toMatchObject({ playerId: 'player-1', displayName: 'Pat' });
    pressTab(renderer, 'Progress');
    expect(element(renderer, 'progress-screen').props.playerId).toBe('player-1');
    pressTab(renderer, 'Profile');
    expect(element(renderer, 'profile-screen').props).toMatchObject({ user: player, profile, onSetUpHeadset });
  });

  it('moves between tabs by path, and the browser’s Back returns to the previous tab', async () => {
    await render('/');
    pressTab(renderer, 'Train');
    expect(router.location!.pathname).toBe('/train');
    pressTab(renderer, 'Profile');
    expect(router.location!.pathname).toBe('/profile');
    expect(currentTab(renderer)).toEqual(['Profile']);

    act(() => { void router.navigate!(-1); });
    expect(router.location!.pathname).toBe('/train');
    expect(currentTab(renderer)).toEqual(['Train']);
  });

  it('adds no history entry when the current tab is pressed again', async () => {
    await render('/train');
    const before = router.location!.key;
    pressTab(renderer, 'Train');
    expect(router.location!.key).toBe(before);
  });

  it('names the app in its header, with no clinical portal subtitle', async () => {
    await render('/');
    const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
    expect(textOf(renderer.root.findByType('header'))).not.toMatch(/Portal|patient|clinic/i);
  });

  describe('the "See all achievements" request', () => {
    it('opens Progress at its achievements, and is done once they are focused', async () => {
      await render('/');
      act(() => element(renderer, 'home-screen').props.onOpenAchievements());
      expect(router.location!.pathname).toBe('/progress');
      const progress = element(renderer, 'progress-screen');
      expect(progress.props.focusSection).toBe('achievements');
      act(() => progress.props.onSectionFocused());
      expect(element(renderer, 'progress-screen').props.focusSection).toBeNull();
      expect(router.location!.pathname).toBe('/progress');
    });

    it('is dropped when the player leaves Progress before it has loaded', async () => {
      await render('/');
      act(() => element(renderer, 'home-screen').props.onOpenAchievements());
      expect(element(renderer, 'progress-screen').props.focusSection).toBe('achievements');
      pressTab(renderer, 'Home');
      pressTab(renderer, 'Progress');
      expect(element(renderer, 'progress-screen').props.focusSection).toBeNull();
    });

    it('never applies to an ordinary visit to Progress', async () => {
      await render('/');
      pressTab(renderer, 'Progress');
      expect(element(renderer, 'progress-screen').props.focusSection).toBeNull();
      await act(async () => { renderer.unmount(); });
      await render('/progress');
      expect(element(renderer, 'progress-screen').props.focusSection).toBeNull();
    });
  });

  describe('an open game', () => {
    it('replaces the tabs for the signed-in player, and closing it brings the tabs back', async () => {
      await render('/train');
      act(() => element(renderer, 'train-screen').props.onOpenGame({ gameId: 'mental-math', returnFocusTo: 'card-mental-math' }));
      const game = element(renderer, 'game-screen');
      expect(game.props).toMatchObject({ gameId: 'mental-math' });
      expect(renderer.root.findAllByType('nav')).toHaveLength(0);

      act(() => game.props.onExit());
      expect(elements(renderer, 'game-screen')).toHaveLength(0);
      expect(currentTab(renderer)).toEqual(['Train']);
    });

    it('opens on the view a screen asks for', async () => {
      await render('/progress');
      act(() => element(renderer, 'progress-screen').props.onOpenGame({ gameId: 'mental-math', initialView: 'progress' }));
      expect(element(renderer, 'game-screen').props.initialView).toBe('progress');
    });

    it('stays open when the location changes under it, and then shows the tab it changed to', async () => {
      await render('/');
      pressTab(renderer, 'Train');
      act(() => element(renderer, 'train-screen').props.onOpenGame({ gameId: 'mental-math' }));
      act(() => { void router.navigate!(-1); });
      expect(router.location!.pathname).toBe('/');
      const game = element(renderer, 'game-screen');
      act(() => game.props.onExit());
      expect(currentTab(renderer)).toEqual(['Home']);
    });
  });
});
