# Product decisions

These records hold product-policy questions that UI code must not settle by accident: what patients
and clinicians see, how metrics are counted, and which copy the product stands behind.

- **Jira tracks the work.** Open questions, ownership and implementation status live in Jira
  (the umbrella card for this set is WB-104).
- **The repo holds the intent.** Once a question is decided, its record here becomes the durable
  statement of what the product intends and why, next to the code it governs.
- **Check here first.** Before changing behaviour in an area covered below, developers and agents
  should read the matching record.
- **Pending is not permission.** A `Pending` record describes today's behaviour and a proposed
  direction. It does not authorise changing that behaviour; keep current behaviour until the record
  is accepted.
- **Accepted records keep their reasoning.** When a decision is made, set `Status: Accepted`, record
  the date and decision-maker, and keep the rationale and consequences so later readers know what
  was weighed.

Each record uses the same sections: Current behavior, Decision to make, Why this matters, Recommended
direction, Consequences / tradeoffs, and What should NOT be changed until decided.

## Records

| Record | Status | Jira |
| --- | --- | --- |
| [Demo sessions in patient and report metrics](demo-session-metrics.md) | Pending | WB-104, WB-78 |
| [Clinician-note visibility to patients](clinician-note-visibility.md) | Pending | WB-104 |
| [Patient mobile navigation](patient-mobile-navigation.md) | Pending | WB-104, WB-102 |
| [Clinical claims and interpretive copy](clinical-claims-copy.md) | Pending | WB-104 |
| [Reporting timezone source of truth](reporting-timezone-source.md) | Pending | WB-104, WB-84 |
| [Fractional expected-session presentation](fractional-expected-sessions.md) | Pending | WB-104, WB-103 |

These questions were surfaced by the WB-100 UI/UX review (2026-09-28).
