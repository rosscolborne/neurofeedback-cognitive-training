import { describe, expect, it } from 'vitest';
import { mentalMath } from '@nfct/shared';
import { defaultStartLevel, startLevelChoices } from '../startLevel';
import { pickerState, playRun, progressWith, sessionRecord } from './fixtures';

const SEED = 99;

describe('start-level picker', () => {
  describe('default start level', () => {
    it('a new player: only level 1, selected', () => {
      expect(startLevelChoices(pickerState(null))).toMatchObject({ unlocked: 1, maxLevel: 10, defaultLevel: 1 });
    });

    it('the last start level used, while it is still unlocked', () => {
      const last = sessionRecord('sessionAAAAAAAAAAAA1', playRun({ seed: SEED, startLevel: 3, correct: 0 }), { awaitingResult: false, seed: SEED });
      expect(startLevelChoices(pickerState(progressWith(6), [last]))).toMatchObject({ unlocked: 5, defaultLevel: 3 });
    });

    it('the highest unlocked level when the last start level is no longer unlocked', () => {
      const last = sessionRecord('sessionAAAAAAAAAAAA1', playRun({ seed: SEED, startLevel: 4, correct: 0 }), { awaitingResult: false, seed: SEED });
      expect(startLevelChoices(pickerState(progressWith(3), [last]))).toMatchObject({ unlocked: 2, defaultLevel: 2 });
    });

    it('the highest unlocked level with no usable history', () => {
      expect(startLevelChoices(pickerState(progressWith(6)))).toMatchObject({ unlocked: 5, defaultLevel: 5 });
      expect(startLevelChoices(null)).toMatchObject({ unlocked: 1, defaultLevel: 1 });
      expect(defaultStartLevel(4, null)).toBe(4);
      expect(defaultStartLevel(4, 0)).toBe(4);
    });
  });

  it('reads the unlock from bestPeakLevel, never from the cached unlocked map', () => {
    const forged = progressWith(2, { unlocked: { [mentalMath.MODE_ID]: 10 } });
    expect(startLevelChoices(pickerState(forged)).unlocked).toBe(1);
    expect(startLevelChoices(pickerState(progressWith(10))).unlocked).toBe(10);
  });

  it('applies a pending completed run with the shared reducer, so its unlock shows at once', () => {
    const outcome = playRun({ seed: SEED, startLevel: 1, correct: 7 });
    expect(mentalMath.runPeakLevel(outcome.run)).toBe(3);
    const pending = sessionRecord('sessionAAAAAAAAAAAA1', outcome, { seed: SEED });
    expect(startLevelChoices(pickerState(null, [pending]))).toMatchObject({ unlocked: 2, defaultLevel: 1, previewed: true });
  });

  it('does not unlock from a pending run trusted scoring would flag or refuse', () => {
    // Started above the unlocked level: flagged, so no unlock.
    const locked = sessionRecord('sessionAAAAAAAAAAAA1', playRun({ seed: SEED, startLevel: 5, correct: 12 }), { seed: SEED });
    expect(startLevelChoices(pickerState(null, [locked])).unlocked).toBe(1);
    // Trials that do not come from the stored seed: invalid.
    const forged = sessionRecord('sessionAAAAAAAAAAAA2', playRun({ seed: SEED, startLevel: 1, correct: 12 }), { seed: SEED + 1 });
    expect(startLevelChoices(pickerState(null, [forged])).unlocked).toBe(1);
    // Abandoned runs never unlock.
    const abandoned = sessionRecord('sessionAAAAAAAAAAAA3', { ...playRun({ seed: SEED, startLevel: 1, correct: 12 }), status: 'abandoned' }, { seed: SEED });
    expect(startLevelChoices(pickerState(null, [abandoned])).unlocked).toBe(1);
  });

  it('shows progress kept by another reducer as the server left it, without a preview', () => {
    const pending = sessionRecord('sessionAAAAAAAAAAAA1', playRun({ seed: SEED, startLevel: 1, correct: 30 }), { seed: SEED });
    const newer = progressWith(3, { aggregateVersion: 2 });
    expect(startLevelChoices(pickerState(newer, [pending]))).toMatchObject({ unlocked: 2, previewed: false });
  });
});
