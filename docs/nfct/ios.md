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
| Bundle ID | `com.neurofeedbackcognitivetraining.app` | Chosen by the owner on 1 October 2026; provisional until its App ID is registered |
| Display name | `NFCT` | Working name |
| Apple team | none committed | The existing Apple Developer account's team, set outside the repo: [locally](#signing-on-your-mac) or in [Xcode Cloud](#xcode-cloud) |
| Version / build | `1.0` / `1` | `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` |

The bundle ID becomes permanent once an App Store Connect app record uses
it, and a different bundle ID is a different app with empty storage. Until
then, for example if the App ID turns out to be unavailable, changing it costs
nothing:

1. change `appId` in `capacitor.config.ts`;
2. change both `PRODUCT_BUNDLE_IDENTIFIER` lines in
   `ios/App/App.xcodeproj/project.pbxproj` (`cap sync` does not rewrite them);
3. run `npm test`; `scripts/__tests__/ios-project.test.mjs` fails if the two
   disagree.

The display name and icon can change at any time; NFCT-34 sets the public
ones. The app's own screens name the product with `APP_DISPLAY_NAME` in
`src/config/appIdentity.ts`, which a test keeps equal to `appName`, so a
rename changes `appName`, `CFBundleDisplayName` in `ios/App/App/Info.plist`
and `APP_DISPLAY_NAME` together.

NFCT is a new app in the same Apple Developer account that holds Waveable's
app, so only the app's own identity had to change. NFCT-30 replaced
Waveable's bundle ID and name, and kept the reusable deployment pieces in
product-neutral form:

| Inherited | Now |
| --- | --- |
| Waveable bundle ID and display name | NFCT working identity (above) |
| `DEVELOPMENT_TEAM` in the project | Set outside the repo; the account's team is unchanged |
| `ios/App/ci_scripts/ci_post_clone.sh` (Xcode Cloud hook) | Kept: locked install, production sync and the release check ([Xcode Cloud](#xcode-cloud)) |
| `ci_scripts/ci_post_clone.sh` (identical copy) | Delegates to the hook above |
| `build/package-mac.sh` and `build/ExportOptions.plist` | `npm run ios:archive` (`scripts/ios/archive.sh`) and `ios/ExportOptions-AppStoreConnect.plist`, with no team or product name |
| `build/ExportOptions-macOS-*.plist` | Removed: the app is not distributed for Mac |

`npm run check:isolation` fails if Waveable's bundle IDs or any signing
material (`*.p12`, `*.cer`, `*.mobileprovision`, `*.provisionprofile`,
`AuthKey_*.p8`, `ios/signing.local.xcconfig`) are committed. Waveable's own
Xcode Cloud workflow and app record belong to Waveable; NFCT gets its own
([Xcode Cloud](#xcode-cloud)) and never builds into Waveable's.

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

A signed-in account whose role has not been read yet stays on the loading
screen; a failed read, or none within 15 s, shows a retryable error, never role
selection (NFCT-44). A failure there is a product bug, so it is not retried away.

Playwright WebKit is current WebKit on Linux, not iOS WKWebView. It does not
prove older iOS versions, the `capacitor://` origin, suspension, the software
keyboard, safe areas or Bluetooth. Layer 3 adds the real WKWebView and origin.
Layer 4 adds what only a device shows.

### The macOS job (`ios.yml` `native`)

It runs on a pinned image and Xcode (`macos-26`, Xcode 26.5) and logs the
Xcode version and Simulator runtimes. In order:

1. the Xcode Cloud post-clone hook, which runs `npm ci` and `npm run sync:ios`
   with the release check, exactly as Xcode Cloud does;
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

## Xcode Cloud

TestFlight builds come from an Xcode Cloud workflow, the path the Apple
account already uses. NFCT needs its own workflow and app record; it must
never build into Waveable's.

What the repository provides, and CI proves on every native run:

- `ios/App/ci_scripts/ci_post_clone.sh`. Xcode Cloud runs it after cloning;
  it is the only place Xcode Cloud looks, next to `App.xcodeproj`. It installs
  the locked dependencies, builds and syncs the production web bundle, and
  runs `verify:ios-release`. The GitHub macOS job runs this same hook.
- The shared `App` scheme, which Xcode Cloud requires.
- An archive is a Release build, so the guard build phase also refuses a
  development bundle.
- The Firebase web config comes from workflow environment variables:
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`, and optionally the
  storage bucket and sender ID. `vite build` compiles them in. Without them
  the archive still succeeds and passes the release check, but the app
  refuses to start Firebase at launch (`firebaseConfig.ts` fails closed), and
  the hook prints a warning. They are not secret. Until NFCT-24 deploys the
  consumer rules, `nfct-dev` denies all reads and writes, so a TestFlight
  build can launch but cannot sign in or sync.
- Optional `NFCT_DEVELOPMENT_TEAM` workflow variable: the hook writes it to
  the gitignored `ios/signing.local.xcconfig`. Set it only if Xcode Cloud's
  archive reports that no team is selected; Xcode Cloud normally signs with
  the app record's team.

## Releases

The release model has no long-lived release or beta branch:

- feature PRs merge to `main`;
- a TestFlight build is started deliberately from a specific `main` commit or
  release tag: an Xcode Cloud workflow with a manual or tag start condition
  (for example tags `ios/v*`), so nothing is merged or squashed only for a
  release;
- `npm run ios:archive -- --upload` is the owner-run fallback from a Mac, with
  the same release check;
- a GitHub Actions "Deploy to TestFlight" workflow (`workflow_dispatch` on a
  ref, in a protected environment, with an App Store Connect API key) is an
  alternative for NFCT-34 if Xcode Cloud is ever dropped. Its secrets would
  never enter the repository, which `check:isolation` enforces.

### Apple-side setup (owner, Apple account)

These need the live Apple account and are done by the owner, never by an
agent. Nothing else in NFCT-30 or NFCT-31 waits for them.

1. Register `com.neurofeedbackcognitivetraining.app` as an App ID in
   Certificates, Identifiers & Profiles. It needs no extra capabilities:
   Bluetooth needs no entitlement.
2. If that ID is unavailable, choose another and change it as described in
   [Identity](#identity) before creating any app record.
3. Create the NFCT app record in App Store Connect with that bundle ID.
4. In Xcode, Integrate > Create Workflow for this repository's
   `ios/App/App.xcodeproj` and the `App` scheme, connected to
   `rosscolborne/neurofeedback-cognitive-training`. Give it an Archive (iOS)
   action, TestFlight internal testing as the post-action, and a manual or
   tag start condition on `main`. Use Xcode 26. Add the NFCT Firebase web
   config as environment variables ([Xcode Cloud](#xcode-cloud)); a build
   without them cannot use Firebase.
5. Start one build and confirm it reaches TestFlight. If the archive reports
   that no team is selected, add `NFCT_DEVELOPMENT_TEAM` to the workflow's
   environment.
6. Leave Waveable's existing workflow and app record unchanged.

NFCT-34 still owns the public name, icon, App Review, privacy labels and App
Attest.

## What still needs a person

| Needs | For | Card |
| --- | --- | --- |
| The Apple account | [Apple-side setup](#apple-side-setup-owner-apple-account): the App ID, app record and Xcode Cloud workflow; later the public identity and App Attest | NFCT-30 setup, NFCT-34 |
| A physical iPhone (a free personal team is enough for Debug installs) | Suspension, interruptions, offline durability, keyboard, safe areas, real performance | NFCT-32, NFCT-33 |
| A Muse headset | Bluetooth and EEG on iPhone | NFCT-15 |
| A Mac (optional) | Interactive debugging when a native CI step fails; Safari Web Inspector on a Debug build; Xcode-only edits such as the app icon | — |
