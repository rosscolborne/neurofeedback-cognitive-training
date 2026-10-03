// The device facts every game session records (NFCT-21), shared by every game.

export interface SessionEnvironment {
  /** IANA time zone of the device. */
  readonly timezone: string;
  readonly appVersion: string;
  readonly platform: 'ios' | 'android' | 'web';
}

/** The web app has no release versioning yet; this is package.json's version. */
export const APP_VERSION = '0.0.0';

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
