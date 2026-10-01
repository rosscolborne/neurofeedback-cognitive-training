# ADR-002: iOS platform

- **Status:** Accepted, 1 October 2026
- **Card:** NFCT-30 (iOS foundation), with NFCT-31 (iOS build checks)
- **Evidence:** the iOS readiness audit of `main` @ `47c65bf` (30 September 2026)
- **How-to:** [ios.md](ios.md) covers building, running, signing and CI

## Context

iOS is the intended shipping platform. The repository already contains an
iOS app: a Capacitor 8 wrapper with Swift Package Manager under `ios/App`,
inherited from Waveable, which shipped TestFlight builds from it. The audit
found no reason to rewrite it, but found that it still carried Waveable's
Apple identity and had configuration that would cause problems on the first
install. Some of those choices, such as the web view's origin, cannot be
changed cheaply once users have installed the app.

## Decisions

### 1. A Capacitor hybrid app

The iOS app is the web app in Capacitor's WKWebView. There is no React
Native, Expo or native UI rewrite, and the web app stays a fully supported,
responsive product of its own.

### 2. Firebase through the JS SDK only

Auth and Firestore run through the Firebase JS SDK in the web view, exactly
as on the web, against the same rules. There is no native Firebase SDK and no
`GoogleService-Info.plist`. Escalation path 2 below lists the exceptions.

### 3. Native Bluetooth through `@capacitor-community/bluetooth-le`

On iOS, the Muse headset connects through the native plugin
(`BleClient` in `src/services/eegEngine.ts`). Web Bluetooth is used only in
desktop Chrome and Edge; Safari and WKWebView have none. EEG stays optional
everywhere, so Bluetooth is not a required device capability.

### 4. The origin is `capacitor://localhost`, permanently

Auth persistence, the Firestore cache and queued writes, and every other
on-device store are keyed by the web view's origin. Changing it after users
install the app would orphan all of that data. `capacitor.config.ts` sets
`iosScheme: 'capacitor'` and `hostname: 'localhost'` explicitly. `https` is
not possible: WKWebView handles that scheme itself, and Capacitor silently
falls back to `capacitor`. The contract tests in
`scripts/__tests__/ios-project.test.mjs` and `npm run verify:ios-release`
fail if the origin changes.

### 5. The minimum iOS version is 16.4, the same as the web build target

`IPHONEOS_DEPLOYMENT_TARGET` is 16.4, matching the oldest Safari that
`vite.config.ts` builds for (`safari16.4`, `ios16.4`). The two are pinned
together: raising either one means raising both, and a test fails if they
differ. Playwright's WebKit is always the latest WebKit, so it cannot catch
code that is too new for an older iOS version; this pin can.

### 6. iPhone-only native app for now

The native target is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`) and
portrait-only on iPhone; it is not offered on Apple-silicon Macs or Vision
Pro. The owner decided this on 1 October 2026. The web app stays responsive at every
size, and product code must not assume a phone. Adding iPad later is a
project setting and a test pass, not an architecture change
([ios.md](ios.md#adding-ipad-later)).

## Escalation paths

1. **A native Swift Capacitor plugin, not React Native**, if any of these
   becomes true:
   - background EEG capture becomes a requirement;
   - device testing measures dropped data across the JS bridge;
   - BLE sessions have to survive web view reloads.
2. **A native Firebase SDK, only for push notifications, App Attest (App
   Check on iOS, NFCT-34) or Crashlytics.** It would be configured without
   committing Waveable-style plist files; NFCT-34 records the options.

## Consequences

- One codebase and one data path for web and iOS. Rules, trusted scoring and
  tests apply to both unchanged.
- iOS-specific behavior is limited to the shell: lifecycle and suspension
  (NFCT-32), safe areas and touch polish (NFCT-33), Bluetooth (NFCT-15), and
  release work (NFCT-34).
- Because the web view runs the production web bundle, a development or
  emulator bundle must never reach a Release build. `npm run
  verify:ios-release` and a Release-only Xcode build phase enforce this.
- WKWebView suspends completely in the background. Anything that must
  happen in the background needs escalation path 1.
