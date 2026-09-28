# Reporting timezone source of truth

Status: Pending
Date: 2026-09-28
Jira: WB-104 (item 5), WB-84

## Current behavior

- **Clinician Reports** build their windows (30 days / 90 days / YTD) and labels in the viewing
  device's timezone (`Intl…resolvedOptions().timeZone`, `ClinicalReportsView.tsx`). Interval PDFs
  exported from Reports use the same zone.
- **Patient-detail PDF exports** (all sessions, or one selected session) also use the device timezone.
  Before WB-100 they used UTC.
- **The clinic timezone** saved in Settings (`ClinicSettingsView.tsx`) is not used by any report.
- **Appointments** store their own timezone and are shown in it ("Times are shown in each
  appointment's timezone").
- **Patient Home and Progress** group sessions by day and week in the device timezone.
- **PDF dates** use an `en-US` format with the zone name on "Generated"; the app uses the viewer's
  locale.

## Decision to make

Which timezone is authoritative for report windows and report timestamps: clinic, patient,
viewing device, or another explicit source? Does the answer differ for clinician reports and
patient-facing views?

## Why this matters

The timezone decides which sessions fall inside a window, which day a session counts toward, and
therefore adherence. Two clinicians in different zones, or a clinician and a patient, can currently
see different windows for the same data.

## Recommended direction

Make the choice explicit, then implement it under WB-84. WB-84's card states the intended behavior as
"report periods use the clinic's timezone"; WB-104 lists the question as still open. Confirm or amend
WB-84's statement rather than choosing a rule in code.

## Consequences / tradeoffs

- Clinic timezone gives every clinician the same windows, but patients or remote clinicians in other
  zones may see day boundaries shift.
- Device timezone matches what the viewer expects locally, but reports are not reproducible across
  viewers.
- Any change alters which sessions fall inside existing report windows.

## What should NOT be changed until decided

- Keep the device-timezone behavior in Reports and exports, and keep showing the zone on reports.
- Do not wire the saved clinic timezone into reports ahead of the decision.
- Do not change appointment timezone handling; it is separate and deliberate.
