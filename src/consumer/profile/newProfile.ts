import type { UserProfileDraft } from '../repositories/profileRepository';

// What a new player's profile (users/{uid}) starts with. The app creates it
// the first time a signed-in player has none: right after sign-up, with the
// name they typed, or later if that write never reached the server.

/** The onboarding flow version a new profile starts on. */
export const CONSUMER_ONBOARDING_VERSION = 1;

/** The shared schema's bound on displayName, in UTF-16 code units (`string.length`). */
export const DISPLAY_NAME_MAX_LENGTH = 40;

const TIME_ZONE_MAX_LENGTH = 64;

/** The name a player typed, as the profile stores it: trimmed and bounded, or null when blank. */
export function profileDisplayName(typed: string | null | undefined): string | null {
  let name = (typed ?? '').trim().slice(0, DISPLAY_NAME_MAX_LENGTH);
  // Never end on half of a surrogate pair cut by the bound.
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
  name = name.trim();
  return name === '' ? null : name;
}

/** This device's IANA time zone, which drives the profile's daily buckets; UTC when the runtime reports none. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone.length <= TIME_ZONE_MAX_LENGTH) return zone;
  } catch {
    // Fall through to UTC.
  }
  return 'UTC';
}

export function newProfileDraft(displayName: string | null | undefined, timezone: string = deviceTimeZone()): UserProfileDraft {
  return {
    displayName: profileDisplayName(displayName),
    avatar: null,
    preferences: { timezone, soundEnabled: true, hapticsEnabled: true, weeklyGoal: null },
    onboarding: { version: CONSUMER_ONBOARDING_VERSION },
    eeg: { enabled: false, preferredDevice: null },
  };
}
