---
name: nfct-exploratory-qa
description: Explore the running NFCT app through a browser like a user, looking for bugs that deterministic tests miss. Use when asked for exploratory, manual or agent-driven UI/browser QA of a card or flow.
---

# NFCT exploratory browser QA

Exploratory QA complements the deterministic Playwright suite; it does not
replace it. Its output is a findings report, not code.

## Set up

1. Read the Jira card's acceptance criteria, and the flows and states they
   name.
2. Run the real application against the local emulators (see
   [Running locally](../../../AGENTS.md#running-locally)) and drive it through
   a browser the way a user would: click, type and navigate rather than
   calling app internals.
3. Create realistic test accounts and state through the UI or the emulator
   seeders in `e2e/helpers/localEmulator.ts`. Never use a real Firebase
   project, and never add fake data to production code paths to make a flow
   testable.

## Explore

Cover the primary flows first, then edge cases. For game and session flows,
try:

- correct and incorrect answers;
- rapid and double inputs, and double submits;
- pause and resume;
- backgrounding and foregrounding the tab or app;
- navigating away and back, reload, and the browser back button;
- timer boundaries: acting just before, at and after a limit;
- disabled, loading, empty and error states;
- repeated sessions in a row.

EEG is optional. Check that every flow is usable with no headset connected.
Do not assume Demo Mode or other simulated EEG affects cognitive scores,
progression, unlocks or achievements; if it does, that is a bug.

Throughout, watch for layout and visual problems, unexpected focus behavior,
stale UI after state changes, console errors and failed network requests,
where the browser tooling exposes them.

## Report

For each finding, give:

- **Type**: functional regression or cosmetic issue.
- **Steps to reproduce**: exact, starting from a named account and state.
- **Expected** and **actual** behavior, with console or network evidence and a
  screenshot where useful.
- **Scope**: within the card, or out of scope.

Do not fix findings as you go, and never fix out-of-scope ones in this task.
Write out-of-scope bugs in Jira-ready form (summary, steps, expected, actual,
environment) for someone to file.

End by stating explicitly what you could not test and why, such as physical
Muse hardware, iOS/Capacitor builds, Functions not yet emulated, or tooling
that could not observe the console.
