# Clinician-note visibility to patients

Status: Pending
Date: 2026-09-28
Jira: WB-104 (item 2)

## Current behavior

- The clinician protocol builder has a "Physician Clinical Notes & Rationale" field. It is prefilled
  with the protocol template's notes, which include efficacy statements.
- The patient's Protocol details shows this saved note as "Note from your clinician", but only when it
  differs from the template's text (`ProtocolDetailsModal.tsx`). Unedited template text is not shown.
- Before WB-100 the note was always shown to the patient, including unedited template text.
- Since WB-100 the builder states under the field: "Patients see this note in Protocol details when
  it differs from the template text."

Separate field, not in scope: per-session clinician feedback (`session.clinicianNotes`) is shown to the
patient in session history as "From your clinician".

## Decision to make

Is the protocol note patient-facing guidance, clinician-only documentation, or both? If both are
needed, should they become two fields (a clinician-only rationale and an optional note to the patient)?

## Why this matters

The label suggests private clinical documentation, but patients can read edited notes. Clinicians may
write rationale they do not intend patients to see. Template text that a clinician edits slightly
brings its efficacy claims to the patient with it (see [clinical-claims-copy.md](clinical-claims-copy.md)).

## Recommended direction

Decide intent explicitly. If both uses are wanted, separate a clinician-only rationale from an optional
patient-facing note rather than inferring visibility from whether text was edited.

## Consequences / tradeoffs

- Two fields means a data-model change and a migration choice for existing notes: which side do they
  land on?
- Making the note clinician-only removes a channel some clinicians may already use for patient
  guidance; per-session feedback and Messages remain.
- Keeping it patient-visible means the label and prefilled template text should change so clinicians
  are not surprised.

## What should NOT be changed until decided

- Keep the current visibility rule: edited notes shown, unedited template text hidden.
- Do not hide the note from patients or expose unedited template text.
- Do not rename or split the field.
