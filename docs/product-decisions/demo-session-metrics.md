# Demo sessions in patient and report metrics

Status: Pending
Date: 2026-09-28
Jira: WB-104 (item 1), WB-78

## Current behavior

"Try Demo Mode" sessions run without a headset on simulated signal and are saved with
`session.isDemo: true`. They are labelled, but they count like measured sessions:

- **Patient Home and Progress** include them in session count, training time, "Measured sessions",
  average time in zone, the chart, weekly activity and streak (`patientMetrics.ts`). Averages that
  include them say "includes N simulated Demo", and history rows carry a "Training Demo" tag.
- **Saving a Demo session** increments `completedSessionsCount`, updates `lastSessionDate` and can
  award milestones (`dataMappers.ts`), the same as a measured session.
- **Clinician patient detail** shows a "Demo" chip on the session row.
- **Clinician Reports** include them in sessions recorded, adherence, average in zone and the in-zone
  trend (`clinicalReportAnalytics.ts`). The page and PDFs state this ("Simulated, included in
  metrics"; "includes N Demo"), and the trend chart draws them as hollow markers.

Not the same thing: `client.isDemo` marks fictional **sample-workspace** records ("Sample records"),
which are excluded from report metrics. This record is only about patient Training Demo sessions.

## Decision to make

Should Training Demo sessions stay in these aggregates long-term? If not, which patient and clinician
metrics exclude them, and are they shown separately (for example "3 practice sessions")?

## Why this matters

A patient can reach targets, streaks and milestones without training with a headset, and a
clinician's adherence and in-zone figures can include simulated values. Every early test account
currently has only Demo sessions, so today's numbers are mostly simulated.

## Recommended direction

WB-78 already recommends that Demo sessions not count as clinical progress but stay visible,
labelled, as practice. That rule should apply the same way on patient and clinician surfaces, and be
confirmed here before any filtering is implemented.

## Consequences / tradeoffs

- Excluding them makes real progress honest, but early testers without headsets would see empty
  progress, so the empty states need care.
- `completedSessionsCount` and awarded milestones are stored values. Changing the rule needs a
  decision on existing records (recompute or leave as is).
- Patient, clinician, report and PDF counts must change together, or the surfaces will disagree.

## What should NOT be changed until decided

- Keep Demo sessions included where they are included today, and keep every existing Demo label and
  caption.
- Do not filter Demo sessions out of a single surface on its own.
- Do not remove the Demo distinction because current test data happens to be all Demo.
