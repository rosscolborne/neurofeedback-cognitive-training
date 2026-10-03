import { describe, expect, it } from 'vitest';
import { DomainReadError, readUserProfile, userProfileWriteSchema } from '@nfct/shared';
import { at } from './fixtures';
import { PROFILE_SHAPE_NAMES, PROFILE_SHAPES } from './profileShapes';

// The historical profile shapes say what the app does with each; the browser
// tests and the nfct-dev audit rely on that being what the shared reader does.
describe('historical profile shapes', () => {
  const input = { displayName: 'Shape Player', email: 'shape@example.test', now: at(0) };

  it.each(PROFILE_SHAPE_NAMES)('the %s shape is read as the catalogue says', (name) => {
    const raw = PROFILE_SHAPES[name].build(input);
    if (PROFILE_SHAPES[name].appReads === 'readable') {
      expect(readUserProfile(raw)).toEqual(raw);
    } else {
      expect(() => readUserProfile(raw)).toThrow(DomainReadError);
    }
  });

  it('the current shape is what this app may write', () => {
    expect(() => userProfileWriteSchema.parse(PROFILE_SHAPES.current.build(input))).not.toThrow();
  });
});
