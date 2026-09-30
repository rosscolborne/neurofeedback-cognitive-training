import type { Firestore, Timestamp } from 'firebase-admin/firestore';
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
