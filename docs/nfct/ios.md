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
ones.

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
4. run NFCT-33's iPad checks and add an iPad Simulator to the Simulator scenarios.

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
| 2 | Interactive Chromium at iPhone sizes (iPhone SE (3rd gen) and iPhone 17 profiles) | Layout, overflow, clipping and touch targets at phone sizes, operated by an agent in real Chrome. Chromium mobile emulation: not iOS or Safari evidence | [Exploratory QA](../../.agents/skills/nfct-exploratory-qa/SKILL.md) of every user-facing change | Linux |
| 3 | Playwright WebKit, iPhone SE (3rd gen) and iPhone 17 profiles | WebKit engine differences; small-screen, touch and mobile layout | `ios.yml` `webkit`, every PR; `npm run test:e2e:webkit` | Linux |
| 4 | Native build and iOS Simulator | The project compiles; Release is safe; in WKWebView at `capacitor://localhost`, the [Simulator scenarios](#simulator-scenarios) pass through the real UI: sign-up and relaunch, a whole Mental Math run saved, backgrounding pauses a run, a kill mid-run saves nothing; weekly on the [oldest supported iOS](#the-minimum-ios-runtime) | `ios.yml` `native`, GitHub-hosted macOS | Nothing local |
| 5 | Physical iPhone | Interruptions that never hide the page, the software keyboard, IndexedDB durability, real performance | NFCT-32 checklist | The owner's iPhone and signing |
| 6 | Physical iPhone with a Muse headset | Bluetooth, acquisition and signal quality on the device | NFCT-15 | The iPhone and a headset |

Alongside these, `ios.yml` `release-bundle` runs on every PR. It builds and
syncs the production bundle, runs `verify:ios-release`, and shows that the
check fails on the emulator bundle.

A signed-in account whose role has not been read yet stays on the loading
screen; a failed read, or none within 15 s, shows a retryable error, never role
selection (NFCT-44). A failure there is a product bug, so it is not retried away.

Playwright WebKit is current WebKit on Linux, not iOS WKWebView. It does not
prove older iOS versions, the `capacitor://` origin, suspension, the software
keyboard, safe areas or Bluetooth. Layer 4 adds the real WKWebView, the
origin and iOS's own app lifecycle. Layer 5 adds what only a device shows.

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
5. the [Simulator scenarios](#simulator-scenarios): an emulator Debug build,
   with the page agent added to that build only, on an iPhone Simulator
   against the Auth and Firestore emulators. Every scenario, on every launch,
   also checks that Capacitor loads `capacitor://localhost`, that
   `location.origin` is `capacitor://localhost`, that the origin is a secure
   context with `crypto.randomUUID`, and that no uncaught JavaScript error
   occurs.

   The `ios-simulator-scenarios` artifact holds, per scenario, the
   checkpoint screenshots, each launch's console log, `steps.json` (every
   tap, fill and wait, with timings, and what the page showed at each
   checkpoint), and overall `summary.md` and `results.json`. The summary is
   also on the run page.

Pull requests run it only when they change native-relevant paths:

- `ios/`, `capacitor.config.*`, `package-lock.json`, `vite.config.ts`;
- the iOS scripts and the workflow;
- what the scenarios drive: the Firebase setup, `src/App.tsx` and
  `AuthContext.tsx`, the onboarding screens, the patient shell's Train tab
  (`PatientShell.tsx`) and Mental Math (`src/consumer/games/mentalMath/`).

Pushes to `main`, manual runs and the weekly run always run it. A skipped job
reports success, so the job can be a required check.

To move to a newer Xcode, change `XCODE_APP` and the Swift package cache key
in `ios.yml` to a version that has a Simulator runtime on the image
([runner images](https://github.com/actions/runner-images/tree/main/images/macos)).

### Simulator scenarios

The scenarios drive the real app in the real Simulator, through its visible
UI, with no dependency beyond Node and Xcode:

- the **page agent** (`scripts/ios/simulator-probe.js`), added only to the
  emulator Debug build, finds elements as a user would: by role and
  accessible name, visible text or placeholder. Before each tap it checks
  that the target's centre is inside the visual viewport and that the
  topmost element there is the target, so an overlay, a sticky bar or a
  clipped control fails the step instead of being clicked through. It then
  sends the DOM events a finger tap produces (pointer, touch, mouse, click);
- the **host driver** (`scripts/ios/simulator-driver.mjs`) sends one command
  at a time over HTTP on the Simulator's loopback, port 8735, the same way
  the app reaches the emulators. It drives the lifecycle with `simctl`
  (background: launch Settings; foreground: launch the app again, which
  resumes it; kill: `simctl terminate`), takes the screenshots with `simctl
  io`, and reads the Auth and Firestore emulators over REST, loopback and
  `demo-` projects only;
- the **scenarios** (`scripts/ios/simulator-scenarios.mjs`) are short async
  functions. Each starts from a fresh install and a new account.

| Scenario | Proves in the Simulator | Does not prove |
| --- | --- | --- |
| `smoke` | Sign-up and the role choice (a Firestore write) through the real UI; a cold relaunch restores the session and role, or names the screen it landed on (role selection, "Your account couldn't be loaded", signed out); light and Dark Mode screenshots | Real touches or typing through the software keyboard |
| `mental-math` | Train tab, Mental Math, level 1; a whole 90-second run answered on the on-screen keypad by reading and solving each question (one answer deliberately wrong); the end-of-run screen (`#mm-handoff-title`); exactly one session in the Firestore emulator: completed, 90 s active, `client.platform` `ios`, its answered trials exactly the responses typed, each marked correct or wrong as answered | Trusted scoring (the Functions emulator does not run here; `test:functions` covers it), the post-run summary's content (NFCT-22), real performance |
| `lifecycle` | With a question on screen, sending the app to the background (iOS really backgrounds it): iOS hides the page (`visibilitychange`), the run pauses as a background pause, none of the 8 s away counts, the run stays paused until the player resumes, and Resume shows a new question. It records when iOS's events arrive (`visibilitychange`, Capacitor's `pause` and `resume`, `blur`, on the wall clock the host shares) and checks that the page is hidden within a second of iOS's native signal. A kill mid-run then a relaunch lands signed in, not in a run, with no session written; a quit run is still saved once, as abandoned | Interruptions that never hide the page (Control Center, calls, Siri: NFCT-32), long suspensions, a kill while a write is queued offline |

On an app switch in the Simulator, iOS sends the page Capacitor's `pause`,
the window's `blur` and `visibilitychange` (hidden) together, so NFCT-21's
visibility-based pause holds there. `lifecycle` checks they stay within a
second of each other. The interruptions that make the app inactive without
hiding the page stay on NFCT-32's device checklist.

The scenarios use what a user sees plus a few stable hooks: the Mental Math
HUD's `data-hud` attributes, `.mm-question`, `.mm-feedback`, `.mm-paused` and
the end-of-run heading's id. When onboarding, the Train tab or Mental Math
change, update the scenarios with them, as for `e2e/helpers/auth.ts`.

Simulator evidence is not device evidence, and Playwright WebKit is not
Simulator evidence.

#### Running scenarios from an agent or a terminal

Any branch, any scenarios, no Mac. A manual run always runs the native job,
on GitHub-hosted macOS, whose minutes cost ten times Linux minutes: run only
the scenarios you need.

```bash
branch=$(git branch --show-current)
gh workflow run ios.yml --ref "$branch" -f scenarios='mental-math'   # or: smoke lifecycle; empty runs all
sleep 10
run=$(gh run list --workflow ios.yml --branch "$branch" --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$run" --exit-status > /dev/null                         # about 10 minutes for all three
gh run download "$run" -n ios-simulator-scenarios -D "ios-sim-$run"   # outside the repository
cat "ios-sim-$run/summary.md"
```

Then look at the screenshots (`<scenario>/NN-<checkpoint>.png`; a failed
scenario adds `NN-failure.png`) and, for a failure, the `Stopped at` step in
the summary, the screen outline at the failure, `steps.json` and the launch
logs. `node scripts/ios/simulator-smoke.mjs list` describes the scenarios.

A new scenario is an entry in `SCENARIOS`: an async `run(ctx)` using
`ctx.launch()`, `ctx.relaunch()`, `ctx.app.tap/fill/wait/read`,
`ctx.device.background()`/`foreground()`/`appearance()`, `ctx.checkpoint(name)`,
`ctx.check(name, ok, detail)` and `ctx.emulators`. The agent and host logic
have Linux tests (`scripts/__tests__/simulator-*.test.mjs`): the launch-log
judgement, the HTTP protocol, the question solver against the shared game,
and the Firestore decoding.

### The minimum iOS runtime

The image has only its newest runtimes, and Playwright WebKit is always the
latest WebKit, so neither shows that the bundle still runs on the oldest iOS
the app supports (16.4). The native job therefore runs weekly (Mondays) on
`main` with the `smoke` scenario on iOS 16.4: `scripts/ios/simulator-runtime.mjs`
downloads the runtime (`xcodebuild -downloadPlatform iOS -buildVersion`),
creates an iPhone SE (3rd generation), the smallest supported screen, and
boots it. If a runtime cannot be installed or booted, it tries the next one
listed (17.5, then 18.6), and the run summary and a warning say which runtime
was used instead. The runtime is several gigabytes, so this never runs on
pull requests. On demand, for any branch:

```bash
gh workflow run ios.yml --ref "$branch" -f ios_runtimes='16.4 17.5 18.6' -f scenarios=smoke
```

The first run (1 October 2026, run 36837500419) installed iOS 16.4 (20E247)
with Xcode 26.5 on `macos-26` in about three and a half minutes, and all
three scenarios passed on an iPhone SE (3rd generation) in iOS 16.4's
WKWebView. The weekly run uses `smoke` only, to stay short; run all three on
demand after an upgrade of Vite, Capacitor or the build target.

### Real touch, the keyboard and system UI

The page agent's taps are DOM events in the page, not touches through iOS.
They prove the flow, the layout's hit-testing and the app's behavior, but not
gesture recognizers, `isTrusted` events, the software keyboard, permission
prompts or system UI. Options for those, considered for NFCT-39:

| Option | Would add | Cost and robustness |
| --- | --- | --- |
| XCUITest (a UI-test target, possibly generated in CI so the committed project and its contract test stay unchanged) | Real touches through iOS, typing on the software keyboard, permission alerts (Bluetooth, camera) through interruption monitors, Home and app switching | Apple's own tooling, no new dependency, no signing in the Simulator. A target must be committed or generated with the `xcodeproj` gem in CI; web content is reached through the accessibility tree, which is coarser than the DOM; a test build adds minutes per run |
| Maestro | YAML flows with real taps, typing and permission handling, quick to write | A third-party CLI and Java runtime downloaded in CI (pin and verify it); its own driver app; web views through accessibility only |
| idb (`fb-idb`) | Coordinate taps, text input and an accessibility dump from the command line | A Homebrew companion and a Python client with little recent maintenance; compatibility with Xcode 26 is unproven |
| Appium | | Excluded |

Decision: keep the DOM driver for flows. No spike was run for NFCT-39: the
DOM driver covers the flows that matter now, and Mental Math's input is an
on-screen keypad, which never opens the keyboard. When a flow needs a real
touch or system UI, which is first likely for the Bluetooth permission prompt
(NFCT-15) or typing through the keyboard on sign-up (NFCT-33), add a minimal
XCUITest target generated in CI for that check only, and keep the DOM
scenarios for everything else. Control Center, calls and Siri stay on
NFCT-32's device checklist: neither tool drives them reliably in the
Simulator.

### Running the native checks on a Mac

Every step above is a script, so a Mac can run exactly what CI runs:

```bash
npm run sync:ios && npm run ios:build && \
  node scripts/ios/check-built-app.mjs ios/App/build/DerivedData/Build/Products/Release-iphonesimulator/App.app Release
npm run sync:ios:emulators && node scripts/ios/simulator-smoke.mjs inject
udid=$(node scripts/ios/simulator-smoke.mjs pick)
npm run ios:build -- Debug "platform=iOS Simulator,id=$udid"
npx firebase emulators:exec --only auth,firestore --project demo-neurasticity-protocol-e2e \
  "node scripts/ios/simulator-smoke.mjs run ios/App/build/DerivedData/Build/Products/Debug-iphonesimulator/App.app $udid /tmp/ios-sim mental-math"
npm run sync:ios   # leave a production bundle behind
```

Omit the scenario names to run them all. The emulator Debug build with the
page agent opens and works normally by hand too: without a driver listening,
the agent stays idle.

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
