import type { GameClock, GameTimerHandle } from '../../../clock/gameClock';

/** A GameClock the test advances by hand. Due timers fire in time order, including ones scheduled while advancing. */
export class ManualClock implements GameClock {
  private time = 0;
  private wall = 1_790_000_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  wallNow(): number {
    return this.wall + this.time;
  }

  setTimeout(callback: () => void, ms: number): GameTimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback });
    return id as unknown as GameTimerHandle;
  }

  clearTimeout(handle: GameTimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (due === undefined || entry[1].at < due[1].at)) due = entry;
      }
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = target;
  }
}
