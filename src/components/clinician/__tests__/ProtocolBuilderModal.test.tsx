import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ProtocolBuilderModal } from '../ProtocolBuilderModal';

describe('ProtocolBuilderModal persistence state', () => {
  it('stays open and reports a failed protocol assignment', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('protocol save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ProtocolBuilderModal onSave={onSave} onClose={onClose} />);
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('protocol save offline');
    renderer.unmount();
  });
});
