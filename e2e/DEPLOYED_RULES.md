# Deployed rules read probe

`npm run test:e2e:rules` signs in the dedicated patient and clinician accounts, then
issues ordinary browser Firestore reads through `firestoreProbe.ts`. The WB-52
fixture in `e2e/fixtures.ts` watches both browser contexts for permission errors.
The probe helper does not create or change data. The normal dashboard load can
backfill a missing patient name, so the dedicated account should retain its
complete profile. The probe requires the approved patient to be in the
clinician's roster and to have a clinic ID.

Before WB-53, the probe covered the patient's message summary and QEEG list,
plus the clinician's user role and practitioner document.

It now also covers:

- Patient user and client profile (including the embedded protocol assignment),
  clinic branding, sessions used by Home and Progress, ordered message history,
  legacy message history, and canonical and explicit-null legacy appointments.
- Clinician clinic settings, canonical and explicit-null legacy roster queries,
  invitation list, direct get of an existing invitation if present, linked
  patient profile and QEEG records, all roster patients' sessions for Reports,
  all roster patients' canonical and explicit-null legacy appointments, and
  the approved pair's message summary and ordered history. The legacy message
  document is read as the clinician when the patient probe confirms that the
  document belongs to the current clinician.

These current reads remain outside the read-only probe:

- The patient's invitation-code lookup occurs while accepting an invitation.
  There is no guaranteed pending invitation for the approved patient. Creating
  one would change the fixture. Clinician invitation-claim reads occur during
  invitation creation and unlinking, which are stateful operations.
- Appointment reads inside create, edit, and cancel transactions, and session
  reads during writes, need a stateful operation. Their ordinary list queries
  are covered here.
- Message pagination needs a history page with at least 50 messages; the
  approved fixture does not guarantee one. The first-page and live-listener
  query use the same collection and order constraints.
- A legacy message document owned by a former clinician is intentionally
  denied to the current clinician after relinking. The application catches
  that denial and keeps canonical history available, so the probe does not
  require this historical read to succeed.
- `deviceAssignments`, `protocolCatalog`, and the old `storageEngine` message
  and appointment methods are not read by the current dashboard UI. Protocol
  assignments and report/progress measurements live in client and session
  documents, which the probe reads.

The local emulator messaging scenario runs this same read probe against its
existing linked pair. It adds only reads to that scenario. A passing emulator
run confirms the probe's query shapes against repository rules; only a run
with development-project credentials can verify the deployed rules. The local
pair has no invitation or legacy message document, so those conditional
direct-get branches need an existing live fixture to run.
