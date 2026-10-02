import { defineConfig, devices } from '@playwright/test';
import protocol from './playwright.protocol.config';

// Safari-engine and iPhone-viewport coverage for the user-facing flows most
// exposed on iOS (NFCT-31). It reuses the local-emulator suite's emulators,
// app server and fixtures, so only the browser and device differ. CI runs it
// in .github/workflows/ios.yml; locally, `npm run test:e2e:webkit` after
// `npx playwright install webkit`.
//
// Playwright WebKit is current WebKit on Linux, not iOS WKWebView. It catches
// WebKit engine differences and small-screen, touch and mobile layout
// problems. It does not prove older iOS versions, the capacitor:// origin,
// suspension, the software keyboard, safe areas or Bluetooth; the iOS
// Simulator scenarios and real iPhones cover those (docs/nfct/ios.md).
const IOS_WEBKIT_SPECS = [
  // Sign-in, credentials and account deletion.
  'auth-handoffs.local.spec.ts',
  'password-reset.auth-handoffs.local.spec.ts',
  'account-deletion-lifecycle.local.spec.ts',
  // NFCT-44: an onboarded consumer reloading while their role is slow to load.
  'returning-user.auth-handoffs.local.spec.ts',
  // Stage 1 (NFCT-20, NFCT-21): Mental Math run lifecycle, cache isolation and
  // offline cache.
  'mental-math.lifecycle.local.spec.ts',
  'cache-isolation.persistence.local.spec.ts',
  'offline-cache.persistence.local.spec.ts',
  // NFCT-22: the post-session summary and progress, through trusted scoring
  // (needs the Functions emulator, which test:e2e:webkit starts).
  'mental-math-summary.lifecycle.local.spec.ts',
  // NFCT-12: the Train game catalogue, the way into every game, at phone widths.
  'train-catalogue.self-directed.local.spec.ts',
  // NFCT-33: iPhone polish. The account forms and dialogs and the bundled
  // fonts; the run screen's touch handling, HUD widths and keypad.
  'iphone-forms.auth-handoffs.local.spec.ts',
  'mental-math-touch.lifecycle.local.spec.ts',
  // NFCT-13: Home's Play, streak and achievements, and Progress, after a run
  // scored by trusted scoring.
  'home-progress.lifecycle.local.spec.ts',
];

export default defineConfig({
  ...protocol,
  testMatch: IOS_WEBKIT_SPECS.map((spec) => `**/${spec}`),
  // The suite's launchOptions point at system Chrome; WebKit uses its own build.
  use: { ...protocol.use, launchOptions: {} },
  projects: [
    // Smallest screen that supports iOS 16.4: 375 x 667 pt.
    { name: 'webkit-iphone-se', use: { ...devices['iPhone SE (3rd gen)'] } },
    // A current mainstream iPhone: 402 x 874 pt (Safari viewport 402 x 681).
    { name: 'webkit-iphone-17', use: { ...devices['iPhone 17'] } },
  ],
});
