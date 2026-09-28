# Clinical claims and interpretive copy

Status: Pending
Date: 2026-09-28
Jira: WB-104 (item 4)

## Current behavior

Known places where patient- or clinician-facing copy makes clinical, efficacy or diagnostic-sounding
statements:

- **EducationHub** band descriptions, for example "Training Alpha helps with anxiety…", "SMR training
  helps with impulse control and is commonly used for ADHD…". Its band ranges also differ from the
  protocol templates (Alpha 8–12 Hz vs 8–13 Hz; Beta 15–30 Hz vs 13–30 Hz).
- **NeuroGambit** composite interpretations (`eegAdapter.ts`), shown to the patient as "Coach
  Assessment" and in its coach PDF: "High Anxiety / Tilt Vulnerability", "Grandmaster Composure",
  and similar.
- **Session briefing** strings in `SessionRunner.tsx` (`mechanism`, `benefit`, for example "…treating
  general anxiety", "…lower cortisol levels"). These are still in code but have not been rendered
  since WB-100.
- **Protocol template notes** (`clinicalProtocolTemplates.ts`, for example "High efficacy for
  sustained concentration…"). Clinicians see them in the builder; patients see them only if a
  clinician edits the note (see [clinician-note-visibility.md](clinician-note-visibility.md)).

WB-100 removed or softened some copy: the briefing claims are no longer shown, "Evidence-based" was
dropped from the builder, and NeuroGambit's on-screen `t_recover` label now reads "Recovery" (its coach
PDF still says "Autonomic Recovery Latency (t_recover)"). The items above remain.

## Decision to make

Which claims have validated support and are appropriate for patients? Which should be softened,
sourced, made clinician-only, or removed?

## Why this matters

Treatment-, diagnosis- or efficacy-sounding copy affects clinical credibility, regulatory exposure and
how patients understand their results. A game score labelled "High Anxiety" reads like an assessment.

## Recommended direction

Have a clinical/regulatory owner review the listed copy, then keep only sourced statements (patient-
facing where appropriate). Everything else becomes descriptive, non-diagnostic language. Align
EducationHub band ranges with the protocol templates as part of the same review.

## Consequences / tradeoffs

- Mostly copy changes, but NeuroGambit interpretations are asserted in unit tests and appear in its
  PDF export.
- Softer copy may feel less motivating; sourced copy needs citations to be maintained.

## What should NOT be changed until decided

- Do not add, strengthen or newly surface clinical claims, including re-rendering the hidden briefing
  strings.
- Do not rewrite clinician-authored notes.
- Removing an obviously unsupported claim during unrelated work should be flagged under WB-104
  rather than done silently.
