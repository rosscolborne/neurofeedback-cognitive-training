---
name: nfct-frontend-design
description: Design and build polished, coherent, usable NFCT UI on the first pass, especially game and session flows, within the existing visual language. Use when implementing or changing any user-facing screen, component or game HUD.
---

# NFCT frontend design

This skill owns how UI is designed and built. Validating it in a browser
belongs to [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md).

Aim for a finished, intentional screen for the card at hand, not a redesign.

## Start from what exists

- Read the card's acceptance criteria and look at the affected screens in the
  running app before changing them.
- Keep the existing visual language unless the card explicitly calls for a
  redesign. Use the tokens in `src/styles/index.css` (`--space-*`,
  `--radius-*`, `--font-*`, `--text-*`, `--surface-*`, `--border-*`,
  `--status-*`, `--brand-*`) and existing classes such as `.btn`,
  `.btn-primary` and `.btn-secondary` instead of raw values or new one-off
  styles.
- Do not make visual changes unrelated to the card. Report defects you notice
  elsewhere instead of fixing them.

## Layout and hierarchy

- Use hierarchy, spacing and grouping to organize a screen, not decoration.
- Keep one obvious primary action per step.
- Avoid unnecessary modals and nested navigation.
- Never hide critical state or actions behind hover.
- Reserve space for content that changes (scores, feedback, timers,
  validation messages) so the layout does not shift when it appears.
- Keep layouts working at small windows and narrow, phone-like widths without
  overflow or clipped controls.

## Controls and accessibility

- Use semantic elements: `<button>` for actions, labelled form fields, and
  headings in order.
- Make targets large enough to hit easily (about 44×44 CSS px) and spaced so
  neighbors are not hit by mistake.
- Support the keyboard where it fits the interaction, with a visible
  `:focus-visible` state, a sensible focus order, and focus moved
  deliberately when a step changes.
- Keep text readable: sufficient contrast (WCAG AA) and no shrinking text
  below the existing body size to make things fit.
- Respect `prefers-reduced-motion` for feedback and transition animation.

## States

Design loading, disabled, empty and error states on purpose. Each says what is
happening and what the user can do next; none is a raw fallback, blank panel
or stack trace. Disabled controls look disabled and explain why when that is
not obvious.

## Game and session flows

- The game content comes first; keep surrounding chrome minimal and avoid
  dashboard-like clutter.
- The HUD makes time, level, score and the current task easy to scan at a
  glance without competing with the game.
- Correct and wrong feedback is brief, legible and non-blocking: it does not
  cover the next task or require dismissal.
- Answer and input controls stay in stable, predictable positions between
  tasks.
- Rapid or repeated input must not cause double actions. Guard in the handler
  (ignore input while an answer is being processed), not only with disabled
  styling.
- Paused, resumed and backgrounded states are visually unmistakable, and
  resuming does not surprise the user with lost time or skipped tasks.
- At the end of a session, distinguish local or provisional results from
  trusted server results when both exist; do not present a client-computed
  score as final.
- EEG is optional. With no headset connected, screens look complete and
  intentional, not like a degraded fallback.

## Content

Use real product data and plain, standard UI copy. Do not invent fake
content, placeholder users, sample scores or filler labels to make a screen
look complete. If a slot has no real content yet, design its empty state.

## Validate

Judge the UI in the running app, not from JSX or CSS. After meaningful UI
changes, run [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md) on the
changed flow, including its UI checks, before handing off. Fix defects within
the card; report out-of-scope ones in its Jira-ready form. Deterministic
coverage still follows [Stage 1 test coverage](../../../AGENTS.md#stage-1-test-coverage).
