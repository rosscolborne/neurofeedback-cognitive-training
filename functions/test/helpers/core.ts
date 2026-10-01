import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { runSessionPipeline, type PipelineReport } from '../../src/pipeline';
import { processingContext, type Logger, type ProcessingContext } from '../../src/context';
import type { ProcessingLimits } from '../../src/policy';
import type { GameModuleRegistry } from '@nfct/shared';
import { newSessionId, sessionDoc, sessionPath, ts, type Plan } from './emulator';

export const quietLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function coreContext(
  db: Firestore,
  options: { limits?: Partial<ProcessingLimits>; registry?: GameModuleRegistry; now?: () => Timestamp } = {},
): ProcessingContext {
  return processingContext(db, { log: quietLogger, ...options });
}

/** Minutes before the test's reference time, for device-clock endedAt values. */
export function minutesAgo(minutes: number, reference = Date.now()): number {
  return reference - minutes * 60_000;
}

export type Written = { readonly id: string; readonly doc: Record<string, unknown> };

/**
 * Writes a conforming session as the client would (createdAt = server time
 * now), so the processing core finds it pending.
 */
export async function writeSession(db: Firestore, uid: string, plan: Plan & { order?: number; id?: string }): Promise<Written> {
  const id = plan.id ?? newSessionId(plan.order);
  const doc = sessionDoc(uid, { ...plan, createdAt: ts(Date.now()) });
  await db.doc(sessionPath(uid, id)).set(doc);
  return { id, doc };
}

/**
 * Writes a session as created at server time `createdAtMs` (and ended five
 * minutes before, unless the plan says otherwise), for tests whose sweep
 * window must contain only their own sessions.
 */
export async function writeSessionAt(
  db: Firestore,
  uid: string,
  createdAtMs: number,
  plan: Omit<Plan, 'endedAtMs'> & { endedAtMs?: number; order?: number; id?: string },
  change: Record<string, unknown> = {},
): Promise<Written> {
  const id = plan.id ?? newSessionId(plan.order);
  const doc = { ...sessionDoc(uid, { endedAtMs: createdAtMs - 5 * 60_000, ...plan, createdAt: ts(createdAtMs) }), ...change };
  await db.doc(sessionPath(uid, id)).set(doc);
  return { id, doc };
}

/**
 * Runs `attempt` until it succeeds, as the platform redelivers a trigger whose
 * handler threw (for example a transaction that gave up under contention).
 * Returns the result and how many redeliveries it took.
 */
export async function withRedelivery<T>(attempt: () => Promise<T>, maxAttempts = 10): Promise<{ value: T; redeliveries: number }> {
  for (let tries = 1; ; tries += 1) {
    try {
      return { value: await attempt(), redeliveries: tries - 1 };
    } catch (error) {
      if (tries >= maxAttempts) throw error;
    }
  }
}

/** Delivers a session to the pipeline, redelivering on failure like the platform. */
export async function deliver(context: ProcessingContext, uid: string, sessionId: string): Promise<{ value: PipelineReport; redeliveries: number }> {
  return withRedelivery(() => runSessionPipeline(context, uid, sessionId));
}
