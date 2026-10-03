// Live reads that recover (NFCT-66). A Firestore listener that fails is
// finished: the SDK does not restart it. A transient failure (a dropped
// connection, a token refresh, an index still building, rules being deployed)
// would otherwise leave a screen unavailable until it is reopened. This
// re-subscribes after a failure, backing off, and starts over at the shortest
// delay once a listener has stayed up for the longest delay (a value from the
// cache does not count: a listener can deliver one and then fail every time). The caller still hears every failure, so it
// can show an unavailable state in between.

export interface RetryPolicy {
  /** The delay before the first re-subscription. */
  readonly initialDelayMs: number;
  /** The longest delay between re-subscriptions. */
  readonly maxDelayMs: number;
}

export const LISTENER_RETRY_POLICY: RetryPolicy = { initialDelayMs: 2_000, maxDelayMs: 60_000 };

export interface RetryTimers {
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (handle: unknown) => void;
  /** Milliseconds, for how long a listener stayed up. */
  readonly now: () => number;
}

const browserTimers: RetryTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export type Subscribe<T> = (onNext: (value: T) => void, onError: (error: Error) => void) => () => void;

/**
 * Subscribes with `subscribe` and re-subscribes after each failure, after
 * `initialDelayMs`, doubling up to `maxDelayMs`; a listener that stayed up
 * for `maxDelayMs` before failing starts over at `initialDelayMs`. A synchronous throw (for
 * example, signed out) is reported once and not retried: subscribing again
 * would throw again. Returns the unsubscribe, which also cancels a pending retry.
 */
export function subscribeWithRetry<T>(
  subscribe: Subscribe<T>,
  onNext: (value: T) => void,
  onError: (error: unknown) => void,
  policy: RetryPolicy = LISTENER_RETRY_POLICY,
  timers: RetryTimers = browserTimers,
): () => void {
  let stopped = false;
  let stop: (() => void) | null = null;
  let timer: unknown = null;
  let delayMs = policy.initialDelayMs;
  let attempt = 0;

  const start = (): void => {
    attempt += 1;
    const current = attempt;
    let failed = false;
    const startedAt = timers.now();
    const live = () => !stopped && current === attempt && !failed;
    try {
      const unsubscribe = subscribe(
        (value) => {
          if (!live()) return;
          onNext(value);
        },
        (error) => {
          if (!live()) return;
          failed = true;
          stop?.();
          stop = null;
          onError(error);
          if (timers.now() - startedAt >= policy.maxDelayMs) delayMs = policy.initialDelayMs;
          timer = timers.set(() => {
            timer = null;
            if (!stopped) start();
          }, delayMs);
          delayMs = Math.min(delayMs * 2, policy.maxDelayMs);
        },
      );
      // A listener that failed before subscribe returned (or after the caller stopped) is released at once.
      if (failed || stopped) unsubscribe();
      else stop = unsubscribe;
    } catch (error) {
      stop = null;
      onError(error);
    }
  };

  start();
  return () => {
    stopped = true;
    if (timer !== null) timers.clear(timer);
    timer = null;
    stop?.();
    stop = null;
  };
}
