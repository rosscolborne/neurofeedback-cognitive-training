import { describe, expect, it } from 'vitest';
import { subscribeWithRetry, type RetryTimers } from '../firestore/retryingSubscription';

const POLICY = { initialDelayMs: 1_000, maxDelayMs: 8_000 };

/** A fake clock with timers that fire when the test advances it. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: RetryTimers = {
    set: (callback, delayMs) => {
      const id = next++;
      pending.set(id, { at: now + delayMs, callback });
      return id;
    },
    clear: (handle) => { pending.delete(handle as number); },
    now: () => now,
  };
  return {
    timers,
    delays: () => [...pending.values()].map(({ at }) => at - now),
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

/** A listener source whose current subscription the test drives. */
function fakeSource<T>() {
  const subscriptions: { onNext: (value: T) => void; onError: (error: Error) => void; stopped: boolean }[] = [];
  return {
    subscriptions,
    subscribe: (onNext: (value: T) => void, onError: (error: Error) => void) => {
      const subscription = { onNext, onError, stopped: false };
      subscriptions.push(subscription);
      return () => { subscription.stopped = true; };
    },
    get latest() { return subscriptions.at(-1)!; },
  };
}

describe('subscribeWithRetry', () => {
  it('re-subscribes after a failure, so a transient listener error recovers', () => {
    const clock = fakeTimers();
    const source = fakeSource<number>();
    const events: string[] = [];
    subscribeWithRetry(source.subscribe, (value) => events.push(`value ${value}`), () => events.push('error'), POLICY, clock.timers);

    source.latest.onNext(1);
    source.latest.onError(new Error('unavailable'));
    expect(source.subscriptions[0]!.stopped).toBe(true);
    expect(source.subscriptions).toHaveLength(1);

    clock.advance(1_000);
    expect(source.subscriptions).toHaveLength(2);
    source.latest.onNext(2);
    expect(events).toEqual(['value 1', 'error', 'value 2']);
  });

  it('backs off, doubling up to the longest delay', () => {
    const clock = fakeTimers();
    const source = fakeSource<number>();
    subscribeWithRetry(source.subscribe, () => {}, () => {}, POLICY, clock.timers);
    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      // A value from the cache before each failure does not reset the backoff.
      source.latest.onNext(i);
      source.latest.onError(new Error('failed-precondition'));
      delays.push(clock.delays()[0]!);
      clock.advance(delays.at(-1)!);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  });

  it('starts over at the shortest delay after a listener stayed up for the longest one', () => {
    const clock = fakeTimers();
    const source = fakeSource<number>();
    subscribeWithRetry(source.subscribe, () => {}, () => {}, POLICY, clock.timers);
    source.latest.onError(new Error('a'));
    clock.advance(1_000);
    source.latest.onError(new Error('b'));
    expect(clock.delays()).toEqual([2_000]);
    clock.advance(2_000);
    clock.advance(8_000);
    source.latest.onError(new Error('c'));
    expect(clock.delays()).toEqual([1_000]);
  });

  it('ignores a failed listener’s later callbacks', () => {
    const clock = fakeTimers();
    const source = fakeSource<number>();
    const values: number[] = [];
    subscribeWithRetry(source.subscribe, (value) => values.push(value), () => {}, POLICY, clock.timers);
    const first = source.latest;
    first.onError(new Error('x'));
    first.onNext(99);
    first.onError(new Error('y'));
    expect(values).toEqual([]);
    expect(clock.delays()).toEqual([1_000]);
  });

  it('cancels a pending retry and the live listener when unsubscribed', () => {
    const clock = fakeTimers();
    const source = fakeSource<number>();
    const stop = subscribeWithRetry(source.subscribe, () => {}, () => {}, POLICY, clock.timers);
    source.latest.onError(new Error('x'));
    stop();
    clock.advance(10_000);
    expect(source.subscriptions).toHaveLength(1);

    const again = fakeSource<number>();
    const stopLive = subscribeWithRetry(again.subscribe, () => {}, () => {}, POLICY, clock.timers);
    stopLive();
    expect(again.latest.stopped).toBe(true);
  });

  it('reports a synchronous throw once and does not retry it', () => {
    const clock = fakeTimers();
    let calls = 0;
    const errors: unknown[] = [];
    subscribeWithRetry(() => { calls += 1; throw new Error('not signed in'); }, () => {}, (error) => errors.push(error), POLICY, clock.timers);
    clock.advance(60_000);
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('releases a listener that failed before subscribe returned', () => {
    const clock = fakeTimers();
    let released = 0;
    let errors = 0;
    subscribeWithRetry<number>((_onNext, onError) => {
      onError(new Error('immediate'));
      return () => { released += 1; };
    }, () => {}, () => { errors += 1; }, POLICY, clock.timers);
    expect(released).toBe(1);
    expect(errors).toBe(1);
    clock.advance(1_000);
    expect(released).toBe(2);
  });
});
