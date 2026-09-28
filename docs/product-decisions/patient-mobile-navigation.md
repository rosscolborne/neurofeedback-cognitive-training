# Patient mobile navigation

Status: Pending
Date: 2026-09-28
Jira: WB-104 (item 3), WB-102

## Current behavior

- The patient shell has 7 persistent bottom-bar destinations: Home, Train, Science, Progress, Messages,
  Visits, Profile (`PatientShell.tsx`).
- Each tab fills its share of the bar (at least 48px tall). Labels are 10px, and 9px below 360px wide
  (WB-100). On phones the bar hides while a text field has focus.
- An unlinked patient still sees Messages and Visits, which open a "connect with a clinician"
  placeholder.

## Decision to make

Is the 7-destination bar accepted for beta and production? Or should a later redesign reduce persistent
destinations (for example through a More/overflow item or regrouped sections)?

## Why this matters

Seven labels at 9–10px are hard to read on narrow phones, and common mobile guidance favours about
five top-level destinations. This is an information-architecture question, not styling.

## Recommended direction

Decide after WB-102 lands. That card removes Messages and Visits for unlinked patients (7 → 5 for them),
so the question narrows to linked patients, and the answer should reflect real usage of Science and
Visits.

## Consequences / tradeoffs

- Fewer destinations improves legibility but hides some features one tap deeper.
- Any change affects E2E navigation helpers and patient habits once beta starts.
- Linked and unlinked patients will already see different bars after WB-102; a redesign should keep
  the two coherent.

## What should NOT be changed until decided

- Keep the current seven destinations and their order for linked patients.
- Do not add a More/overflow pattern or regroup sections here. Unlinked-patient changes belong to WB-102.
