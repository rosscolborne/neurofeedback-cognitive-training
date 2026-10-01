# The iOS app

The iOS app is the web app in a Capacitor 8 shell (`ios/App`, Swift Package
Manager). [ADR-002](adr-002-ios-platform.md) records why, and the decisions
this page relies on: the permanent `capacitor://localhost` origin, iOS 16.4 as
the minimum version, and an iPhone-only native target.

Routine iOS validation does not need your Mac. GitHub-hosted macOS runners
build the app and run it in the iOS Simulator on every change that can affect
it ([Checks and where they run](#checks-and-where-they-run)). A local Mac is a
fallback for interactive debugging. A physical iPhone and a Muse headset are
still needed for the checks listed under
[What still needs a person](#what-still-needs-a-person).

## Identity

| | Value | Status |
| --- | --- | --- |
| Bundle ID | `io.github.rosscolborne.nfct` | Working placeholder under the repository owner's GitHub namespace |
| Display name | `NFCT` | Working name |
| Apple team | none committed | Set locally ([Signing](#signing-on-your-mac)) |
| Version / build | `1.0` / `1` | `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` |

NFCT-34 replaces the working identity with the public one (bundle ID, name,
icon, App Store Connect record) before the first TestFlight build. Until any
user installs a build, changing the bundle ID costs nothing:

1. change `appId` in `capacitor.config.ts`;
2. change both `PRODUCT_BUNDLE_IDENTIFIER` lines in
   `ios/App/App.xcodeproj/project.pbxproj` (`cap sync` does not rewrite them);
3. run `npm test`; `scripts/__tests__/ios-project.test.mjs` fails if the two
   disagree.

After users have installed it, a new bundle ID is a new app with empty
storage.

Nothing of Waveable's Apple identity remains: its bundle IDs, team, upload
scripts, export options and Xcode Cloud hooks were removed in NFCT-30, and
`npm run check:isolation` fails if its identifiers or any signing material
(`*.p12`, `*.cer`, `*.mobileprovision`, `*.provisionprofile`, `AuthKey_*.p8`,
`ios/signing.local.xcconfig`) are committed.

## Platform settings

| Setting | Value | Where | Notes |
| --- | --- | --- | --- |
| Origin | `capacitor://localhost` | `capacitor.config.ts` | Permanent (ADR-002) |
| Minimum iOS | 16.4 | `IPHONEOS_DEPLOYMENT_TARGET`, `BUILD_TARGET` in `vite.config.ts` | Change both together; `Package.swift` follows on `cap sync` |
| Devices | iPhone only | `TARGETED_DEVICE_FAMILY = 1` | Not Mac ("Designed for iPhone") or Vision Pro |
| Orientation | Portrait on iPhone | `Info.plist` | The iPad key keeps all four, for later |
| Appearance | Light | `UIUserInterfaceStyle`, `SystemBars.style` | Keeps the status bar legible in Dark Mode; the app has no dark theme |
| Bluetooth | Optional | `NSBluetoothAlwaysUsageDescription` | Not a required capability: EEG is optional |
| Camera | On request | `NSCameraUsageDescription` | The profile picture's Take Photo |
| Web inspection | Debug only | `ios/debug.xcconfig` sets `CAPACITOR_DEBUG` | Release builds are not inspectable and do not log |

Capacitor 8's built-in SystemBars plugin applies its own status-bar style at
launch, after reading `Info.plist`, so `UIStatusBarStyle` alone has no effect.
The style is set in `capacitor.config.ts`, and `Info.plist` forces Light.

### Adding iPad later

The native target is iPhone-only by the owner's decision of 1 October 2026,
not because of the code. The web app is responsive and must stay so. To add
iPad:

1. set `TARGETED_DEVICE_FAMILY = "1,2"` in both App target configurations;
2. `UISupportedInterfaceOrientations~ipad` already lists all four
   orientations;
3. update the device-support test in `scripts/__tests__/ios-project.test.mjs`
   and `scripts/ios/check-built-app.mjs`;
4. run NFCT-33's iPad checks and add an iPad Simulator to the smoke test.

## Build and run

You need macOS with Xcode 26 (CI uses 26.5), Node from `.nvmrc`, and
`npm ci --legacy-peer-deps`.

```bash
npm run sync:ios      # production web build, cap sync, then verify:ios-release
npm run ios:build     # unsigned Release build for the Simulator, as CI runs it
npm run open:xcode    # open the project in Xcode
```

`npm run ios:build -- Debug` builds Debug instead, and
`npm run ios:build -- Debug 'platform=iOS Simulator,name=iPhone 17'` targets
one Simulator.

### Against the local emulators

A production build refuses emulator mode by design (`firebaseConfig.ts`
requires `DEV`). For a Simulator build that talks to the local emulators:

```bash
npx firebase emulators:start --only auth,firestore --project demo-neurasticity-protocol-e2e
npm run sync:ios:emulators   # development build with the emulator settings, then cap sync
```

Then run the app from Xcode with the Debug configuration. The Simulator
shares the Mac's network, so `127.0.0.1` reaches the emulators. A physical
iPhone cannot reach them that way; NFCT-32 covers device testing.

**Never archive this bundle.** `npm run verify:ios-release` fails on it, and
the App target's "Refuse a development web bundle in Release" build phase
(`ios/scripts/release-web-bundle-guard.sh`) stops any Release build, which
includes every archive, that contains it. Run `npm run sync:ios` before a
Release build.

No App Transport Security exception is configured. `Info.plist` is shared by
Debug and Release, so `verify:ios-release` fails on any
`NSAppTransportSecurity` entry; an exception the emulators need would have to
be Debug-only.

### Signing on your Mac

Simulator builds and CI need no signing. To install a Debug build on your own
iPhone:

```bash
cp ios/signing.local.xcconfig.example ios/signing.local.xcconfig   # gitignored
# set DEVELOPMENT_TEAM to your team ID
```

Both `ios/debug.xcconfig` and `ios/release.xcconfig` include that file when it
exists. Do not choose a team in Xcode's Signing & Capabilities tab: Xcode
writes it into `project.pbxproj`, and the contract test fails on any committed
`DEVELOPMENT_TEAM`.

## Checks and where they run

Each layer catches what the one before cannot. None of them substitutes for
a higher one.

| # | Layer | Proves | Runs | Needs |
| --- | --- | --- | --- | --- |
| 1 | Desktop Chromium Playwright | Normal browser regressions | `ci.yml`, every PR | Linux |
| 2 | Playwright WebKit, iPhone SE (3rd gen) and iPhone 17 profiles | WebKit engine differences; small-screen, touch and mobile layout | `ios.yml` `webkit`, every PR; `npm run test:e2e:webkit` | Linux |
| 3 | Native build and iOS Simulator | The project compiles; Release is safe; the app launches, signs up and restores its session in WKWebView at `capacitor://localhost` | `ios.yml` `native`, GitHub-hosted macOS | Nothing local |
| 4 | Physical iPhone | Suspension, interruptions, the keyboard, IndexedDB durability, real performance | NFCT-32 checklist | The owner's iPhone and signing |
| 5 | Real Muse headset | Bluetooth, acquisition, signal quality | NFCT-15 | Hardware |

Alongside these, `ios.yml` `release-bundle` runs on every PR. It builds and
syncs the production bundle, runs `verify:ios-release`, and shows that the
check fails on the emulator bundle.

Playwright WebKit is current WebKit on Linux, not iOS WKWebView. It does not
prove older iOS versions, the `capacitor://` origin, suspension, the software
keyboard, safe areas or Bluetooth. Layer 3 adds the real WKWebView and origin.
Layer 4 adds what only a device shows.

### The macOS job (`ios.yml` `native`)

It runs on a pinned image and Xcode (`macos-26`, Xcode 26.5) and logs the
Xcode version and Simulator runtimes. In order:

1. `npm run sync:ios`, which includes the release check;
2. Swift package resolution (cached), then an unsigned Release build for the
   Simulator, which is what an archive compiles;
3. `scripts/ios/check-built-app.mjs` on the built Release app: bundle ID,
   iPhone-only, iOS 16.4, `CAPACITOR_DEBUG` empty (so the web view is not
   inspectable), a production web bundle and a safe synced config;
4. a negative test: a Release build with the emulator bundle must fail in the
   guard build phase;
5. the Simulator smoke test (`scripts/ios/simulator-smoke.mjs`): an emulator
   Debug build on an iPhone Simulator, with a probe added to that build only.
   Against the Auth and Firestore emulators it checks that:
   - Capacitor loads `capacitor://localhost` and `location.origin` is
     `capacitor://localhost`;
   - the origin is a secure context and `crypto.randomUUID` exists;
   - sign-up and the first Firestore write work through the real UI;
   - a cold relaunch restores the session;
   - no uncaught JavaScript errors occur.

   It saves logs and light and Dark Mode screenshots as the
   `ios-simulator-smoke` artifact, and a summary on the run page.

Pull requests run it only when they change native-relevant paths:

- `ios/`, `capacitor.config.*`, `package-lock.json`, `vite.config.ts`;
- the iOS scripts and the workflow;
- the Firebase setup and the onboarding screens, which the smoke test uses.

Pushes to `main` and manual runs always run it. A skipped job reports success,
so the job can be a required check.

To move to a newer Xcode, change `XCODE_APP` and the Swift package cache key
in `ios.yml` to a version that has a Simulator runtime on the image
([runner images](https://github.com/actions/runner-images/tree/main/images/macos)).

The smoke test exercises the inherited onboarding (sign-up, then the role
choice). When onboarding changes, update `scripts/ios/simulator-probe.js` with
it, as for `e2e/helpers/auth.ts`.

### Running the native checks on a Mac

Every step above is a script, so a Mac can run exactly what CI runs:

```bash
npm run sync:ios && npm run ios:build && \
  node scripts/ios/check-built-app.mjs ios/App/build/DerivedData/Build/Products/Release-iphonesimulator/App.app Release
npm run sync:ios:emulators && node scripts/ios/simulator-smoke.mjs inject
udid=$(node scripts/ios/simulator-smoke.mjs pick)
npm run ios:build -- Debug "platform=iOS Simulator,id=$udid"
npx firebase emulators:exec --only auth,firestore --project demo-neurasticity-protocol-e2e \
  "node scripts/ios/simulator-smoke.mjs run ios/App/build/DerivedData/Build/Products/Debug-iphonesimulator/App.app $udid /tmp/ios-smoke"
npm run sync:ios   # leave a production bundle behind
```

## Releases (NFCT-34, not built yet)

The intended release model has no long-lived release or beta branch:

- feature PRs merge to `main`;
- a TestFlight build is a manually dispatched workflow (for example "Deploy
  to TestFlight", `workflow_dispatch` with a `ref` input) that builds one
  specific `main` commit or release tag, so nothing is merged or squashed
  only for a release;
- the job runs in a protected GitHub environment with a required reviewer.
  Its secrets are the App Store Connect API key (issuer ID, key ID, `.p8`)
  and the team ID. They never enter the repository, which
  `check:isolation` enforces;
- it reuses this page's steps: `npm run sync:ios` (with the release check),
  then `xcodebuild archive` (Release, so the guard build phase applies),
  `-exportArchive` with export options generated at run time, and upload. The
  build number comes from the run, and the commit is tagged with the version.

The account-dependent parts (the App Store Connect record, the team, signing,
App Attest) are NFCT-34's and are created by the owner, never by an agent.

## What still needs a person

| Needs | For | Card |
| --- | --- | --- |
| An Apple Developer account | The final bundle ID and team, TestFlight, App Store Connect, App Attest | NFCT-34 |
| A physical iPhone (a free personal team is enough for Debug installs) | Suspension, interruptions, offline durability, keyboard, safe areas, real performance | NFCT-32, NFCT-33 |
| A Muse headset | Bluetooth and EEG on iPhone | NFCT-15 |
| A Mac (optional) | Interactive debugging when a native CI step fails; Safari Web Inspector on a Debug build; Xcode-only edits such as the app icon | — |
