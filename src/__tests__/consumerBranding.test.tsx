import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import capacitorConfig from '../../capacitor.config';

// NFCT-38: the screens a consumer sees before the dashboard present the app's
// own name (APP_DISPLAY_NAME), never Waveable, the clinical product this app
// was forked from. The serialized tree includes attributes such as image alt
// text, not only visible text.

const state = vi.hoisted(() => ({ navigate: () => undefined }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'player-1', displayName: 'Player One' },
    profile: null,
    login: vi.fn(),
    signup: vi.fn(),
    requestPasswordReset: vi.fn(),
  }),
}));
vi.mock('../services/audioEngine', () => ({ audioEngine: { playMeditativeIntroChime: vi.fn() } }));
vi.mock('../services/eegEngine', () => ({
  eegEngine: {
    subscribe: vi.fn(() => vi.fn()),
  },
}));

import { APP_DISPLAY_NAME } from '../config/appIdentity';
import { BrandLogo } from '../components/brand/BrandLogo';
import { HardwareSetup } from '../pages/onboarding/HardwareSetup';
import { Login } from '../pages/onboarding/Login';
import { SignUp } from '../pages/onboarding/SignUp';
import { Welcome } from '../pages/onboarding/Welcome';


async function mount(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(element); });
  return renderer;
}

const SCREENS: [string, () => React.ReactElement][] = [
  ['Welcome', () => <Welcome />],
  ['Log in', () => <Login />],
  ['Sign up', () => <SignUp />],
  ['Hardware setup', () => <HardwareSetup />],
  ['Brand logo', () => <BrandLogo />],
];

describe('consumer branding', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the native display name as the in-app name', () => {
    expect(APP_DISPLAY_NAME).toBe(capacitorConfig.appName);
    expect(APP_DISPLAY_NAME).not.toMatch(/waveable/i);
  });

  it.each(SCREENS)('%s does not present the Waveable name', async (_screen, element) => {
    const renderer = await mount(element());
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered.length).toBeGreaterThan(100);
    expect(rendered).not.toMatch(/waveable/i);
    await act(async () => { renderer.unmount(); });
  });

  it('names the app by its display name where the product is named', async () => {
    const logo = await mount(<BrandLogo />);
    expect(logo.root.findByType('img').props.alt).toBe(`${APP_DISPLAY_NAME} logo`);
    await act(async () => { logo.unmount(); });
  });
});
