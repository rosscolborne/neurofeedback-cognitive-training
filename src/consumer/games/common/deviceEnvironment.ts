import { Capacitor } from '@capacitor/core';
import { APP_VERSION, deviceTimezone, type SessionEnvironment } from './sessionEnvironment';

// This device's session environment, for a game bound to the app (Sequence
// Memory; Mental Math keeps its own copy in MentalMathGame.tsx). Reading the
// platform from Capacitor makes this file native-sensitive for CI.

export function devicePlatform(): SessionEnvironment['platform'] {
  const name = Capacitor.getPlatform();
  return name === 'ios' || name === 'android' ? name : 'web';
}

export function deviceEnvironment(): SessionEnvironment {
  return { timezone: deviceTimezone(), appVersion: APP_VERSION, platform: devicePlatform() };
}
