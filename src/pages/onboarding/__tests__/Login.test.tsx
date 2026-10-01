import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  login: vi.fn(), loginAsDemoClinician: vi.fn(), requestPasswordReset: vi.fn(), navigate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => auth.navigate }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));

import { Login } from '../Login';

const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
const button = (renderer: ReactTestRenderer, label: string) => renderer.root.findAllByType('button').find((node) => text(node).includes(label))!;
const form = (renderer: ReactTestRenderer) => renderer.root.findByType('form');
const emailInput = (renderer: ReactTestRenderer) => renderer.root.findByProps({ type: 'email' });
const alert = (renderer: ReactTestRenderer) => text(renderer.root.findByProps({ role: 'alert' }));
const status = (renderer: ReactTestRenderer) => text(renderer.root.findByProps({ role: 'status' }));
async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Login />); });
  return renderer;
}
async function submit(renderer: ReactTestRenderer) {
  await act(async () => { await form(renderer).props.onSubmit({ preventDefault: vi.fn() }); });
}
const submitButton = (renderer: ReactTestRenderer) => renderer.root.findByProps({ type: 'submit' });
async function typeEmail(renderer: ReactTestRenderer, value: string) {
  await act(async () => { emailInput(renderer).props.onChange({ target: { value } }); });
}
async function openResetFor(renderer: ReactTestRenderer, value: string) {
  await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
  await typeEmail(renderer, value);
}
// Serializes the rendered tree without per-instance handler functions.
const rendered = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('Login password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.loginAsDemoClinician.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('marks the fields for Password AutoFill (NFCT-33)', async () => {
    const renderer = await mount();
    expect(emailInput(renderer).props.autoComplete).toBe('email');
    const password = renderer.root.findByProps({ type: 'password' });
    expect(password.props.autoComplete).toBe('current-password');
    expect(password.props.enterKeyHint).toBe('go');
    renderer.unmount();
  });

  it('keeps the sample clinician workspace entry usable', async () => {
    const renderer = await mount();
    expect(text(renderer.root)).toContain('Fictional sample records for demonstration only');
    await act(async () => { await button(renderer, 'Open Sample Clinician Workspace').props.onClick(); });
    expect(auth.loginAsDemoClinician).toHaveBeenCalledOnce();
    expect(auth.navigate).toHaveBeenCalledWith('/');
    renderer.unmount();
  });

  it('uses the typed email without a password and returns to login with it preserved', async () => {
    const renderer = await mount();
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: ' person@example.test ' } }); });
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    expect(emailInput(renderer).props.value).toBe(' person@example.test ');
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('person@example.test');
    expect(status(renderer)).toContain('If an account uses that email address');
    expect(auth.login).not.toHaveBeenCalled();
    await act(async () => { button(renderer, 'Return to login').props.onClick(); });
    expect(emailInput(renderer).props.value).toBe(' person@example.test ');
    expect(button(renderer, 'Log In')).toBeTruthy();
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0);
    renderer.unmount();
  });

  it.each(['', 'not-an-email', 'bad@@example.test'])('rejects invalid address before Firebase: %s', async (value) => {
    const renderer = await mount();
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    await act(async () => { emailInput(renderer).props.onChange({ target: { value } }); });
    await submit(renderer);
    expect(alert(renderer)).toContain('valid email address');
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('prevents repeated submissions while a request is pending', async () => {
    let resolve!: () => void;
    auth.requestPasswordReset.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const renderer = await mount();
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: 'person@example.test' } }); });
    let pending!: Promise<void>;
    act(() => { pending = form(renderer).props.onSubmit({ preventDefault: vi.fn() }); });
    expect(button(renderer, 'Sending...').props.disabled).toBe(true);
    await act(async () => { await form(renderer).props.onSubmit({ preventDefault: vi.fn() }); });
    expect(auth.requestPasswordReset).toHaveBeenCalledOnce();
    await act(async () => { resolve(); await pending; });
    renderer.unmount();
  });

  it('uses the same confirmation for a missing account', async () => {
    auth.requestPasswordReset.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    const renderer = await mount();
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: 'missing@example.test' } }); });
    await submit(renderer);
    expect(status(renderer)).toContain('If an account uses that email address');
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    renderer.unmount();
  });

  it.each([
    ['auth/invalid-email', 'valid email address'],
    ['auth/network-request-failed', 'connection'],
    ['auth/too-many-requests', 'wait'],
    ['auth/internal-error', 'try again'],
  ])('maps %s to a safe retry message', async (code, expected) => {
    auth.requestPasswordReset.mockRejectedValueOnce({ code, message: 'sensitive Firebase detail' });
    const renderer = await mount();
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: 'person@example.test' } }); });
    await submit(renderer);
    expect(alert(renderer).toLowerCase()).toContain(expected);
    expect(alert(renderer)).not.toContain('sensitive Firebase detail');
    await act(async () => { button(renderer, 'Return to login').props.onClick(); });
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    renderer.unmount();
  });

  it('allows a corrected address and a retry after a connection error', async () => {
    auth.requestPasswordReset.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    const renderer = await mount();
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: 'first@example.test' } }); });
    await submit(renderer);
    expect(alert(renderer)).toContain('Connection problem');
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: 'corrected@example.test' } }); });
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenNthCalledWith(2, 'corrected@example.test');
    expect(status(renderer)).toContain('If an account uses that email address');
    renderer.unmount();
  });

  it('points a login lockout to the visible reset action', async () => {
    auth.login.mockRejectedValueOnce({ code: 'auth/too-many-requests' });
    const renderer = await mount();
    await act(async () => { emailInput(renderer).props.onChange({ target: { value: 'person@example.test' } }); });
    await act(async () => { renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'wrong' } }); });
    await submit(renderer);
    expect(alert(renderer)).toContain('Forgot password?');
    expect(button(renderer, 'Forgot password?')).toBeTruthy();
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    renderer.unmount();
  });
});

describe('Login password reset cooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    auth.requestPasswordReset.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks an immediate repeat request and shows the remaining time', async () => {
    const renderer = await mount();
    await openResetFor(renderer, 'person@example.test');
    await submit(renderer);
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenCalledOnce();
    expect(status(renderer)).toContain('If an account uses that email address');
    expect(status(renderer)).toContain('spam');
    expect(submitButton(renderer).props.disabled).toBe(true);
    expect(text(submitButton(renderer))).toBe('Resend in 60s');
    await advance(1_000);
    expect(text(submitButton(renderer))).toBe('Resend in 59s');
    await advance(41_000);
    expect(text(submitButton(renderer))).toBe('Resend in 18s');
    expect(submitButton(renderer).props.disabled).toBe(true);
    renderer.unmount();
  });

  it('keeps the countdown out of the status live region', async () => {
    const renderer = await mount();
    await openResetFor(renderer, 'person@example.test');
    await submit(renderer);
    const before = status(renderer);
    await advance(5_000);
    expect(status(renderer)).toBe(before);
    expect(status(renderer)).not.toMatch(/\d+s/);
    for (let node: ReactTestInstance | null = submitButton(renderer); node; node = node.parent) {
      expect(node.props['aria-live']).toBeUndefined();
      expect(['status', 'alert']).not.toContain(node.props.role);
    }
    renderer.unmount();
  });

  it('renders a missing account exactly like a sent reset, including the cooldown and a later resend', async () => {
    const sent = await mount();
    await openResetFor(sent, 'person@example.test');
    await submit(sent);

    auth.requestPasswordReset.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    const missing = await mount();
    await openResetFor(missing, 'person@example.test');
    await submit(missing);

    expect(rendered(missing)).toBe(rendered(sent));
    expect(text(submitButton(missing))).toBe('Resend in 60s');
    expect(missing.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    await submit(missing);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(2);

    await advance(60_000);
    auth.requestPasswordReset.mockResolvedValueOnce(undefined);
    await submit(sent);
    auth.requestPasswordReset.mockRejectedValueOnce({ code: 'auth/email-not-found' });
    await submit(missing);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(4);
    expect(rendered(missing)).toBe(rendered(sent));
    expect(status(missing)).toContain('most recent email');
    sent.unmount();
    missing.unmount();
  });

  it.each([
    'auth/invalid-email',
    'auth/network-request-failed',
    'auth/too-many-requests',
    'auth/internal-error',
  ])('does not start a cooldown after %s', async (code) => {
    auth.requestPasswordReset.mockRejectedValueOnce({ code });
    const renderer = await mount();
    await openResetFor(renderer, 'person@example.test');
    await submit(renderer);
    expect(alert(renderer)).toBeTruthy();
    expect(submitButton(renderer).props.disabled).toBe(false);
    expect(text(submitButton(renderer))).toBe('Send reset instructions');
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(status(renderer)).toContain('password reset instructions');
    expect(status(renderer)).not.toContain('most recent email');
    renderer.unmount();
  });

  it('lets a corrected address send immediately and re-applies the cooldown to the original address', async () => {
    const renderer = await mount();
    await openResetFor(renderer, 'first@example.test');
    await submit(renderer);
    await typeEmail(renderer, 'second@example.test');
    expect(submitButton(renderer).props.disabled).toBe(false);
    expect(text(submitButton(renderer))).toBe('Send reset instructions');
    await advance(10_000);
    await typeEmail(renderer, ' FIRST@Example.test ');
    expect(submitButton(renderer).props.disabled).toBe(true);
    expect(text(submitButton(renderer))).toBe('Resend in 50s');
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenCalledOnce();
    await typeEmail(renderer, 'second@example.test');
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenNthCalledWith(2, 'second@example.test');
    expect(status(renderer)).not.toContain('most recent email');
    expect(text(submitButton(renderer))).toBe('Resend in 60s');
    renderer.unmount();
  });

  it('keeps the cooldown after returning to login and reopening the reset view', async () => {
    const renderer = await mount();
    await openResetFor(renderer, 'person@example.test');
    await submit(renderer);
    await act(async () => { button(renderer, 'Return to login').props.onClick(); });
    expect(vi.getTimerCount()).toBe(0);
    await advance(5_000);
    await act(async () => { button(renderer, 'Forgot password?').props.onClick(); });
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0);
    expect(submitButton(renderer).props.disabled).toBe(true);
    expect(text(submitButton(renderer))).toBe('Resend in 55s');
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('allows a resend after the cooldown and says only the newest link works', async () => {
    const renderer = await mount();
    await openResetFor(renderer, 'person@example.test');
    await submit(renderer);
    await advance(59_000);
    expect(text(submitButton(renderer))).toBe('Resend in 1s');
    await advance(1_000);
    expect(submitButton(renderer).props.disabled).toBe(false);
    expect(text(submitButton(renderer))).toBe('Resend reset instructions');
    expect(vi.getTimerCount()).toBe(0);
    await submit(renderer);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(status(renderer)).toContain('If an account uses that email address');
    expect(status(renderer)).toContain('most recent email');
    expect(status(renderer)).toContain('Earlier reset links no longer work');
    expect(text(submitButton(renderer))).toBe('Resend in 60s');
    expect(submitButton(renderer).props.disabled).toBe(true);
    renderer.unmount();
  });

  it('stops the countdown timer on unmount', async () => {
    const renderer = await mount();
    await openResetFor(renderer, 'person@example.test');
    await submit(renderer);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { renderer.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
