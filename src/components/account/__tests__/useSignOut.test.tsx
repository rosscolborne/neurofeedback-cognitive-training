import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignOut } from '../useSignOut';

// The shells' Log Out flow: unsynced writes are never discarded without the
// user choosing to, and repeated clicks start one sign-out.

type Logout = (options?: { discardUnsyncedWrites?: boolean }) => Promise<'signed-out' | 'unsynced'>;

let flow: ReturnType<typeof useSignOut>;
const Shell = ({ logout }: { logout: Logout }) => {
  const value = useSignOut(logout);
  React.useEffect(() => { flow = value; });
  return <div>{value.dialog}</div>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const buttons = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button');
const button = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const match = buttons(renderer).find((candidate) => candidate.children.join('') === label);
  if (!match) throw new Error(`No button "${label}"`);
  return match;
};
const dialogs = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.role === 'alertdialog');

describe('useSignOut', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { activeElement: null });
  });

  it('signs out straight away when everything has uploaded', async () => {
    const logout = vi.fn<Logout>(async () => 'signed-out');
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Shell logout={logout} />); });

    await act(async () => { flow.requestSignOut(); });
    expect(logout).toHaveBeenCalledWith(undefined);
    expect(dialogs(renderer)).toHaveLength(0);
    expect(flow.busy).toBe(true);
    renderer.unmount();
  });

  it('asks before discarding unsynced writes; staying signed in discards nothing', async () => {
    const logout = vi.fn<Logout>(async () => 'unsynced');
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Shell logout={logout} />); });

    await act(async () => { flow.requestSignOut(); });
    expect(dialogs(renderer)).toHaveLength(1);
    expect(dialogs(renderer)[0]!.props['aria-modal']).toBe('true');
    expect(JSON.stringify(renderer.toJSON())).toContain('Signing out now will delete it from this device');
    expect(flow.busy).toBe(false);

    await act(async () => { button(renderer, 'Stay signed in').props.onClick(); });
    expect(dialogs(renderer)).toHaveLength(0);
    expect(logout).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('discards them only when the user chooses to sign out anyway', async () => {
    const logout = vi.fn<Logout>()
      .mockResolvedValueOnce('unsynced')
      .mockResolvedValueOnce('signed-out');
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Shell logout={logout} />); });

    await act(async () => { flow.requestSignOut(); });
    await act(async () => { button(renderer, 'Sign out anyway').props.onClick(); });
    expect(logout).toHaveBeenLastCalledWith({ discardUnsyncedWrites: true });
    expect(button(renderer, 'Signing out…').props.disabled).toBe(true);
    expect(button(renderer, 'Stay signed in').props.disabled).toBe(true);
    renderer.unmount();
  });

  it('starts one sign-out however often Log Out is pressed', async () => {
    const check = deferred<'signed-out' | 'unsynced'>();
    const logout = vi.fn<Logout>(() => check.promise);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Shell logout={logout} />); });

    await act(async () => { flow.requestSignOut(); flow.requestSignOut(); });
    expect(flow.busy).toBe(true);
    await act(async () => { flow.requestSignOut(); check.resolve('signed-out'); });
    expect(logout).toHaveBeenCalledOnce();
    renderer.unmount();
  });
});
