import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boundHistory, HISTORY_PAGE_SIZE, historyCountText, showMoreText, useBoundedHistory } from '../boundedHistory';
import { HistoryShowMore } from '../HistoryShowMore';

const rows = (count: number) => Array.from({ length: count }, (_, index) => `row-${index}`);
const nodeText = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('');

describe('boundHistory', () => {
  it('uses a ten-row page', () => {
    expect(HISTORY_PAGE_SIZE).toBe(10);
  });

  it.each([
    [0, 0, 0, false],
    [1, 1, 0, false],
    [10, 10, 0, false],
    [11, 10, 1, true],
    [43, 10, 10, true],
  ])('bounds %i rows to the first page', (count, shown, nextCount, paged) => {
    const result = boundHistory(rows(count), HISTORY_PAGE_SIZE);
    expect(result).toMatchObject({ shown, total: count, nextCount, paged });
    expect(result.visible).toEqual(rows(count).slice(0, shown));
  });

  it('keeps the given order and reveals a short final page', () => {
    const result = boundHistory(rows(43), 40);
    expect(result.visible[0]).toBe('row-0');
    expect(result.visible.at(-1)).toBe('row-39');
    expect(result).toMatchObject({ shown: 40, nextCount: 3, paged: true });
    expect(boundHistory(rows(43), 50)).toMatchObject({ shown: 43, nextCount: 0, paged: true });
  });

  it('never renders less than one page or an unbounded list for a bad limit', () => {
    expect(boundHistory(rows(30), 0).shown).toBe(10);
    expect(boundHistory(rows(30), -5).shown).toBe(10);
    expect(boundHistory(rows(30), Number.NaN).shown).toBe(10);
    expect(boundHistory(rows(30), Number.POSITIVE_INFINITY).shown).toBe(10);
    expect(boundHistory(rows(30), 12.7).shown).toBe(12);
    expect(boundHistory(rows(30), 5, 4)).toMatchObject({ shown: 5, nextCount: 4 });
  });

  it('words the count and control calmly', () => {
    expect(historyCountText(10, 43)).toBe('Showing 10 of 43 sessions');
    expect(historyCountText(43, 43)).toBe('Showing all 43 sessions');
    expect(historyCountText(1, 1)).toBe('Showing all 1 session');
    expect(showMoreText(10)).toBe('Show 10 more sessions');
    expect(showMoreText(1)).toBe('Show 1 more session');
  });
});

describe('useBoundedHistory', () => {
  type Snapshot = { shown: number; total: number; nextCount: number; visible: string[] };
  /** Renders the hook's window into the tree and reports every commit. */
  const Probe: React.FC<{ items: string[]; resetKey: string; onCommit?: (snapshot: Snapshot) => void }> = ({ items, resetKey, onCommit }) => {
    const history = useBoundedHistory(items, resetKey);
    React.useLayoutEffect(() => { onCommit?.({ shown: history.shown, total: history.total, nextCount: history.nextCount, visible: history.visible }); });
    return <button type="button" data-shown={history.shown} data-total={history.total} data-next={history.nextCount} data-visible={history.visible.join(',')} onClick={history.showMore} />;
  };
  const state = (r: ReactTestRenderer) => {
    const probe = r.root.findByType('button');
    return { shown: probe.props['data-shown'], total: probe.props['data-total'], nextCount: probe.props['data-next'], visible: String(probe.props['data-visible']).split(',') };
  };
  const showMore = async (r: ReactTestRenderer) => { await act(async () => { r.root.findByType('button').props.onClick(); }); };
  beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('grows one page per step, never shrinks for the same key, and resets for a new key', async () => {
    const items = rows(25);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Probe items={items} resetKey="a" />); });
    expect(state(r).shown).toBe(10);
    await showMore(r);
    expect(state(r).shown).toBe(20);
    await act(async () => { r.update(<Probe items={[...items]} resetKey="a" />); });
    expect(state(r).shown).toBe(20);
    await showMore(r);
    expect(state(r)).toMatchObject({ shown: 25, nextCount: 0 });

    await act(async () => { r.update(<Probe items={rows(40)} resetKey="b" />); });
    expect(state(r)).toMatchObject({ shown: 10, total: 40, nextCount: 10 });
    // Returning to an earlier key is a fresh start too, not the old expansion.
    await act(async () => { r.update(<Probe items={items} resetKey="a" />); });
    expect(state(r).shown).toBe(10);
    await act(async () => { r.unmount(); });
  });

  it('keeps revealed rows when the list is replaced in place, as after a save', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Probe items={rows(30)} resetKey="a" />); });
    await showMore(r);
    const edited = rows(30).map((row) => row === 'row-15' ? 'row-15-saved' : row);
    await act(async () => { r.update(<Probe items={edited} resetKey="a" />); });
    expect(state(r).visible).toContain('row-15-saved');
    expect(state(r).shown).toBe(20);
    await act(async () => { r.unmount(); });
  });

  it('never commits the previous expansion for a new key', async () => {
    const commits: number[] = [];
    const onCommit = (snapshot: Snapshot) => { commits.push(snapshot.shown); };
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Probe items={rows(30)} resetKey="a" onCommit={onCommit} />); });
    await showMore(r);
    await showMore(r);
    expect(commits.at(-1)).toBe(30);
    commits.length = 0;
    await act(async () => { r.update(<Probe items={rows(30)} resetKey="b" onCommit={onCommit} />); });
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((shown) => shown === 10)).toBe(true);
    await act(async () => { r.unmount(); });
  });
});

describe('HistoryShowMore', () => {
  beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('shows the count with one control, and only the count once everything is shown', async () => {
    const onShowMore = vi.fn();
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<HistoryShowMore shown={10} total={23} nextCount={10} onShowMore={onShowMore} />); });
    expect(nodeText(r.root)).toContain('Showing 10 of 23 sessions');
    const button = r.root.findByType('button');
    expect(nodeText(button)).toBe('Show 10 more sessions');
    expect(button.props.type).toBe('button');
    await act(async () => { button.props.onClick(); });
    expect(onShowMore).toHaveBeenCalledTimes(1);

    await act(async () => { r.update(<HistoryShowMore shown={20} total={23} nextCount={3} onShowMore={onShowMore} />); });
    expect(nodeText(r.root.findByType('button'))).toBe('Show 3 more sessions');
    await act(async () => { r.root.findByType('button').props.onClick(); });
    await act(async () => { r.update(<HistoryShowMore shown={23} total={23} nextCount={0} onShowMore={onShowMore} />); });
    expect(r.root.findAllByType('button')).toHaveLength(0);
    expect(nodeText(r.root)).toContain('Showing all 23 sessions');
    const count = r.root.findByType('p');
    expect(count.props['aria-live']).toBe('polite');
    expect(count.props.tabIndex).toBe(-1);
    await act(async () => { r.unmount(); });
  });

  it('moves focus from the removed button to the count after the last page', async () => {
    const focus = vi.fn();
    const body = {};
    vi.stubGlobal('document', { body, activeElement: body });
    try {
      let r!: ReactTestRenderer;
      await act(async () => {
        r = create(<HistoryShowMore shown={20} total={23} nextCount={3} onShowMore={vi.fn()} />, { createNodeMock: () => ({ focus }) });
      });
      await act(async () => { r.root.findByType('button').props.onClick(); });
      await act(async () => { r.update(<HistoryShowMore shown={23} total={23} nextCount={0} onShowMore={vi.fn()} />); });
      expect(focus).toHaveBeenCalledTimes(1);
      await act(async () => { r.unmount(); });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not take focus when the history was completed some other way', async () => {
    const focus = vi.fn();
    const body = {};
    vi.stubGlobal('document', { body, activeElement: body });
    try {
      let r!: ReactTestRenderer;
      await act(async () => {
        r = create(<HistoryShowMore shown={10} total={23} nextCount={10} onShowMore={vi.fn()} />, { createNodeMock: () => ({ focus }) });
      });
      await act(async () => { r.root.findByType('button').props.onClick(); });
      await act(async () => { r.update(<HistoryShowMore shown={23} total={23} nextCount={0} onShowMore={vi.fn()} />); });
      expect(focus).not.toHaveBeenCalled();
      await act(async () => { r.unmount(); });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
