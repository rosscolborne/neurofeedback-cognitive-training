# Fractional expected-session presentation

Status: Pending
Date: 2026-09-28
Jira: WB-104 (item 6), WB-103

## Current behavior

- Expected sessions for a patient = weekly target × (days in the reporting window ÷ 7), rounded to one
  decimal (`clinicalReportAnalytics.ts`). The cohort total is the sum, also to one decimal, and is
  unavailable if any enrolled patient has no weekly target.
- Adherence = recorded sessions ÷ expected sessions, capped at 100%. Training Demo sessions count in
  the numerator (see [demo-session-metrics.md](demo-session-metrics.md)).
- The UI and PDFs say "expected", not "scheduled", because the figure comes from the weekly target,
  not booked appointments. For example, the Reports KPI reads "26 of 42.9 expected sessions", and each
  table row reads "5 of 12.9 expected". "About this data" explains that expected sessions grow with
  the selected window.
- Patient-detail PDF exports (all sessions or one session) do not calculate adherence.

## Decision to make

Keep showing the one-decimal mathematical expectation? Round for display while keeping the exact
calculation? Or use different phrasing or a different visual (for example a percentage with the
target stated as "4 per week")?

## Why this matters

"42.9 sessions" is precise but can read as odd or as a booking count, and adherence changes between
30 days, 90 days and YTD because the expectation scales with the window.

## Recommended direction

Keep the current calculation. Choose a presentation that stays true to it. The one-decimal value is
the most transparent option, and rounding to a whole number would imply a scheduled count that does
not exist.

## Consequences / tradeoffs

- Rounding reads more naturally but can make "26 of 43" disagree slightly with the shown percentage.
- Showing the weekly target instead of a total is clearer per patient but harder to sum for a cohort.
- Any wording change must also apply to the PDFs and the practice report.

## What should NOT be changed until decided

- Do not change the adherence or expected-session calculation.
- Keep the one-decimal display and the "expected" wording.
- Do not reintroduce "scheduled sessions".
