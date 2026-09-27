import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Login password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.loginAsDemoClinician.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
